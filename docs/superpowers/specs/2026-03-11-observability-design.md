# Observability Design — Gastos Telegram Bot

**Date:** 2026-03-11
**Constraint:** Free-tier Cloudflare only (D1, KV, R2, Queues — no paid observability services)

## Goals

1. **Latency telemetry** — measure how long each step takes across the expense/chat lifecycle
2. **Failure tracking** — capture what broke with enough context to debug
3. **Correlation** — trace a single interaction from Telegram message to final response
4. **Queryable** — SQL for analysis, KV for quick error triage, structured for Claude debugging

## Free-Tier Limits to Respect

| Resource | Free-Tier Limit | Budget for Traces |
|----------|----------------|-------------------|
| D1 writes | 100,000 rows/day | ~2,500/day (assumes 500 interactions x 5 spans) — well within budget |
| KV writes | 1,000/day | Errors only — typically <50/day unless something is broken |
| KV reads | 100,000/day | On-demand debug queries only |

## Approach: D1 Traces + KV Error Index

### Correlation ID

A `trace_id` (UUID via `crypto.randomUUID()`) is generated at the webhook handler — the earliest entry point. It flows through:

```
Webhook (generate traceId)
  → queue message body (traceId attached)
    → queue processor (reads traceId)
      → all spans share traceId
```

For non-queued commands (`/start`, `/totals`), the trace starts and ends in the webhook handler.

### Type Changes

`ParseQueueMessage` in `src/types.ts` needs a new field:

```typescript
traceId?: string  // optional for backward compat with in-flight messages
```

Queue processor reads it with fallback: `body.traceId ?? crypto.randomUUID()`. This ensures in-flight messages at deploy time still get traced (with a new ID).

### D1 Schema

```sql
CREATE TABLE traces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id TEXT NOT NULL,
  span_name TEXT NOT NULL,
  user_id INTEGER,
  started_at_utc TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  error_message TEXT,
  metadata TEXT,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_traces_trace_id ON traces(trace_id);
CREATE INDEX idx_traces_user_id ON traces(user_id);
CREATE INDEX idx_traces_status_created ON traces(status, created_at_utc);
CREATE INDEX idx_traces_created_at ON traces(created_at_utc);
```

Notes:
- `user_id` is nullable for potential system-level spans (cron jobs)
- `started_at_utc` uses millisecond precision via `new Date().toISOString()` (e.g. `2026-03-11T12:34:56.789Z`)
- `metadata` is a JSON string — see Metadata Examples below
- Composite index on `(status, created_at_utc)` serves the "recent failures" query efficiently

### KV Error Index

Uses a **dedicated `TRACES_KV`** namespace (new binding in `wrangler.toml`) to avoid collision with rate-limiter keys.

When a span has `status = 'error'`, write to KV:

- **Key:** `error:{trace_id}`
- **Value:** `{traceId, spanName, userId, errorMessage, timestamp}`
- **TTL:** 7 days (auto-expires)

`TRACES_KV.list({prefix: "error:"})` gives instant access to all recent failures.

**Error storm safety:** KV free tier allows 1,000 writes/day. If errors exceed ~500/day, the tracer should stop writing to KV (check a counter) and fall back to D1-only. This prevents a bug loop from exhausting the KV budget.

### Span Naming Convention

`layer.operation` — keeps spans scannable and groupable.

### Instrumentation Points (~12 spans)

| Span Name | Location | What It Measures |
|-----------|----------|-----------------|
| `webhook.receive` | `src/routes/webhook.ts` | Full webhook handler duration |
| `webhook.command` | `src/routes/webhook.ts` | Non-queued commands (/start, /totals) |
| `webhook.media_upload` | `src/routes/webhook.ts` | R2 media upload |
| `queue.receipt` | `src/queue.ts` | Full receipt processing |
| `queue.chat` | `src/queue.ts` | Full chat processing |
| `queue.media_fetch` | `src/queue.ts` | R2 media fetch for base64 conversion |
| `ai.classify_intent` | `src/ai/agent.ts` | Intent classification call |
| `ai.extract_expense` | `src/ai/openai.ts` | Expense extraction (text or vision) |
| `ai.semantic_chat` | `src/ai/agent.ts` | Agent run for chat questions |
| `ai.transcribe` | `src/ai/openai.ts` | Voice transcription |
| `ai.embed` | `src/ai/openai.ts` | Embedding generation |
| `telegram.send_reply` | `src/telegram/messages.ts` | Sending response to user |

