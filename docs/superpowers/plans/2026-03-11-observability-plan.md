# Observability Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add correlation IDs, latency telemetry, and failure tracking across the Gastos bot using D1 traces and a KV error index.

**Architecture:** A `Tracer` class accumulates spans in memory during a request, then batch-writes them to D1 on flush. Errors also write to a dedicated KV namespace with 7-day TTL. Trace IDs are generated at the webhook and flow through queue messages.

**Tech Stack:** Cloudflare D1 (traces table), KV (error index), TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-03-11-observability-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/tracer.ts` | Tracer class — span timing, batch D1 insert, KV error writes |
| Create | `tests/tracer.test.ts` | Unit tests for Tracer |
| Create | `migrations/0007_add_traces.sql` | D1 migration for traces table |
| Create | `.claude/skills/gastos-debug.md` | Debug skill with queries and playbook |
| Modify | `src/types.ts:51-73` | Add `TRACES_KV` to `Env`, add `traceId?` to `ParseQueueMessage` |
| Modify | `wrangler.toml:13-15` | Add `TRACES_KV` KV namespace binding |
| Modify | `src/routes/webhook.ts:58-144` | Generate traceId, wrap handler with `webhook.receive` span, attach traceId to queue message |
| Modify | `src/queue.ts:11-128` | Read traceId from message body, wrap processing with `queue.receipt` span, wrap media fetch, flush tracer |
| Modify | `src/notifications.ts:12-26` | Add cleanup of old traces (piggyback on cron) |

### Spec Deviations

The spec lists `ai.classify_intent`, `ai.extract_expense`, and `ai.embed` as separate spans. However, the codebase has migrated to the OpenAI Agents SDK, which unified intent classification and expense extraction into a single `run()` call. These are no longer separate operations that can be individually instrumented. The `ai.semantic_chat` span on the agent `run()` call covers what was previously 2-3 separate AI calls. Similarly, `ai.embed` is called internally by agent tools — threading the tracer through tool invocations is deferred to a future iteration to keep this change focused.

The spec also lists `queue.chat` as a span, but the Agents SDK migration unified receipt and chat into a single `processMessage` flow. Only `queue.receipt` is implemented.

---

## Task 1: D1 Migration + Type Changes + Wrangler Config

**Files:**
- Create: `migrations/0007_add_traces.sql`
- Modify: `src/types.ts:51-73`
- Modify: `wrangler.toml:13-15`

- [ ] **Step 1: Create the D1 migration file**

Create `migrations/0007_add_traces.sql`:

```sql
-- Traces table for observability spans
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

- [ ] **Step 2: Add `TRACES_KV` to `Env` type**

In `src/types.ts`, add `TRACES_KV: KVNamespace;` to the `Env` type after the existing `RATE_LIMITER` line:

```typescript
export type Env = {
  APP_ENV: string;
  TELEGRAM_BOT_TOKEN: string;
  VECTORIZE: VectorizeIndex;
  RATE_LIMITER: KVNamespace;
  TRACES_KV: KVNamespace;
  OPENAI_API_KEY?: string;
  OPENAI_TRANSCRIBE_MODEL?: string;
  OPENAI_VISION_MODEL?: string;
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  INGEST_QUEUE: Queue<ParseQueueMessage>;
};
```

- [ ] **Step 3: Add `traceId` to `ParseQueueMessage`**

In `src/types.ts`, add optional `traceId` field:

```typescript
export type ParseQueueMessage = {
  traceId?: string;  // optional for backward compat with in-flight messages
  userId: number;
  telegramId: number;
  timezone: string;
  currency: string;
  tier: "free" | "premium";
  text?: string;
  r2ObjectKey?: string;
  mediaType?: "photo" | "voice";
};
```

- [ ] **Step 4: Add `TRACES_KV` binding to `wrangler.toml`**

Add a new KV namespace block after the existing RATE_LIMITER block. **Note:** You must first create the KV namespace via `npx wrangler kv namespace create TRACES_KV` and use the returned ID.

