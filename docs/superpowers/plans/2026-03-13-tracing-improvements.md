# Tracing Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve tracing observability to identify latency bottlenecks — fill coverage gaps, eliminate conditional boilerplate, add queue wait time tracking, and add debug endpoints for querying trace data.

**Architecture:** Extract an `ITracer` interface from the existing `Tracer` class, add a no-op implementation to eliminate all `if (tracer) { ... } else { ... }` branching. Add a `record()` method for pre-computed durations (queue wait time). Wrap all untraced operations in both webhook and queue handlers. Add debug endpoints that query the existing D1 `traces` table.

**Tech Stack:** TypeScript, Cloudflare D1, KV, Hono, Vitest + @cloudflare/vitest-pool-workers

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/tracer.ts` | Add `ITracer` interface, `record()` method, `noopTracer`, `createTracer()` factory |
| Modify | `tests/tracer.test.ts` | Tests for `record()`, `noopTracer`, `createTracer()` |
| Modify | `src/routes/webhook.ts` | Remove conditional branching, add missing spans |
| Modify | `src/queue.ts` | Remove conditional branching, add missing spans, queue wait time |
| Modify | `src/types.ts` | Add `enqueuedAtUtc` to `ParseQueueMessage` |
| Modify | `src/app.ts` | Add debug trace endpoints |
| Create | `tests/debug-traces.test.ts` | Tests for debug trace endpoints |

---

## Chunk 1: Tracer Improvements + Refactoring

### Task 1: ITracer type + NoopTracer + createTracer factory + record() method

**Files:**
- Modify: `src/tracer.ts`
- Modify: `tests/tracer.test.ts`

- [ ] **Step 1: Write failing tests for `record()`, `noopTracer`, and `createTracer()`**

Add these tests to the bottom of the existing `describe("Tracer", ...)` block in `tests/tracer.test.ts`:

```typescript
import { Tracer, createTracer, noopTracer } from "../src/tracer";
import type { ITracer } from "../src/tracer";

// Add inside the existing describe("Tracer") block, after describe("flush()"):

  describe("record()", () => {
    it("records a pre-computed span without executing a function", async () => {
      tracer.record("trace-rec", "queue.wait_time", 1, 250, { source: "test" });
      expect(tracer.pendingCount).toBe(1);
      await tracer.flush();

      const row = await env.DB.prepare("SELECT * FROM traces WHERE trace_id = ?")
        .bind("trace-rec")
        .first<{ span_name: string; duration_ms: number; status: string; metadata: string }>();
      expect(row!.span_name).toBe("queue.wait_time");
      expect(row!.duration_ms).toBe(250);
      expect(row!.status).toBe("ok");
      expect(JSON.parse(row!.metadata).source).toBe("test");
    });
  });

// Add a new top-level describe block after the Tracer block:

describe("noopTracer", () => {
  it("executes the function and returns its result", async () => {
    const result = await noopTracer.span("t", "op", null, async () => 42);
    expect(result).toBe(42);
  });

  it("does not accumulate spans", async () => {
    await noopTracer.span("t", "op", null, async () => "ok");
    expect(noopTracer.pendingCount).toBe(0);
  });

  it("flush is a no-op", async () => {
    await noopTracer.flush(); // should not throw
  });

  it("record is a no-op", () => {
    noopTracer.record("t", "op", null, 100);
    expect(noopTracer.pendingCount).toBe(0);
  });
});