**Typical expense flow (4-5 spans):**
```
webhook.receive → queue.receipt → ai.extract_expense → telegram.send_reply
```

**Typical chat flow (5 spans):**
```
webhook.receive → queue.chat → ai.classify_intent → ai.semantic_chat → telegram.send_reply
```

### Metadata Examples

The `metadata` column is an optional JSON string. Examples per span type:

| Span | Metadata |
|------|----------|
| `webhook.receive` | `{"messageType": "photo", "chatId": 123}` |
| `ai.extract_expense` | `{"model": "gpt-4o-mini", "tokens": 1234}` |
| `ai.semantic_chat` | `{"model": "gpt-4o", "toolCalls": 2}` |
| `queue.media_fetch` | `{"r2Key": "...", "sizeBytes": 45000}` |
| `telegram.send_reply` | `{"statusCode": 200}` |

### Tracer Utility

`src/tracer.ts` — wraps operations with timing, error capture, and span persistence.

**Construction:** Created per-request with bindings, then passed to downstream functions:

```typescript
// In webhook handler or queue processor:
const tracer = new Tracer(env.DB, env.TRACES_KV);

// Wrap any operation:
const result = await tracer.span(traceId, "ai.extract_expense", userId, async () => {
  return extractExpense(...)
}, { model: "gpt-4o-mini" });

// At end of request, flush all spans in a single batch INSERT:
ctx.waitUntil(tracer.flush());
```

**Key behaviors:**
- Spans are accumulated in memory during the request
- `flush()` writes all spans in a single batch `INSERT INTO traces VALUES (...), (...), (...)` — reduces D1 writes from ~5 to ~1 per request
- `flush()` also writes any error spans to KV
- **Fire-and-forget:** `flush()` catches and swallows its own errors — a trace write failure must never cause the actual request to fail
- Uses `ctx.waitUntil()` to flush after the response is sent (same pattern as the existing Agents SDK trace flush)

### Cleanup

Piggyback on the existing hourly cron. Run cleanup once daily (check a flag in KV or just run it hourly — the query is cheap when there's nothing to delete):

```sql
DELETE FROM traces WHERE created_at_utc < datetime('now', '-30 days') LIMIT 500;
```

The `LIMIT 500` prevents large single-statement deletes from hitting D1 execution limits. If more rows exist, the next hourly run picks them up.

KV handles its own cleanup via TTL.

## Debug Queries

**Recent failures (last 24h):**
```sql
SELECT trace_id, span_name, user_id, error_message, created_at_utc
FROM traces WHERE status = 'error'
AND created_at_utc > datetime('now', '-1 day')
ORDER BY created_at_utc DESC;
```

**Full trace timeline:**
```sql
SELECT span_name, duration_ms, status, error_message, metadata
FROM traces WHERE trace_id = ?
ORDER BY started_at_utc;
```

**Average latency by step (last 7 days):**
```sql
SELECT span_name, AVG(duration_ms) as avg_ms, MAX(duration_ms) as max_ms, COUNT(*) as count
FROM traces WHERE created_at_utc > datetime('now', '-7 days')
GROUP BY span_name;
```

**Error-prone users:**
```sql
SELECT user_id, COUNT(*) as error_count
FROM traces WHERE status = 'error'
AND created_at_utc > datetime('now', '-7 days')
GROUP BY user_id ORDER BY error_count DESC;
```

## `gastos:debug` Skill

A Claude Code skill that encodes the debugging playbook. Access method: `wrangler d1 execute` for D1 queries, `wrangler kv key list` for KV error index.

1. Check KV error index (`error:*`) for recent failures
2. If a specific user or trace is mentioned, query D1 for the full trace timeline
3. Run latency aggregation to spot slow steps
4. Present findings structured with trace IDs linked to spans

This ensures future debugging sessions don't need to re-learn the schema or queries.

## What We're NOT Building

- No new external dependencies
- No paid Cloudflare features
- No new API endpoints (use wrangler d1 execute or existing gated debug endpoints)
- No dashboards — SQL queries and Claude analysis are sufficient

## New Files

- `src/tracer.ts` — span utility
- `migrations/NNNN_add_traces.sql` — D1 migration
- `.claude/skills/gastos-debug.md` — debug skill

## New Bindings

- `TRACES_KV` — new KV namespace for error index (add to `wrangler.toml`)
