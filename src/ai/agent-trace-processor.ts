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
    if (!Number.isFinite(durationMs) || durationMs < 0) return;

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
      const truncate = (s: string) =>
        s.length > MAX_OUTPUT_LENGTH ? s.slice(0, MAX_OUTPUT_LENGTH) + "..." : s;
      tracer.record(traceId, "ai.tool", userId, durationMs, {
        name: data.name,
        input: truncate(data.input),
        output: truncate(data.output),
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
