import { describe, it, expect, beforeEach } from "vitest";
import { AgentTraceProcessor } from "../src/ai/agent-trace-processor";
import type { ITracer } from "../src/tracer";
import type { Span, SpanData, GenerationSpanData, FunctionSpanData, ResponseSpanData } from "@openai/agents-core";

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

  describe("response spans → ai.turn (Responses API)", () => {
    it("records ai.turn from response span with model and usage from _response", async () => {
      processor.setContext("trace-1", 42, mockTracer.tracer);

      const span = mockSpan<ResponseSpanData>(
        {
          type: "response",
          response_id: "resp_abc123",
          _response: {
            model: "gpt-5-mini",
            usage: { input_tokens: 400, output_tokens: 80 },
          },
        },
        "2026-03-13T10:00:00.000Z",
        "2026-03-13T10:00:02.500Z",
      );
      await processor.onSpanEnd(span);

      expect(mockTracer.recorded).toHaveLength(1);
      const rec = mockTracer.recorded[0];
      expect(rec.spanName).toBe("ai.turn");
      expect(rec.durationMs).toBe(2500);
      expect(rec.metadata).toEqual({
        turn: 0,
        model: "gpt-5-mini",
        inputTokens: 400,
        outputTokens: 80,
      });
    });

    it("handles response span without _response gracefully", async () => {
      processor.setContext("trace-1", 42, mockTracer.tracer);

      const span = mockSpan<ResponseSpanData>(
        { type: "response", response_id: "resp_abc123" },
        "2026-03-13T10:00:00.000Z",
        "2026-03-13T10:00:01.000Z",
      );
      await processor.onSpanEnd(span);

      expect(mockTracer.recorded).toHaveLength(1);
      expect(mockTracer.recorded[0].metadata).toEqual({
        turn: 0,
        model: "unknown",
        inputTokens: 0,
        outputTokens: 0,
      });
    });

    it("shares turn counter with generation spans", async () => {
      processor.setContext("trace-1", 42, mockTracer.tracer);

      const genSpan = mockSpan<GenerationSpanData>(
        { type: "generation", model: "gpt-5-mini" },
        "2026-03-13T10:00:00.000Z",
        "2026-03-13T10:00:01.000Z",
      );
      const respSpan = mockSpan<ResponseSpanData>(
        { type: "response", _response: { model: "gpt-5-mini" } },
        "2026-03-13T10:00:02.000Z",
        "2026-03-13T10:00:03.000Z",
      );
      await processor.onSpanEnd(genSpan);
      await processor.onSpanEnd(respSpan);

      expect(mockTracer.recorded[0].metadata?.turn).toBe(0);
      expect(mockTracer.recorded[1].metadata?.turn).toBe(1);
    });
  });

  describe("function spans → ai.tool", () => {
    it("records ai.tool with name, input, and output", async () => {
      processor.setContext("trace-1", 42, mockTracer.tracer);

      const span = mockSpan<FunctionSpanData>(
        {
          type: "function",
          name: "log_expense",
          input: '{"amount":10,"tags":["food"]}',
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
        input: '{"amount":10,"tags":["food"]}',
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

    it("skips spans with invalid timestamps", async () => {
      processor.setContext("trace-1", 42, mockTracer.tracer);

      const span = mockSpan<GenerationSpanData>(
        { type: "generation", model: "gpt-5-mini" },
        "not-a-date",
        "also-not-a-date",
      );
      await processor.onSpanEnd(span);

      expect(mockTracer.recorded).toHaveLength(0);
    });

    it("truncates long tool input", async () => {
      processor.setContext("trace-1", 42, mockTracer.tracer);

      const longInput = "y".repeat(1000);
      const span = mockSpan<FunctionSpanData>(
        { type: "function", name: "get_financial_report", input: longInput, output: "ok" },
        "2026-03-13T10:00:00.000Z",
        "2026-03-13T10:00:01.000Z",
      );
      await processor.onSpanEnd(span);

      const input = mockTracer.recorded[0].metadata?.input as string;
      expect(input.length).toBeLessThanOrEqual(503);
      expect(input.endsWith("...")).toBe(true);
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
