import { createApp } from "./app";
import { handleParseQueueBatch } from "./queue";
import { dispatchNotifications } from "./notifications";
import type { Env, ParseQueueMessage } from "./types";

const app = createApp();

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
  queue(batch: MessageBatch<ParseQueueMessage>, env: Env, ctx: ExecutionContext) {
    return handleParseQueueBatch(batch, env, ctx);
  },
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(dispatchNotifications(env, new Date()));
  }
} satisfies ExportedHandler<Env, ParseQueueMessage>;
