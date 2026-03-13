# Agent Sub-Span Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Break open the `ai.semantic_chat` black box by capturing per-turn LLM latency and per-tool execution timing from the Agents SDK, writing them as sub-spans into our existing D1 traces table.

**Architecture:** Implement a custom `TracingProcessor` from `@openai/agents-core` that intercepts `generation` and `function` spans during the agent `run()`. A mutable request context (set/clear around each `run()` call) bridges the SDK's global processor model to our per-request `ITracer`. Sub-spans are recorded via `tracer.record()` and flushed through the existing D1 pipeline.

**Tech Stack:** TypeScript, `@openai/agents-core` TracingProcessor, Vitest + @cloudflare/vitest-pool-workers

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/ai/agent-trace-processor.ts` | `AgentTraceProcessor` class (TracingProcessor impl) + singleton export |
| Create | `tests/agent-trace-processor.test.ts` | Unit tests for the processor |
| Modify | `src/queue.ts` | Register processor at module scope, wrap `run()` with setContext/clearContext |

---

## Chunk 1: AgentTraceProcessor + Integration

### Task 1: AgentTraceProcessor implementation + tests

**Files:**
- Create: `src/ai/agent-trace-processor.ts`
- Create: `tests/agent-trace-processor.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/agent-trace-processor.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { AgentTraceProcessor } from "../src/ai/agent-trace-processor";
import type { ITracer } from "../src/tracer";
import type { Span, SpanData, GenerationSpanData, FunctionSpanData } from "@openai/agents-core";

/** Minimal mock tracer that collects record() calls */
function createMockTracer() {
  const recorded: Array<{
    traceId: string;
    spanName: string;
    userId: number | null;
    durationMs: number;
    metadata?: Record<string, unknown>;
  }> = [];
  const tracer: ITracer = {
    async span<T>(_t: string, _s: string, _u: number | null, fn: () => Promise<T>) {
      return fn();
    },
    async flush() {},
    get pendingCount() { return 0; },
    record(traceId, spanName, userId, durationMs, metadata) {
      recorded.push({ traceId, spanName, userId, durationMs, metadata });
    },
  };
  return { tracer, recorded };
}

/** Creates a mock Span with the given data and timing */
function mockSpan<T extends SpanData>(
  data: T,
  startedAt: string | null,
  endedAt: string | null,
  error: { message: string } | null = null,
): Span<T> {
  return {
    spanData: data,
    startedAt,
    endedAt,
    error,
    traceId: "sdk-trace-1",
    spanId: "sdk-span-1",
    parentId: null,
  } as unknown as Span<T>;
}