```toml
[[kv_namespaces]]
binding = "TRACES_KV"
id = "<id-from-wrangler-create>"
```

- [ ] **Step 5: Run type check**

Run: `npm run check`
Expected: PASS (types compile cleanly — `TRACES_KV` won't cause errors in existing code since nothing references it yet)

- [ ] **Step 6: Apply migration locally**

Run: `npx wrangler d1 execute gastos-db --local --file=migrations/0007_add_traces.sql`
Expected: Migration applied successfully

- [ ] **Step 7: Commit**

```bash
git add migrations/0007_add_traces.sql src/types.ts wrangler.toml
git commit -m "feat: add traces table migration, TRACES_KV binding, and traceId to queue message type"
```

---

## Task 2: Tracer Utility (TDD)

**Files:**
- Create: `src/tracer.ts`
- Create: `tests/tracer.test.ts`

- [ ] **Step 1: Write failing tests for Tracer**

Create `tests/tracer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { Tracer } from "../src/tracer";

describe("Tracer", () => {
  let tracer: Tracer;

  beforeEach(() => {
    tracer = new Tracer(env.DB, env.TRACES_KV);
  });

  describe("span()", () => {
    it("returns the callback result on success", async () => {
      const result = await tracer.span("trace-1", "test.op", 1, async () => "hello");
      expect(result).toBe("hello");
    });

    it("re-throws callback errors", async () => {
      await expect(
        tracer.span("trace-1", "test.op", 1, async () => {
          throw new Error("boom");
        })
      ).rejects.toThrow("boom");
    });

    it("accumulates spans in memory", async () => {
      await tracer.span("trace-1", "step.one", 1, async () => "a");
      await tracer.span("trace-1", "step.two", 1, async () => "b");
      expect(tracer.pendingCount).toBe(2);
    });
  });

  describe("flush()", () => {
    it("writes spans to D1 in a batch", async () => {
      await tracer.span("trace-1", "step.one", 1, async () => "a");
      await tracer.span("trace-1", "step.two", 1, async () => "b");
      await tracer.flush();

      const rows = await env.DB.prepare("SELECT * FROM traces WHERE trace_id = ?")
        .bind("trace-1")
        .all();
      expect(rows.results.length).toBe(2);
      expect(rows.results[0].span_name).toBe("step.one");
      expect(rows.results[1].span_name).toBe("step.two");
    });

    it("records duration_ms > 0 for spans that take time", async () => {
      await tracer.span("trace-1", "slow.op", 1, async () => {
        await new Promise((r) => setTimeout(r, 50));
        return "done";
      });
      await tracer.flush();

      const row = await env.DB.prepare("SELECT duration_ms FROM traces WHERE trace_id = ?")
        .bind("trace-1")
        .first<{ duration_ms: number }>();
      expect(row!.duration_ms).toBeGreaterThanOrEqual(40);
    });

    it("records error spans with status='error' and error_message", async () => {
      try {
        await tracer.span("trace-err", "fail.op", 1, async () => {
          throw new Error("something broke");
        });
      } catch {
        // expected
      }
      await tracer.flush();

      const row = await env.DB.prepare("SELECT status, error_message FROM traces WHERE trace_id = ?")
        .bind("trace-err")
        .first<{ status: string; error_message: string }>();
      expect(row!.status).toBe("error");
      expect(row!.error_message).toBe("something broke");
    });

    it("writes error spans to KV with 7-day TTL", async () => {
      try {
        await tracer.span("trace-kv", "fail.op", 42, async () => {
          throw new Error("kv test");
        });
      } catch {
        // expected
      }
      await tracer.flush();

      const kvValue = await env.TRACES_KV.get("error:trace-kv:fail.op", "json") as any;
      expect(kvValue).not.toBeNull();
      expect(kvValue.traceId).toBe("trace-kv");
      expect(kvValue.spanName).toBe("fail.op");
      expect(kvValue.userId).toBe(42);
      expect(kvValue.errorMessage).toBe("kv test");
    });

    it("stores metadata as JSON string", async () => {
      await tracer.span("trace-meta", "ai.extract", 1, async () => "ok", { model: "gpt-4o-mini", tokens: 500 });
      await tracer.flush();

      const row = await env.DB.prepare("SELECT metadata FROM traces WHERE trace_id = ?")
        .bind("trace-meta")
        .first<{ metadata: string }>();
      const meta = JSON.parse(row!.metadata);
      expect(meta.model).toBe("gpt-4o-mini");
      expect(meta.tokens).toBe(500);
    });

    it("is a no-op when no spans are pending", async () => {
      await tracer.flush(); // should not throw
    });

    it("swallows flush errors (fire-and-forget)", async () => {
      // Manually create a tracer with a broken DB stub
      const brokenDb = { prepare: () => { throw new Error("DB down"); } } as any;
      const brokenTracer = new Tracer(brokenDb, env.TRACES_KV);
      await brokenTracer.span("trace-x", "op", 1, async () => "ok");
      // flush should NOT throw
      await brokenTracer.flush();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/tracer.test.ts`
Expected: FAIL — `Cannot find module '../src/tracer'`

- [ ] **Step 3: Implement the Tracer class**

Create `src/tracer.ts`:

```typescript
type Span = {
  traceId: string;
  spanName: string;
  userId: number | null;
  startedAtUtc: string;
  durationMs: number;
  status: "ok" | "error";
  errorMessage: string | null;
  metadata: string | null;
};

// D1 supports max 100 bindings per prepared statement.
// 8 columns per span → max 12 spans per batch INSERT.
const MAX_SPANS_PER_BATCH = 12;

// KV free tier: 1,000 writes/day. Stop writing errors to KV after this threshold.
const MAX_KV_ERROR_WRITES = 500;

export class Tracer {
  private db: D1Database;
  private kv: KVNamespace;
  private spans: Span[] = [];
  private kvErrorCount = 0;

  constructor(db: D1Database, kv: KVNamespace) {
    this.db = db;
    this.kv = kv;
  }

  get pendingCount(): number {
    return this.spans.length;
  }

  async span<T>(
    traceId: string,
    spanName: string,
    userId: number | null,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>,
  ): Promise<T> {
    const startedAt = new Date();
    let status: "ok" | "error" = "ok";
    let errorMessage: string | null = null;

    try {
      const result = await fn();
      return result;
    } catch (err) {
      status = "error";
      errorMessage = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      const durationMs = Date.now() - startedAt.getTime();
      this.spans.push({
        traceId,
        spanName,
        userId,
        startedAtUtc: startedAt.toISOString(),
        durationMs,
        status,
        errorMessage,
        metadata: metadata ? JSON.stringify(metadata) : null,
      });
    }
  }

  async flush(): Promise<void> {
    try {
      if (this.spans.length === 0) return;

      const toFlush = this.spans.splice(0);

      // Batch INSERT into D1, chunked to stay under 100-binding limit
      for (let i = 0; i < toFlush.length; i += MAX_SPANS_PER_BATCH) {
        const chunk = toFlush.slice(i, i + MAX_SPANS_PER_BATCH);
        const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
        const values = chunk.flatMap((s) => [
          s.traceId,
          s.spanName,
          s.userId,
          s.startedAtUtc,
          s.durationMs,
          s.status,
          s.errorMessage,
          s.metadata,
        ]);

        await this.db
          .prepare(
            `INSERT INTO traces (trace_id, span_name, user_id, started_at_utc, duration_ms, status, error_message, metadata)
             VALUES ${placeholders}`,
          )
          .bind(...values)
          .run();
      }

      // Write error spans to KV (with storm safety — stop after MAX_KV_ERROR_WRITES)
      const errorSpans = toFlush.filter((s) => s.status === "error");
      if (errorSpans.length > 0 && this.kvErrorCount < MAX_KV_ERROR_WRITES) {
        await Promise.allSettled(
          errorSpans.map((s) => {
            this.kvErrorCount++;
            return this.kv.put(
              `error:${s.traceId}:${s.spanName}`,
              JSON.stringify({
                traceId: s.traceId,
                spanName: s.spanName,
                userId: s.userId,
                errorMessage: s.errorMessage,
                timestamp: s.startedAtUtc,
              }),
              { expirationTtl: 7 * 24 * 60 * 60 },
            );
          }),
        );
      }
    } catch {
      // Fire-and-forget: never let trace persistence break the actual request
    }
  }
}
```

**Design notes:**
- **D1 chunking:** Max 12 spans per batch INSERT (100 bindings / 8 columns). Typical flows produce 4-5 spans, well under the limit.
- **KV error storm safety:** Per-instance counter stops KV writes after 500 errors. Since each Worker instance is short-lived, this provides reasonable per-invocation protection.
- **KV key format:** `error:{traceId}:{spanName}` avoids collisions when multiple spans in the same trace fail.

- [ ] **Step 4: Add TRACES_KV to test config**

Check `vitest.config.ts` (or `wrangler.toml` test section) and ensure `TRACES_KV` is available in the test environment. In `vitest.config.ts`, add the KV binding to the miniflare config:

```typescript
// Inside the miniflare config, add:
kvNamespaces: ["TRACES_KV"],
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- tests/tracer.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 6: Run full suite to verify no regressions**

Run: `npm run check && npm run test`
Expected: Type check PASS, all tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/tracer.ts tests/tracer.test.ts vitest.config.ts
git commit -m "feat: add Tracer class with batch D1 writes and KV error index"
```

---

## Task 3: Webhook Instrumentation

**Files:**
- Modify: `src/routes/webhook.ts:58-144`

- [ ] **Step 1: Import Tracer and generate traceId at top of webhook handler**

In `handleTelegramWebhook`, at the top (after JSON parsing and validation), add:

```typescript
import { Tracer } from "../tracer";

// Inside handleTelegramWebhook, after payload validation:
const traceId = crypto.randomUUID();
const tracer = new Tracer(c.env.DB, c.env.TRACES_KV);
```

- [ ] **Step 2: Wrap the full handler body with `webhook.receive` span**

Wrap the main handler logic (from `const update` through the return) in a tracer span. The webhook handler doesn't have `ctx.waitUntil()` directly (it's a Hono route), so use `c.executionCtx.waitUntil(tracer.flush())` before returning.

