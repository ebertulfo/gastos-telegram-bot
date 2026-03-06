import { Hono } from "hono";
import { cors } from "hono/cors";
import { buildOpenApiSpec } from "./openapi";
import { handleTelegramWebhook } from "./routes/webhook";
import { apiRouter } from "./routes/api";
import type { Env } from "./types";

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  // Global CORS setup for the Mini App dashboard
  app.use(
    "/api/*",
    cors({
      origin: "*", // Or restrict to your Pages domain
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    })
  );

  app.get("/health", (c) => c.json({ status: "ok", env: c.env.APP_ENV }));
  app.post("/webhook/telegram", handleTelegramWebhook);
  app.route("/api", apiRouter);

  // ── DEBUG ENDPOINTS (remove or protect in production) ──────────────
  app.get("/debug/vectorize-test", async (c) => {
    const query = c.req.query("q") ?? "drinks";
    const userId = parseInt(c.req.query("user_id") ?? "0");
    const { generateEmbedding } = await import("./ai/openai");

    const embedding = await generateEmbedding(c.env, query);
    if (!embedding.length) return c.json({ error: "Embedding failed" }, 500);

    // Query WITH user_id filter
    const withFilter = await c.env.VECTORIZE.query(embedding, {
      topK: 20,
      filter: userId ? { user_id: userId } : undefined,
      returnMetadata: "all"
    });

    // Query WITHOUT filter to check if vectors exist at all
    const withoutFilter = await c.env.VECTORIZE.query(embedding, {
      topK: 20,
      returnMetadata: "all"
    });

    return c.json({
      query,
      userId,
      embeddingLength: embedding.length,
      withUserFilter: {
        matchCount: withFilter.matches?.length ?? 0,
        matches: withFilter.matches?.map(m => ({
          id: m.id,
          score: m.score,
          metadata: m.metadata
        }))
      },
      withoutFilter: {
        matchCount: withoutFilter.matches?.length ?? 0,
        matches: withoutFilter.matches?.map(m => ({
          id: m.id,
          score: m.score,
          metadata: m.metadata
        }))
      }
    });
  });

  app.get("/debug/expenses", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT e.id, e.source_event_id, e.amount_minor, e.currency, e.category, e.tags,
              se.text_raw, JSON_EXTRACT(pr.parsed_json, '$.description') as parsed_description
       FROM expenses e
       JOIN source_events se ON e.source_event_id = se.id
       LEFT JOIN parse_results pr ON pr.source_event_id = se.id
       ORDER BY e.id DESC LIMIT 50`
    ).all();
    return c.json({ count: results?.length ?? 0, expenses: results });
  });

  app.get("/debug/chat-history", async (c) => {
    const userId = parseInt(c.req.query("user_id") ?? "0");
    const query = userId
      ? `SELECT * FROM chat_history WHERE user_id = ? ORDER BY id DESC LIMIT 20`
      : `SELECT * FROM chat_history ORDER BY id DESC LIMIT 20`;
    const stmt = userId ? c.env.DB.prepare(query).bind(userId) : c.env.DB.prepare(query);
    const { results } = await stmt.all();
    return c.json({ count: results?.length ?? 0, messages: results });
  });

  app.post("/debug/backfill-vectors", async (c) => {
    const { backfillVectorize } = await import("./scripts/backfill-vectors");
    const result = await backfillVectorize(c.env);
    return c.json(result);
  });
  // ── END DEBUG ENDPOINTS ────────────────────────────────────────────

  app.get("/openapi.json", (c) => c.json(buildOpenApiSpec(new URL(c.req.url).origin)));
  app.get("/docs", (c) =>
    c.html(
      `<!doctype html><html><head><meta charset="utf-8"><title>Gastos API Docs</title></head><body><pre>OpenAPI: /openapi.json</pre></body></html>`
    )
  );

  return app;
}