describe("AgentTraceProcessor", () => {
  let processor: AgentTraceProcessor;
  let mockTracer: ReturnType<typeof createMockTracer>;

  beforeEach(() => {
    processor = new AgentTraceProcessor();
    mockTracer = createMockTracer();
  });

  describe("generation spans → ai.turn", () => {
    it("records ai.turn with turn number and token counts", async () => {
      processor.setContext("trace-1", 42, mockTracer.tracer);

      const span = mockSpan<GenerationSpanData>(
        {
          type: "generation",
          model: "gpt-5-mini",
          usage: { input_tokens: 500, output_tokens: 100 },
        },
        "2026-03-13T10:00:00.000Z",
        "2026-03-13T10:00:03.200Z",
      );
      await processor.onSpanEnd(span);

      expect(mockTracer.recorded).toHaveLength(1);
      const rec = mockTracer.recorded[0];
      expect(rec.traceId).toBe("trace-1");
      expect(rec.spanName).toBe("ai.turn");
      expect(rec.userId).toBe(42);
      expect(rec.durationMs).toBe(3200);
      expect(rec.metadata).toEqual({
        turn: 0,
        model: "gpt-5-mini",
        inputTokens: 500,
        outputTokens: 100,
      });
    });

    it("increments turn counter across multiple generation spans", async () => {
      processor.setContext("trace-1", 42, mockTracer.tracer);

      const span0 = mockSpan<GenerationSpanData>(
        { type: "generation", model: "gpt-5-mini", usage: { input_tokens: 100, output_tokens: 50 } },
        "2026-03-13T10:00:00.000Z",
        "2026-03-13T10:00:02.000Z",
      );
      const span1 = mockSpan<GenerationSpanData>(
        { type: "generation", model: "gpt-5-mini", usage: { input_tokens: 200, output_tokens: 80 } },
        "2026-03-13T10:00:03.000Z",
        "2026-03-13T10:00:07.000Z",
      );
      await processor.onSpanEnd(span0);
      await processor.onSpanEnd(span1);

      expect(mockTracer.recorded).toHaveLength(2);
      expect(mockTracer.recorded[0].metadata?.turn).toBe(0);
      expect(mockTracer.recorded[1].metadata?.turn).toBe(1);
    });

    it("resets turn counter on clearContext", async () => {
      processor.setContext("trace-1", 42, mockTracer.tracer);
      const span = mockSpan<GenerationSpanData>(
        { type: "generation", model: "gpt-5-mini" },
        "2026-03-13T10:00:00.000Z",
        "2026-03-13T10:00:01.000Z",
      );
      await processor.onSpanEnd(span);
      processor.clearContext();

      // Start new context
      processor.setContext("trace-2", 42, mockTracer.tracer);
      await processor.onSpanEnd(span);

      expect(mockTracer.recorded[0].metadata?.turn).toBe(0);
      expect(mockTracer.recorded[1].metadata?.turn).toBe(0);
    });
  });

  describe("function spans → ai.tool", () => {
    it("records ai.tool with name, input, and output", async () => {
      processor.setContext("trace-1", 42, mockTracer.tracer);

      const span = mockSpan<FunctionSpanData>(
        {
          type: "function",
          name: "log_expense",
          input: '{"amount":10,"category":"food"}',
          output: '{"id":123,"status":"ok"}',
        },
        "2026-03-13T10:00:03.200Z",
        "2026-03-13T10:00:03.600Z",
      );
      await processor.onSpanEnd(span);

      expect(mockTracer.recorded).toHaveLength(1);
      const rec = mockTracer.recorded[0];
      expect(rec.spanName).toBe("ai.tool");
      expect(rec.durationMs).toBe(400);
      expect(rec.metadata).toEqual({
        name: "log_expense",
        input: '{"amount":10,"category":"food"}',
        output: '{"id":123,"status":"ok"}',
      });
    });

    it("truncates output to 500 characters", async () => {
      processor.setContext("trace-1", 42, mockTracer.tracer);

      const longOutput = "x".repeat(1000);
      const span = mockSpan<FunctionSpanData>(
        { type: "function", name: "get_financial_report", input: "{}", output: longOutput },
        "2026-03-13T10:00:00.000Z",
        "2026-03-13T10:00:01.000Z",
      );
      await processor.onSpanEnd(span);

      const output = mockTracer.recorded[0].metadata?.output as string;
      expect(output.length).toBeLessThanOrEqual(503); // 500 + "..."
      expect(output.endsWith("...")).toBe(true);
    });
  });

  describe("context gating", () => {
    it("does not record when no context is set", async () => {
      const span = mockSpan<GenerationSpanData>(
        { type: "generation", model: "gpt-5-mini" },
        "2026-03-13T10:00:00.000Z",
        "2026-03-13T10:00:01.000Z",
      );
      await processor.onSpanEnd(span);

      expect(mockTracer.recorded).toHaveLength(0);
    });

    it("does not record after clearContext", async () => {
      processor.setContext("trace-1", 42, mockTracer.tracer);
      processor.clearContext();

      const span = mockSpan<GenerationSpanData>(
        { type: "generation", model: "gpt-5-mini" },
        "2026-03-13T10:00:00.000Z",
        "2026-03-13T10:00:01.000Z",
      );
      await processor.onSpanEnd(span);

      expect(mockTracer.recorded).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("skips spans with null timestamps", async () => {
      processor.setContext("trace-1", 42, mockTracer.tracer);

      const span = mockSpan<GenerationSpanData>(
        { type: "generation", model: "gpt-5-mini" },
        null,
        null,
      );
      await processor.onSpanEnd(span);

      expect(mockTracer.recorded).toHaveLength(0);
    });

    it("ignores non-generation, non-function span types", async () => {
      processor.setContext("trace-1", 42, mockTracer.tracer);

      const span = mockSpan(
        { type: "agent", name: "gastos-agent", tools: ["log_expense"] } as SpanData,
        "2026-03-13T10:00:00.000Z",
        "2026-03-13T10:00:01.000Z",
      );
      await processor.onSpanEnd(span);

      expect(mockTracer.recorded).toHaveLength(0);
    });

    it("handles missing usage gracefully", async () => {
      processor.setContext("trace-1", 42, mockTracer.tracer);

      const span = mockSpan<GenerationSpanData>(
        { type: "generation", model: "gpt-5-mini" },
        "2026-03-13T10:00:00.000Z",
        "2026-03-13T10:00:01.000Z",
      );
      await processor.onSpanEnd(span);

      expect(mockTracer.recorded[0].metadata).toEqual({
        turn: 0,
        model: "gpt-5-mini",
        inputTokens: 0,
        outputTokens: 0,
      });
    });

    it("no-op methods do not throw", async () => {
      const trace = {} as any;
      const span = {} as any;
      await processor.onTraceStart(trace);
      await processor.onTraceEnd(trace);
      await processor.onSpanStart(span);
      await processor.shutdown();
      await processor.forceFlush();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/agent-trace-processor.test.ts`
Expected: FAIL — `AgentTraceProcessor` does not exist

- [ ] **Step 3: Implement `AgentTraceProcessor`**

Create `src/ai/agent-trace-processor.ts`:

```typescript
import type { TracingProcessor, Span, SpanData, Trace } from "@openai/agents-core";
import type { ITracer } from "../tracer";

const MAX_OUTPUT_LENGTH = 500;

type RequestContext = {
  traceId: string;
  userId: number;
  tracer: ITracer;
};

export class AgentTraceProcessor implements TracingProcessor {
  private context: RequestContext | null = null;
  private turnCounter = 0;

  setContext(traceId: string, userId: number, tracer: ITracer): void {
    this.context = { traceId, userId, tracer };
    this.turnCounter = 0;
  }

  clearContext(): void {
    this.context = null;
    this.turnCounter = 0;
  }

  async onSpanEnd(span: Span<SpanData>): Promise<void> {
    if (!this.context) return;

    const { startedAt, endedAt } = span;
    if (!startedAt || !endedAt) return;

    const durationMs = Date.parse(endedAt) - Date.parse(startedAt);
    const { traceId, userId, tracer } = this.context;
    const data = span.spanData;

    if (data.type === "generation") {
      tracer.record(traceId, "ai.turn", userId, durationMs, {
        turn: this.turnCounter++,
        model: data.model ?? "unknown",
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      });
    } else if (data.type === "function") {
      const output = data.output.length > MAX_OUTPUT_LENGTH
        ? data.output.slice(0, MAX_OUTPUT_LENGTH) + "..."
        : data.output;
      tracer.record(traceId, "ai.tool", userId, durationMs, {
        name: data.name,
        input: data.input,
        output,
      });
    }
  }

  async onTraceStart(_trace: Trace): Promise<void> {}
  async onTraceEnd(_trace: Trace): Promise<void> {}
  async onSpanStart(_span: Span<SpanData>): Promise<void> {}
  async shutdown(): Promise<void> {}
  async forceFlush(): Promise<void> {}
}

export const agentTraceProcessor = new AgentTraceProcessor();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/agent-trace-processor.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full suite**

Run: `npm run check && npm run test`
Expected: PASS

- [ ] **Step 6: Commit**

```
feat: add AgentTraceProcessor for per-turn and per-tool tracing
```

---

### Task 2: Integrate processor into queue.ts

**Files:**
- Modify: `src/queue.ts`

- [ ] **Step 1: Add imports and register processor at module scope**

At the top of `src/queue.ts`, add to the existing `@openai/agents` import:

Old (line 1):
```typescript
import { run, getGlobalTraceProvider, setDefaultModelProvider } from "@openai/agents";
```

New:
```typescript
import { run, getGlobalTraceProvider, setDefaultModelProvider, addTraceProcessor } from "@openai/agents";
```

Add a new import after the existing tracer imports (after line 10):
```typescript
import { agentTraceProcessor } from "./ai/agent-trace-processor";
```

Add registration after the imports, at module scope (before the `handleParseQueueBatch` function):
```typescript
addTraceProcessor(agentTraceProcessor);
```

- [ ] **Step 2: Wrap the `run()` call with setContext/clearContext**

In `processMessage()`, the current code around line 142 is:
```typescript
  result = await tracer.span(traceId, "ai.semantic_chat", userId, runAgent, { model: "gpt-5-mini" });
```

Replace with:
```typescript
  agentTraceProcessor.setContext(traceId, userId, tracer);
  try {
    result = await tracer.span(traceId, "ai.semantic_chat", userId, runAgent, { model: "gpt-5-mini" });
  } finally {
    agentTraceProcessor.clearContext();
  }
```

- [ ] **Step 3: Run tests**

Run: `npm run check && npm run test`
Expected: PASS — queue tests mock the agent runner, so `addTraceProcessor` is called but the processor receives no SDK spans during tests. Existing behavior unchanged.

- [ ] **Step 4: Commit**

```
feat: integrate AgentTraceProcessor into queue message processing
```

---

## Complete Sub-Span Inventory (after all tasks)

### Existing Spans (unchanged)
| Span | Operation |
|------|-----------|
| `ai.semantic_chat` | Full agent run (outer span, wraps everything below) |

### New Sub-Spans
| Span | Source | Metadata |
|------|--------|----------|
| `ai.turn` | SDK `generation` span | `{ turn, model, inputTokens, outputTokens }` |
| `ai.tool` | SDK `function` span | `{ name, input, output }` |

### Querying sub-spans

After deployment, diagnose the 50s outlier:
```sql
SELECT span_name, duration_ms, metadata
FROM traces
WHERE trace_id = '<slow-trace-id>'
  AND span_name IN ('ai.semantic_chat', 'ai.turn', 'ai.tool')
ORDER BY started_at_utc;
```

Average latency per sub-span type:
```sql
SELECT span_name, ROUND(AVG(duration_ms)) as avg_ms, COUNT(*) as count
FROM traces
WHERE span_name IN ('ai.turn', 'ai.tool')
  AND created_at_utc > datetime('now', '-1 day')
GROUP BY span_name;
```