The key changes:
1. Wrap the entire handler body after validation in `tracer.span(traceId, "webhook.receive", ...)`
2. For the command path (when `handleOnboardingOrCommand` returns true), record `webhook.command` as a nested span
3. For the media upload, wrap it in `webhook.media_upload` span
4. Attach `traceId` to the queue message

```typescript
// After validation, determine userId early for the span:
const update = payload.data as TelegramUpdate;
const userId = update.message?.from?.id ?? update.callback_query?.from?.id ?? null;

return await tracer.span(traceId, "webhook.receive", userId, async () => {
  const handled = await handleOnboardingOrCommand(c.env, update);
  if (handled) {
    c.executionCtx.waitUntil(tracer.flush());
    return c.json({ status: "handled", message: "Message handled by command/onboarding flow" }, 200);
  }

  // ... existing code for expense ingestion ...

  // In the media upload try block:
  uploadedR2ObjectKey = await tracer.span(traceId, "webhook.media_upload", user.id, async () => {
    return uploadTelegramMediaToR2(c.env, update, sourceEvent.id);
  });

  // Attach traceId to queue message:
  const queueMessage: ParseQueueMessage = {
    traceId,
    userId: user.id,
    // ... rest of existing fields
  };

  // Before returning:
  c.executionCtx.waitUntil(tracer.flush());
  return c.json(...);
}, { messageType: update.message?.photo ? "photo" : update.message?.voice ? "voice" : "text" });
```

