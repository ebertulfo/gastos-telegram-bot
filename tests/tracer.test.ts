import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { Tracer, createTracer, noopTracer } from "../src/tracer";
import type { ITracer } from "../src/tracer";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    TRACES_KV: KVNamespace;
  }
}

describe("Tracer", () => {
  let tracer: Tracer;

  beforeAll(async () => {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS traces (id INTEGER PRIMARY KEY AUTOINCREMENT, trace_id TEXT NOT NULL, span_name TEXT NOT NULL, user_id INTEGER, started_at_utc TEXT NOT NULL, duration_ms INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ok', error_message TEXT, metadata TEXT, created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));"
    );
  });

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

    it("records duration_ms >= 0 for spans", async () => {
      await tracer.span("trace-dur", "timed.op", 1, async () => "done");
      await tracer.flush();

      const row = await env.DB.prepare("SELECT duration_ms FROM traces WHERE trace_id = ?")
        .bind("trace-dur")
        .first<{ duration_ms: number }>();
      expect(row!.duration_ms).toBeGreaterThanOrEqual(0);
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

    it("writes error spans to KV", async () => {
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

    it("stores NULL metadata when none provided", async () => {
      await tracer.span("trace-nometa", "plain.op", 1, async () => "ok");
      await tracer.flush();

      const row = await env.DB.prepare("SELECT metadata FROM traces WHERE trace_id = ?")
        .bind("trace-nometa")
        .first<{ metadata: string | null }>();
      expect(row!.metadata).toBeNull();
    });

    it("is a no-op when no spans are pending", async () => {
      await tracer.flush(); // should not throw
    });

    it("swallows flush errors (fire-and-forget)", async () => {
      const brokenDb = { prepare: () => { throw new Error("DB down"); } } as any;
      const brokenTracer = new Tracer(brokenDb, env.TRACES_KV);
      await brokenTracer.span("trace-x", "op", 1, async () => "ok");
      // flush should NOT throw
      await brokenTracer.flush();
    });
  });

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
});

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
