export function buildOpenApiSpec(baseUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Gastos Telegram Bot API",
      version: "0.1.0",
      description: "Webhook and health surface for the Gastos Telegram ingestion worker."
    },
    servers: [{ url: baseUrl }],
    paths: {
      "/health": {
        get: {
          summary: "Health check",
          responses: {
            "200": {
              description: "Service is healthy"
            }
          }
        }
      },
      "/webhook/telegram": {
        post: {
          summary: "Telegram webhook endpoint",
          description: "Receives Telegram updates, persists source_events, and enqueues parse jobs.",
          responses: {
            "200": {
              description: "Saved or already saved",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string", enum: ["saved", "duplicate"] },
                      message: { type: "string" }
                    },
                    required: ["status", "message"]
                  }
                }
              }
            }
          }
        }
      }
    }
  };
}
