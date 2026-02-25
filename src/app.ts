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

  app.get("/openapi.json", (c) => c.json(buildOpenApiSpec(new URL(c.req.url).origin)));
  app.get("/docs", (c) =>
    c.html(
      `<!doctype html><html><head><meta charset="utf-8"><title>Gastos API Docs</title></head><body><pre>OpenAPI: /openapi.json</pre></body></html>`
    )
  );

  return app;
}
