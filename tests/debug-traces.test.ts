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
