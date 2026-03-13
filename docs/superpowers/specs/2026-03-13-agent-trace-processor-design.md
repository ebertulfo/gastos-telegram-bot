# Agent Sub-Span Instrumentation via TracingProcessor

**Date:** 2026-03-13
**Status:** Approved

## Problem

The `ai.semantic_chat` span wraps the entire Agents SDK `run()` call as a black box. We can't tell whether a 50s trace is one slow model call or 8 fast turns with tool calls. We need per-turn and per-tool timing to diagnose latency.

## Design

### New File: `src/ai/agent-trace-processor.ts`

A singleton `AgentTraceProcessor` class implementing the SDK's `TracingProcessor` interface from `@openai/agents-core`.

**Request context model:** The processor holds a mutable "current request context" containing the gastos `traceId`, `userId`, and `ITracer` reference. This is set before `run()` and cleared after, via `setContext()` / `clearContext()`. This works because queue messages are processed sequentially within a batch — there's no concurrent `run()` calls within an isolate.

**Span capture:** On `onSpanEnd(span)`, if context is set:
- If `span.spanData.type === 'generation'`: record an `ai.turn` span with duration computed from `span.startedAt` / `span.endedAt`, and metadata `{ turn, model, inputTokens, outputTokens }`
- If `span.spanData.type === 'function'`: record an `ai.tool` span with metadata `{ name, input, output }` (output truncated to 500 chars to limit storage)
- All other span types are ignored

**Turn counter:** An internal counter increments on each `generation` span and resets on `clearContext()`. This gives sequential turn numbers (0, 1, 2...) in the metadata.

**No-op methods:** `onTraceStart`, `onTraceEnd`, `onSpanStart`, `shutdown`, `forceFlush` are all no-ops. Persistence is handled by the existing `ITracer.flush()` pipeline.

**Duration computation:** `Date.parse(span.endedAt) - Date.parse(span.startedAt)` in milliseconds. If either timestamp is null (span didn't complete properly), skip recording.

### Registration: `src/queue.ts`

The processor is instantiated and registered at module scope:

```typescript
import { addTraceProcessor } from "@openai/agents";
import { agentTraceProcessor } from "./ai/agent-trace-processor";

addTraceProcessor(agentTraceProcessor);
```

Module-level registration ensures it happens once per isolate, avoiding double-registration on warm Workers invocations.

### Usage in `processMessage()`

Wrap the existing `run()` call:

```typescript
agentTraceProcessor.setContext(traceId, userId, tracer);
try {
  result = await tracer.span(traceId, "ai.semantic_chat", userId, runAgent, { model: "gpt-5-mini" });
} finally {
  agentTraceProcessor.clearContext();
}
```

### Sub-Span Schema

Uses the existing `traces` table via `tracer.record()`. No migration needed.

| Span Name | Source | Metadata |
|-----------|--------|----------|
| `ai.turn` | `generation` SDK span | `{ turn: number, model: string, inputTokens: number, outputTokens: number }` |
| `ai.tool` | `function` SDK span | `{ name: string, input: string, output: string }` |

### Constraints

- **Sequential processing assumption:** Queue batch messages are processed one at a time. If this ever changes to concurrent processing, the shared context model would need to be replaced with AsyncLocalStorage or a per-request keying strategy.
- **Output truncation:** Tool output in `ai.tool` metadata is truncated to 500 characters to prevent large payloads (e.g., `get_financial_report` results) from bloating the traces table.
- **Fire-and-forget:** The processor's `record()` calls are synchronous pushes to the tracer's span buffer. No async work happens in `onSpanEnd`, so it doesn't add latency to the agent run loop.

### Files Changed

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/ai/agent-trace-processor.ts` | TracingProcessor implementation + singleton export |
| Modify | `src/queue.ts` | Register processor, wrap run() with setContext/clearContext |
| Create | `tests/agent-trace-processor.test.ts` | Unit tests for the processor |

### Expected Trace Output (after implementation)

For a text message that triggers `log_expense`:

```
webhook.receive          450ms
webhook.onboarding        50ms
webhook.user_upsert      400ms
...
queue.receipt           8500ms
  ai.semantic_chat      7800ms   <- existing outer span
  ai.turn                3200ms  <- NEW: turn 0 (model thinking + deciding to call tool)
  ai.tool                 400ms  <- NEW: log_expense execution
  ai.turn                4100ms  <- NEW: turn 1 (model generating final response)
  telegram.send_reply     400ms
```

The debug endpoints (`/debug/traces/:traceId`, `/debug/traces/summary`) will show these sub-spans immediately with no changes needed.
