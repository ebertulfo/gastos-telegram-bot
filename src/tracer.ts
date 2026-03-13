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

// KV free tier: 1,000 writes/day. Stop writing errors to KV after this threshold per instance.
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

      // Write error spans to KV (with storm safety)
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