- [ ] **Step 3: Run type check and tests**

Run: `npm run check && npm run test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/routes/webhook.ts
git commit -m "feat: instrument webhook handler with trace spans"
```

---

## Task 4: Queue Instrumentation

**Files:**
- Modify: `src/queue.ts:11-128`

- [ ] **Step 1: Import Tracer and read traceId from message body**

At the top of `handleParseQueueBatch`, create a tracer per message and read the traceId with fallback:

```typescript
import { Tracer } from "./tracer";

// Inside the for loop in handleParseQueueBatch:
const traceId = message.body.traceId ?? crypto.randomUUID();
const tracer = new Tracer(env.DB, env.TRACES_KV);
```

- [ ] **Step 2: Wrap `processMessage` with the top-level queue span**

Determine span name based on message content (`queue.receipt` for all messages currently, since the queue only does receipt processing now — but future-proof by checking):

```typescript
for (const message of batch.messages) {
  const traceId = message.body.traceId ?? crypto.randomUUID();
  const tracer = new Tracer(env.DB, env.TRACES_KV);
  try {
    await tracer.span(traceId, "queue.receipt", message.body.userId, async () => {
      await processMessage(env, ctx, message.body, tracer, traceId);
    });
    message.ack();
  } catch (error) {
    console.error("Queue message processing failed", {
      traceId,
      userId: message.body.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    message.retry();
  } finally {
    ctx.waitUntil(tracer.flush());
  }
}
```