describe("createTracer()", () => {
  it("returns a real Tracer when KV is provided", () => {
    const t = createTracer(env.DB, env.TRACES_KV);
    expect(t).toBeInstanceOf(Tracer);
  });

  it("returns noopTracer when KV is not provided", () => {
    const t = createTracer(env.DB);
    expect(t).toBe(noopTracer);
  });

  it("returns noopTracer when KV is undefined", () => {
    const t = createTracer(env.DB, undefined);
    expect(t).toBe(noopTracer);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/tracer.test.ts`
Expected: FAIL — `noopTracer` and `createTracer` are not exported from `../src/tracer`, `record` is not a method on `Tracer`

- [ ] **Step 3: Add `record()` method, `ITracer` type, `noopTracer`, and `createTracer()` to `src/tracer.ts`**

At the bottom of the existing `Tracer` class (after the `flush()` method, before the closing `}`), add the `record()` method:

```typescript
  /** Records a pre-computed span (e.g. queue wait time) without executing a function. */
  record(
    traceId: string,
    spanName: string,
    userId: number | null,
    durationMs: number,
    metadata?: Record<string, unknown>,
  ): void {
    this.spans.push({
      traceId,
      spanName,
      userId,
      startedAtUtc: new Date(Date.now() - durationMs).toISOString(),
      durationMs,
      status: "ok",
      errorMessage: null,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });
  }
```

After the `Tracer` class closing brace, add:

```typescript
/** Interface shared by Tracer and noopTracer. Explicit interface (not Pick) to preserve generic <T> on span(). */
export interface ITracer {
  span<T>(
    traceId: string,
    spanName: string,
    userId: number | null,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>,
  ): Promise<T>;
  flush(): Promise<void>;
  readonly pendingCount: number;
  record(
    traceId: string,
    spanName: string,
    userId: number | null,
    durationMs: number,
    metadata?: Record<string, unknown>,
  ): void;
}

/** No-op tracer that executes functions without recording. */
export const noopTracer: ITracer = {
  async span<T>(
    _traceId: string,
    _spanName: string,
    _userId: number | null,
    fn: () => Promise<T>,
    _metadata?: Record<string, unknown>,
  ): Promise<T> {
    return fn();
  },
  async flush() {},
  get pendingCount() {
    return 0;
  },
  record() {},
};

/** Creates a Tracer if KV is available, otherwise returns noopTracer. */
export function createTracer(db: D1Database, kv?: KVNamespace): ITracer {
  return kv ? new Tracer(db, kv) : noopTracer;
}
```

**Why explicit interface instead of `Pick<Tracer, ...>`?** TypeScript's `Pick` loses the generic type parameter `<T>` on `span()`, widening the return type to `Promise<unknown>`. An explicit interface preserves full generic inference at all call sites.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/tracer.test.ts`
Expected: All tests PASS (existing 11 + new 8 = 19)

- [ ] **Step 5: Run full suite**

Run: `npm run check && npm run test`
Expected: PASS

- [ ] **Step 6: Commit**

```
feat: add ITracer type, noopTracer, createTracer factory, and record() method
```

---

### Task 2: Remove conditional tracer branching in webhook.ts

**Files:**
- Modify: `src/routes/webhook.ts`

The current code has verbose `if (tracer) { await tracer.span(...) } else { await doThing() }` blocks. After this task, every operation uses `tracer.span()` directly — the noopTracer handles the "no tracing" case.

- [ ] **Step 1: Replace tracer initialization**

In `src/routes/webhook.ts`, change the imports and tracer creation (lines 9, 71-72):

Old:
```typescript
import { Tracer } from "../tracer";
// ...
const traceId = crypto.randomUUID();
const tracer = c.env.TRACES_KV ? new Tracer(c.env.DB, c.env.TRACES_KV) : null;
```

New:
```typescript
import { createTracer } from "../tracer";
// ...
const traceId = crypto.randomUUID();
const tracer = createTracer(c.env.DB, c.env.TRACES_KV);
```

- [ ] **Step 2: Simplify the media upload span (lines 136-154)**

Old:
```typescript
if (!sourceEvent.duplicate) {
  try {
    if (tracer) {
      uploadedR2ObjectKey = await tracer.span(traceId, "webhook.media_upload", user.id, async () => {
        return uploadTelegramMediaToR2(c.env, update, sourceEvent.id);
      });
    } else {
      uploadedR2ObjectKey = await uploadTelegramMediaToR2(c.env, update, sourceEvent.id);
    }
    // ...
```

New:
```typescript
if (!sourceEvent.duplicate) {
  try {
    uploadedR2ObjectKey = await tracer.span(traceId, "webhook.media_upload", user.id, async () => {
      return uploadTelegramMediaToR2(c.env, update, sourceEvent.id);
    });
    // ...
```

- [ ] **Step 3: Simplify the main handler wrapping and flush (lines 188-196)**

Old:
```typescript
  if (tracer) {
    const userId = payload.data.message?.from?.id ?? payload.data.callback_query?.from?.id ?? null;
    const messageType = payload.data.message?.photo ? "photo" : payload.data.message?.voice ? "voice" : "text";
    const response = await tracer.span(traceId, "webhook.receive", userId, handleValidPayload, { messageType });
    c.executionCtx.waitUntil(tracer.flush());
    return response;
  } else {
    return handleValidPayload();
  }
```

New:
```typescript
  const userId = payload.data.message?.from?.id ?? payload.data.callback_query?.from?.id ?? null;
  const messageType = payload.data.message?.photo ? "photo" : payload.data.message?.voice ? "voice" : "text";
  const response = await tracer.span(traceId, "webhook.receive", userId, handleValidPayload, { messageType });
  try {
    c.executionCtx.waitUntil(tracer.flush());
  } catch {
    // No ExecutionContext in tests — flush is best-effort
  }
  return response;
```

- [ ] **Step 4: Run tests**

Run: `npm run check && npm run test`
Expected: PASS — webhook tests don't set `TRACES_KV`, so `createTracer()` returns `noopTracer`, behavior unchanged

- [ ] **Step 5: Commit**

```
refactor: remove conditional tracer branching in webhook handler
```

---

### Task 3: Remove conditional tracer branching in queue.ts

**Files:**
- Modify: `src/queue.ts`

- [ ] **Step 1: Replace tracer initialization and simplify**

Change imports:
```typescript
import { createTracer } from "./tracer";
```

In `handleParseQueueBatch`, replace:
```typescript
const tracer = env.TRACES_KV ? new Tracer(env.DB, env.TRACES_KV) : null;
```
with:
```typescript
const tracer = createTracer(env.DB, env.TRACES_KV);
```

Replace the conditional queue.receipt wrapping (lines 20-27):
```typescript
    try {
      await tracer.span(traceId, "queue.receipt", message.body.userId, async () => {
        await processMessage(env, ctx, message.body, tracer, traceId);
      });
      message.ack();
```

Replace the conditional flush (lines 36-39):
```typescript
    } finally {
      ctx.waitUntil(tracer.flush());
    }
```

- [ ] **Step 2: Update `processMessage` signature**

Add the type import at the top of `src/queue.ts`:
```typescript
import type { ITracer } from "./tracer";
```

Then change:
```typescript
async function processMessage(
  env: Env,
  ctx: ExecutionContext,
  body: ParseQueueMessage,
  tracer: Tracer | null,
  traceId: string,
): Promise<void> {
```
to:
```typescript
async function processMessage(
  env: Env,
  ctx: ExecutionContext,
  body: ParseQueueMessage,
  tracer: ITracer,
  traceId: string,
): Promise<void> {
```

- [ ] **Step 3: Remove all conditional span wrapping inside processMessage**

For each of the 4 traced operations (voice transcription, media fetch, agent run, telegram reply), remove the `if (tracer) { ... } else { ... }` pattern and just use `tracer.span(...)` directly.

For example, voice transcription (lines 76-82):

Old:
```typescript
    if (tracer) {
      transcript = await tracer.span(traceId, "ai.transcribe", userId, async () => {
        return transcribeR2Audio(env, body.r2ObjectKey!);
      });
    } else {
      transcript = await transcribeR2Audio(env, body.r2ObjectKey);
    }
```

New:
```typescript
    transcript = await tracer.span(traceId, "ai.transcribe", userId, async () => {
      return transcribeR2Audio(env, body.r2ObjectKey!);
    });
```

Apply the same pattern to: `queue.media_fetch` (lines 91-97), `ai.semantic_chat` (lines 145-149), `telegram.send_reply` (lines 164-170).

- [ ] **Step 4: Run tests**

Run: `npm run check && npm run test`
Expected: PASS

- [ ] **Step 5: Commit**

```
refactor: remove conditional tracer branching in queue processor
```

---

## Chunk 2: Fill Coverage Gaps + Debug Endpoints

### Task 4: Add missing webhook spans

**Files:**
- Modify: `src/routes/webhook.ts`

These operations happen inside `handleValidPayload()` which is already wrapped by `webhook.receive`. They will share the same `traceId`. The tracer's flat span model means they appear as siblings — the timestamp ordering shows the actual sequence.

- [ ] **Step 1: Wrap `handleOnboardingOrCommand` (line 76)**

Old:
```typescript
    const handled = await handleOnboardingOrCommand(c.env, update);
```

New:
```typescript
    const handled = await tracer.span(traceId, "webhook.onboarding", userId, async () => {
      return handleOnboardingOrCommand(c.env, update);
    });
```

Note: `userId` here is the Telegram user ID (`update.message?.from?.id`), not the internal user.id. That's fine — it's set at the top of the handler before user lookup.

- [ ] **Step 2: Wrap `upsertUserForIngestion` (line 95)**

Old:
```typescript
    const user = await upsertUserForIngestion(c.env, telegramUserId, chatId);
```

New:
```typescript
    const user = await tracer.span(traceId, "webhook.user_upsert", userId, async () => {
      return upsertUserForIngestion(c.env, telegramUserId, chatId);
    });
```

- [ ] **Step 3: Wrap `checkRateLimit` (line 98)**

Old:
```typescript
    const allowed = await checkRateLimit(c.env, telegramUserId);
```

New:
```typescript
    const allowed = await tracer.span(traceId, "webhook.rate_limit", userId, async () => {
      return checkRateLimit(c.env, telegramUserId);
    });
```

- [ ] **Step 4: Wrap `findRecentDuplicateContent` (lines 118-121)**

Old:
```typescript
      const recentDuplicateId = await findRecentDuplicateContent(
        c.env.DB,
        user.id,
        update.message.text,
      );
```

New:
```typescript
      const recentDuplicateId = await tracer.span(traceId, "webhook.dedup_check", user.id, async () => {
        return findRecentDuplicateContent(c.env.DB, user.id, update.message.text!);
      });
```

- [ ] **Step 5: Wrap `persistSourceEvent` (line 133)**

Old:
```typescript
    const sourceEvent = await persistSourceEvent(c.env, user.id, update);
```

New:
```typescript
    const sourceEvent = await tracer.span(traceId, "webhook.source_event", user.id, async () => {
      return persistSourceEvent(c.env, user.id, update);
    });
```

- [ ] **Step 6: Wrap `INGEST_QUEUE.send()` (line 177)**

Old:
```typescript
    if (!sourceEvent.duplicate) {
      await c.env.INGEST_QUEUE.send(queueMessage);
    }
```

New:
```typescript
    if (!sourceEvent.duplicate) {
      await tracer.span(traceId, "webhook.queue_enqueue", user.id, async () => {
        await c.env.INGEST_QUEUE.send(queueMessage);
      });
    }
```

- [ ] **Step 7: Run tests**

Run: `npm run check && npm run test`
Expected: PASS — webhook tests use noopTracer (no TRACES_KV), so wrapping calls in spans doesn't change behavior

- [ ] **Step 8: Commit**

```
feat: add missing trace spans to webhook handler
```

---

### Task 5: Add missing queue spans + queue wait time

**Files:**
- Modify: `src/types.ts`
- Modify: `src/routes/webhook.ts` (set `enqueuedAtUtc`)
- Modify: `src/queue.ts`

- [ ] **Step 1: Add `enqueuedAtUtc` to `ParseQueueMessage`**

In `src/types.ts`, add to the `ParseQueueMessage` type:

```typescript
export type ParseQueueMessage = {
  traceId?: string;
  enqueuedAtUtc?: string;  // ISO 8601 timestamp for queue wait time tracking
  userId: number;
  // ... rest unchanged
};
```

- [ ] **Step 2: Set `enqueuedAtUtc` when building queue message in webhook.ts**

In `src/routes/webhook.ts`, where `queueMessage` is built (around line 164):

```typescript
    const queueMessage: ParseQueueMessage = {
      traceId,
      enqueuedAtUtc: new Date().toISOString(),
      userId: user.id,
      // ... rest unchanged
    };
```

- [ ] **Step 3: Record queue wait time in queue.ts**

In `processMessage()`, add this immediately after the destructuring line (`const { userId, telegramId, ... } = body;`), before the quota check:

```typescript
  // Record queue wait time (time between webhook enqueue and queue dequeue)
  if (body.enqueuedAtUtc) {
    const waitMs = Date.now() - new Date(body.enqueuedAtUtc).getTime();
    tracer.record(traceId, "queue.wait_time", userId, waitMs);
  }
```

- [ ] **Step 4: Wrap `checkAndRefreshTokenQuota` (line 54)**

Old:
```typescript
  const allowed = await checkAndRefreshTokenQuota(env.DB, userId, telegramId, tier);
```

New:
```typescript
  const allowed = await tracer.span(traceId, "queue.quota_check", userId, async () => {
    return checkAndRefreshTokenQuota(env.DB, userId, telegramId, tier);
  });
```

- [ ] **Step 5: Wrap `sendChatAction` (line 68)**

Old:
```typescript
  await sendChatAction(env, telegramId, "typing");
```

New:
```typescript
  await tracer.span(traceId, "queue.typing_indicator", userId, async () => {
    await sendChatAction(env, telegramId, "typing");
  });
```

- [ ] **Step 6: Wrap `incrementTokenUsage` (line 159)**

Old:
```typescript
  if (totalTokens > 0) {
    await incrementTokenUsage(env.DB, userId, totalTokens);
  }
```

New:
```typescript
  if (totalTokens > 0) {
    await tracer.span(traceId, "queue.token_increment", userId, async () => {
      await incrementTokenUsage(env.DB, userId, totalTokens);
    });
  }
```

- [ ] **Step 7: Run tests**

Run: `npm run check && npm run test`
Expected: PASS

- [ ] **Step 8: Commit**

```
feat: add queue wait time tracking and missing queue trace spans
```

---

### Task 6: Add debug trace endpoints

**Files:**
- Modify: `src/app.ts`
- Create: `tests/debug-traces.test.ts`

- [ ] **Step 1: Write failing tests for debug trace endpoints**

Create `tests/debug-traces.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { createApp } from "../src/app";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    APP_ENV: string;
  }
}

describe("debug trace endpoints", () => {
  const app = createApp();

  beforeAll(async () => {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS traces (id INTEGER PRIMARY KEY AUTOINCREMENT, trace_id TEXT NOT NULL, span_name TEXT NOT NULL, user_id INTEGER, started_at_utc TEXT NOT NULL, duration_ms INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ok', error_message TEXT, metadata TEXT, created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));"
    );

    // Seed test data: two traces
    await env.DB.prepare(
      `INSERT INTO traces (trace_id, span_name, user_id, started_at_utc, duration_ms, status, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind("trace-aaa", "webhook.receive", 1, "2026-03-13T10:00:00Z", 450, "ok", '{"messageType":"text"}').run();

    await env.DB.prepare(
      `INSERT INTO traces (trace_id, span_name, user_id, started_at_utc, duration_ms, status, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind("trace-aaa", "ai.semantic_chat", 1, "2026-03-13T10:00:01Z", 3200, "ok", '{"model":"gpt-5-mini"}').run();

    await env.DB.prepare(
      `INSERT INTO traces (trace_id, span_name, user_id, started_at_utc, duration_ms, status, error_message, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind("trace-bbb", "webhook.receive", 2, "2026-03-13T10:05:00Z", 500, "ok", null, null).run();

    await env.DB.prepare(
      `INSERT INTO traces (trace_id, span_name, user_id, started_at_utc, duration_ms, status, error_message, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind("trace-bbb", "ai.semantic_chat", 2, "2026-03-13T10:05:01Z", 5000, "error", "timeout", null).run();
  });

  function makeEnv() {
    return { ...env, APP_ENV: "development" } as any;
  }

  describe("GET /debug/traces/:traceId", () => {
    it("returns all spans for a trace ordered by time", async () => {
      const res = await app.fetch(
        new Request("http://localhost/debug/traces/trace-aaa"),
        makeEnv(),
      );
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.traceId).toBe("trace-aaa");
      expect(body.spans).toHaveLength(2);
      expect(body.spans[0].span_name).toBe("webhook.receive");
      expect(body.spans[1].span_name).toBe("ai.semantic_chat");
      expect(body.sumMs).toBe(3650);
    });

    it("returns empty spans for unknown trace", async () => {
      const res = await app.fetch(
        new Request("http://localhost/debug/traces/trace-zzz"),
        makeEnv(),
      );
      const body = await res.json() as any;
      expect(body.spans).toHaveLength(0);
    });
  });

  describe("GET /debug/traces/summary", () => {
    it("returns aggregated latency stats per span name", async () => {
      const res = await app.fetch(
        new Request("http://localhost/debug/traces/summary"),
        makeEnv(),
      );
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.spans.length).toBeGreaterThanOrEqual(2);

      const webhookSpan = body.spans.find((s: any) => s.span_name === "webhook.receive");
      expect(webhookSpan).toBeDefined();
      expect(webhookSpan.count).toBe(2);
      expect(webhookSpan.avg_ms).toBe(475); // (450 + 500) / 2
      expect(webhookSpan.max_ms).toBe(500);
      expect(webhookSpan.min_ms).toBe(450);
    });
  });

  describe("GET /debug/traces/recent", () => {
    it("returns recent traces grouped by trace_id", async () => {
      const res = await app.fetch(
        new Request("http://localhost/debug/traces/recent"),
        makeEnv(),
      );
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.traces.length).toBeGreaterThanOrEqual(2);

      const first = body.traces[0]; // most recent
      expect(first.trace_id).toBeDefined();
      expect(first.span_count).toBeGreaterThanOrEqual(1);
      expect(first.total_ms).toBeGreaterThan(0);
      expect(first.flow).toContain("webhook.receive");
    });
  });

  it("returns 404 in non-development environment", async () => {
    const res = await app.fetch(
      new Request("http://localhost/debug/traces/summary"),
      { ...env, APP_ENV: "production" } as any,
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/debug-traces.test.ts`
Expected: FAIL — 404 because the routes don't exist yet

- [ ] **Step 3: Add debug trace endpoints to `src/app.ts`**

Add these routes inside the debug section (after the existing `/debug/chat-history` endpoint, before the `// ── END DEBUG ENDPOINTS` comment):

```typescript
  app.get("/debug/traces/summary", async (c) => {
    const hours = Math.max(1, parseInt(c.req.query("hours") ?? "24") || 24);
    const { results } = await c.env.DB.prepare(
      `SELECT
        span_name,
        COUNT(*) as count,
        CAST(AVG(duration_ms) AS INTEGER) as avg_ms,
        MIN(duration_ms) as min_ms,
        MAX(duration_ms) as max_ms
      FROM traces
      WHERE created_at_utc > datetime('now', '-' || ? || ' hours')
      GROUP BY span_name
      ORDER BY avg_ms DESC`
    ).bind(hours).all();
    return c.json({ hours, spans: results });
  });

  app.get("/debug/traces/recent", async (c) => {
    const limit = Math.min(parseInt(c.req.query("limit") ?? "20"), 100);
    const { results } = await c.env.DB.prepare(
      `SELECT
        trace_id,
        COUNT(*) as span_count,
        SUM(duration_ms) as total_ms,
        MIN(started_at_utc) as started_at,
        GROUP_CONCAT(span_name, ' -> ') as flow
      FROM traces
      WHERE created_at_utc > datetime('now', '-24 hours')
      GROUP BY trace_id
      ORDER BY started_at DESC
      LIMIT ?`
    ).bind(limit).all();
    return c.json({ traces: results });
  });

  app.get("/debug/traces/:traceId", async (c) => {
    const traceId = c.req.param("traceId");
    const { results } = await c.env.DB.prepare(
      `SELECT span_name, duration_ms, status, error_message, metadata, started_at_utc
       FROM traces
       WHERE trace_id = ?
       ORDER BY started_at_utc ASC`
    ).bind(traceId).all();
    const sumMs = (results ?? []).reduce((sum: number, r: any) => sum + (r.duration_ms ?? 0), 0);
    return c.json({ traceId, spans: results, sumMs });
  });
```

**Important:** The `/debug/traces/summary` and `/debug/traces/recent` routes MUST come before `/debug/traces/:traceId` — Hono matches routes in registration order, and `:traceId` would match "summary" and "recent" if registered first.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/debug-traces.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full suite**

Run: `npm run check && npm run test`
Expected: PASS

- [ ] **Step 6: Commit**

```
feat: add debug trace endpoints for latency analysis
```

---

## Complete Span Inventory (after all tasks)

### Webhook Handler (`webhook.*`)
| Span | Operation |
|------|-----------|
| `webhook.receive` | Full webhook handler (outer span) |
| `webhook.onboarding` | Command/onboarding check |
| `webhook.user_upsert` | User lookup/create in D1 |
| `webhook.rate_limit` | Rate limit check |
| `webhook.dedup_check` | Content deduplication query |
| `webhook.source_event` | Source event persistence |
| `webhook.media_upload` | Telegram file download + R2 upload |
| `webhook.queue_enqueue` | Queue send |

### Queue Handler (`queue.*`, `ai.*`, `telegram.*`)
| Span | Operation |
|------|-----------|
| `queue.receipt` | Full queue message processing (outer span) |
| `queue.wait_time` | Time in queue (synthetic, via `record()`) |
| `queue.quota_check` | Token quota check/refresh |
| `queue.typing_indicator` | Telegram typing indicator |
| `queue.media_fetch` | R2 media retrieval |
| `queue.token_increment` | Token usage update |
| `ai.transcribe` | Whisper voice transcription |
| `ai.semantic_chat` | Full agent run (LLM + tools) |
| `telegram.send_reply` | Final reply to user |

### Debug Endpoints
| Endpoint | Purpose |
|----------|---------|
| `GET /debug/traces/:traceId` | All spans for a specific trace |
| `GET /debug/traces/summary?hours=24` | Aggregate latency stats per span name |
| `GET /debug/traces/recent?limit=20` | Recent traces with flow + total duration |
