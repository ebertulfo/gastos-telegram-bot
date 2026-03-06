import { createApp } from "./app";
import { handleParseQueueBatch } from "./queue";
import type { Env, ParseQueueMessage } from "./types";

const app = createApp();

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
  queue(batch: MessageBatch<ParseQueueMessage>, env: Env, ctx: ExecutionContext) {
    return handleParseQueueBatch(batch, env, ctx);
  }
} satisfies ExportedHandler<Env, ParseQueueMessage>;