- [ ] **Step 3: Update `processMessage` signature to accept tracer and traceId**

```typescript
async function processMessage(
  env: Env,
  ctx: ExecutionContext,
  body: ParseQueueMessage,
  tracer: Tracer,
  traceId: string,
): Promise<void> {
```

- [ ] **Step 4: Wrap media fetch with `queue.media_fetch` span**

In processMessage, where R2 media is fetched for photo processing (lines 67-74):

```typescript
const object = await tracer.span(traceId, "queue.media_fetch", userId, async () => {
  return env.MEDIA_BUCKET.get(body.r2ObjectKey!);
}, { r2Key: body.r2ObjectKey });
```

- [ ] **Step 5: Wrap voice transcription with `ai.transcribe` span**

```typescript
const transcript = await tracer.span(traceId, "ai.transcribe", userId, async () => {
  return transcribeR2Audio(env, body.r2ObjectKey!);
});
```

- [ ] **Step 6: Wrap agent run with `ai.semantic_chat` span**

```typescript
result = await tracer.span(traceId, "ai.semantic_chat", userId, async () => {
  return run(agent, agentInput, { session, maxTurns: 10 });
}, { model: "gpt-5-mini" });
```

- [ ] **Step 7: Wrap Telegram reply with `telegram.send_reply` span**

```typescript
await tracer.span(traceId, "telegram.send_reply", userId, async () => {
  await sendTelegramChatMessage(env, telegramId, reply);
});
```

- [ ] **Step 8: Run type check and tests**

Run: `npm run check && npm run test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/queue.ts
git commit -m "feat: instrument queue processor with trace spans"
```

---

## Task 5: Trace Cleanup in Cron

**Files:**
- Modify: `src/notifications.ts:12-26`

- [ ] **Step 1: Add trace cleanup function**

