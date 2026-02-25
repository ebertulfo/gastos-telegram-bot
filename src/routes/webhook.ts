import type { Context } from "hono";
import { z } from "zod";
import { persistSourceEvent, setSourceEventR2ObjectKey } from "../db/source-events";
import { upsertUserForIngestion } from "../db/users";
import { handleOnboardingOrCommand } from "../onboarding";
import { sendTelegramChatMessage } from "../telegram/messages";
import { uploadTelegramMediaToR2 } from "../telegram/media";
import type { Env, ParseQueueMessage, TelegramUpdate } from "../types";

const updateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      message_id: z.number(),
      date: z.number(),
      text: z.string().optional(),
      chat: z.object({ id: z.number() }),
      from: z.object({ id: z.number() }).optional(),
      photo: z
        .array(
          z.object({
            file_id: z.string(),
            file_unique_id: z.string(),
            file_size: z.number().optional(),
            width: z.number(),
            height: z.number()
          })
        )
        .optional(),
      voice: z
        .object({
          file_id: z.string(),
          file_unique_id: z.string(),
          duration: z.number(),
          mime_type: z.string().optional(),
          file_size: z.number().optional()
        })
        .optional()
    })
    .optional(),
  callback_query: z
    .object({
      id: z.string(),
      from: z.object({ id: z.number() }),
      message: z
        .object({
          message_id: z.number(),
          chat: z.object({ id: z.number() })
        })
        .optional(),
      data: z.string().optional()
    })
    .optional()
});

export async function handleTelegramWebhook(c: Context<{ Bindings: Env }>) {
  const payload = updateSchema.safeParse(await c.req.json());
  if (!payload.success || (!payload.data.message && !payload.data.callback_query)) {
    return c.json({ status: "ignored", message: "Unsupported update type" }, 200);
  }

  const update = payload.data as TelegramUpdate;
  const handled = await handleOnboardingOrCommand(c.env, update);
  if (handled) {
    return c.json({ status: "handled", message: "Message handled by command/onboarding flow" }, 200);
  }

  // If we reach here, it must be an expense ingestion message.
  // We don't ingest callback queries as expenses.
  if (!update.message) {
    return c.json({ status: "ignored", message: "Unhandled callback query" }, 200);
  }

  const chatId = update.message.chat.id;
  const telegramUserId = update.message.from?.id ?? chatId;
  const user = await upsertUserForIngestion(c.env, telegramUserId, chatId);
  const sourceEvent = await persistSourceEvent(c.env, user.id, update);
  let uploadedR2ObjectKey: string | null = null;

  if (!sourceEvent.duplicate) {
    try {
      uploadedR2ObjectKey = await uploadTelegramMediaToR2(c.env, update, sourceEvent.id);
      if (uploadedR2ObjectKey) {
        await setSourceEventR2ObjectKey(c.env, sourceEvent.id, uploadedR2ObjectKey);
      }
    } catch (error) {
      console.error("Media upload failed", {
        sourceEventId: sourceEvent.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const acknowledgementText = sourceEvent.duplicate ? "Already saved ✅" : "Saved ✅";
  const ackTask = sendTelegramChatMessage(c.env, chatId, acknowledgementText).catch((error) => {
    console.error("Telegram acknowledgement failed", {
      sourceEventId: sourceEvent.id,
      error: error instanceof Error ? error.message : String(error)
    });
  });
  const executionCtx = getExecutionCtx(c);
  if (executionCtx?.waitUntil) {
    executionCtx.waitUntil(ackTask);
  } else {
    await ackTask;
  }

  const queueMessage: ParseQueueMessage = {
    sourceEventId: sourceEvent.id,
    userId: user.id,
    r2ObjectKey: uploadedR2ObjectKey
  };

  if (!sourceEvent.duplicate) {
    await c.env.INGEST_QUEUE.send(queueMessage);
  }

  return c.json(
    sourceEvent.duplicate
      ? { status: "duplicate", message: acknowledgementText }
      : { status: "saved", message: acknowledgementText },
    200
  );
}

function getExecutionCtx(c: Context<{ Bindings: Env }>): ExecutionContext | undefined {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}