Add at the bottom of `src/notifications.ts` (or create a small `src/trace-cleanup.ts` — but since it's 5 lines, keeping it with the cron logic is simpler):

```typescript
export async function cleanupOldTraces(db: D1Database): Promise<void> {
  await db
    .prepare(
      "DELETE FROM traces WHERE id IN (SELECT id FROM traces WHERE created_at_utc < datetime('now', '-30 days') LIMIT 500)"
    )
    .run();
}
```

- [ ] **Step 2: Call cleanup from the scheduled handler**

In `src/index.ts`, add the cleanup call alongside notifications:

```typescript
// Merge with existing import:
import { dispatchNotifications, cleanupOldTraces } from "./notifications";

// In the scheduled handler:
scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
  ctx.waitUntil(dispatchNotifications(env, new Date()));
  ctx.waitUntil(cleanupOldTraces(env.DB));
}
```

- [ ] **Step 3: Run type check and tests**

Run: `npm run check && npm run test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/notifications.ts src/index.ts
git commit -m "feat: add daily trace cleanup in cron handler"
```

---

## Task 6: Debug Skill

**Files:**
- Create: `.claude/skills/gastos-debug.md`

- [ ] **Step 1: Create the debug skill**

Create `.claude/skills/gastos-debug.md`:

```markdown
---
name: gastos-debug
description: Debug Gastos bot issues using D1 traces and KV error index. Use when investigating user-reported problems, failed interactions, or slow performance.
---

# Gastos Debug Playbook

## Quick Triage: Recent Errors (KV)

Run this first to see what broke recently (last 7 days auto-expire):

\`\`\`bash
npx wrangler kv key list --binding=TRACES_KV --prefix="error:"
\`\`\`

To read a specific error:
\`\`\`bash
npx wrangler kv key get --binding=TRACES_KV "error:<trace-id>"
\`\`\`

## D1 Queries

### Recent failures (last 24h)
\`\`\`bash
npx wrangler d1 execute gastos-db --command="SELECT trace_id, span_name, user_id, error_message, created_at_utc FROM traces WHERE status = 'error' AND created_at_utc > datetime('now', '-1 day') ORDER BY created_at_utc DESC;"
\`\`\`

### Full trace timeline for a specific trace
\`\`\`bash
npx wrangler d1 execute gastos-db --command="SELECT span_name, duration_ms, status, error_message, metadata FROM traces WHERE trace_id = '<TRACE_ID>' ORDER BY started_at_utc;"
\`\`\`

### Average latency by step (last 7 days)
\`\`\`bash
npx wrangler d1 execute gastos-db --command="SELECT span_name, ROUND(AVG(duration_ms)) as avg_ms, MAX(duration_ms) as max_ms, COUNT(*) as count FROM traces WHERE created_at_utc > datetime('now', '-7 days') GROUP BY span_name ORDER BY avg_ms DESC;"
\`\`\`

### Error-prone users
\`\`\`bash
npx wrangler d1 execute gastos-db --command="SELECT user_id, COUNT(*) as error_count FROM traces WHERE status = 'error' AND created_at_utc > datetime('now', '-7 days') GROUP BY user_id ORDER BY error_count DESC;"
\`\`\`

### Slowest traces (last 24h)
\`\`\`bash
npx wrangler d1 execute gastos-db --command="SELECT trace_id, SUM(duration_ms) as total_ms, GROUP_CONCAT(span_name, ' -> ') as flow FROM traces WHERE created_at_utc > datetime('now', '-1 day') GROUP BY trace_id ORDER BY total_ms DESC LIMIT 10;"
\`\`\`

## Debugging Workflow

1. **Start with KV** — `kv key list` to see recent errors
2. **Get trace details** — use the trace_id from KV to pull the full D1 timeline
3. **Check latency** — run the avg latency query to spot systemic slowdowns
4. **Check error patterns** — look for repeated span_names in errors (e.g., all errors on `ai.extract_expense` suggests OpenAI issue)
5. **Check user patterns** — if one user has many errors, check their specific traces

## Schema Reference

Table: `traces`
- `trace_id` TEXT — correlation ID (UUID)
- `span_name` TEXT — e.g. `webhook.receive`, `queue.receipt`, `ai.extract_expense`
- `user_id` INTEGER — nullable
- `started_at_utc` TEXT — ISO 8601 with ms
- `duration_ms` INTEGER
- `status` TEXT — `ok` or `error`
- `error_message` TEXT — null if ok
- `metadata` TEXT — JSON string with span-specific context
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/gastos-debug.md
git commit -m "feat: add gastos-debug skill with trace queries and playbook"
```

---

## Task 7: Final Verification

- [ ] **Step 1: Run full verification**

Run: `npm run check && npm run test`
Expected: Type check PASS, all tests PASS (existing + new tracer tests)

- [ ] **Step 2: Manual smoke test**

Run: `npm run dev`

Send a test message to the bot locally and verify:
1. Check D1 for trace rows: `npx wrangler d1 execute gastos-db --local --command="SELECT * FROM traces ORDER BY id DESC LIMIT 10;"`
2. Verify spans have trace_id, duration_ms, and correct span_names

- [ ] **Step 3: Final commit if any fixups needed**
