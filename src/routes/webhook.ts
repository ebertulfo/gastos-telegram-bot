import type { Context } from "hono";
import { z } from "zod";
import { persistSourceEvent, setSourceEventR2ObjectKey, findRecentDuplicateContent } from "../db/source-events";
import { upsertUserForIngestion } from "../db/users";
import { handleOnboardingOrCommand } from "../onboarding";
import { checkRateLimit } from "../rate-limiter";
import { sendTelegramChatMessage } from "../telegram/messages";
import { uploadTelegramMediaToR2 } from "../telegram/media";
import { createTracer } from "../tracer";
import { getAckMessage } from "../ack-messages";
import config from "../config.json";
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
  const json = await c.req.json();
  const payload = updateSchema.safeParse(json);
  if (!payload.success || (!payload.data.message && !payload.data.callback_query)) {
    if (!payload.success) {
      console.error("Zod Validation Error:", JSON.stringify(payload.error.issues));
      console.log("Raw Telegram Payload:", JSON.stringify(json));
    }
    return c.json({ status: "ignored", message: "Unsupported update type" }, 200);
  }

  const traceId = crypto.randomUUID();
  const tracer = createTracer(c.env.DB, c.env.TRACES_KV);

  const handleValidPayload = async () => {
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

    // Admin Check: Drop banned users instantly
    if ((config.admin.banned_telegram_ids as number[]).includes(telegramUserId)) {
      return c.json({ status: "ignored", message: "User is banned by config" }, 200);
    }

    const user = await upsertUserForIngestion(c.env, telegramUserId, chatId);

    // Rate limit check for all message types
    const allowed = await checkRateLimit(c.env, telegramUserId);
    if (!allowed) {
      await sendTelegramChatMessage(c.env, chatId, "⏳ You are sending messages too fast. Please wait a bit.");
      return c.json({ status: "rate_limited" }, 429);
    }

    // Send contextual ack message immediately to reduce perceived latency
    const messageType: "photo" | "voice" | "text" = update.message.photo ? "photo" : update.message.voice ? "voice" : "text";
    const ackText = getAckMessage(messageType, update.message.text);
    try {
      c.executionCtx.waitUntil(
        sendTelegramChatMessage(c.env, chatId, ackText).catch(() => {})
      );
    } catch {
      // No ExecutionContext in tests — fire-and-forget is best-effort
    }

    // Content-based dedup: skip if same user sent identical text in last 30 seconds
    // (catches rapid re-taps when bot appears slow)
    if (update.message.text) {
      const recentDuplicateId = await findRecentDuplicateContent(
        c.env.DB,
        user.id,
        update.message.text,
      );
      if (recentDuplicateId !== null) {
        console.warn("Content-duplicate message skipped", {
          chatId,
          text: update.message.text.slice(0, 50),
          originalSourceEventId: recentDuplicateId,
        });
        return c.json({ status: "duplicate" }, 200);
      }
    }

    const sourceEvent = await persistSourceEvent(c.env, user.id, update);
    let uploadedR2ObjectKey: string | null = null;

    if (!sourceEvent.duplicate) {
      try {
        uploadedR2ObjectKey = await tracer.span(traceId, "webhook.media_upload", user.id, async () => {
          return uploadTelegramMediaToR2(c.env, update, sourceEvent.id);
        });
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

    if (sourceEvent.duplicate) {
      console.warn("Duplicate Telegram payload received", {
        chatId,
        messageId: update.message.message_id,
        sourceEventId: sourceEvent.id
      });
    }

    const queueMessage: ParseQueueMessage = {
      traceId,
      userId: user.id,
      telegramId: chatId,
      timezone: user.timezone ?? "UTC",
      currency: user.currency ?? "PHP",
      tier: user.tier,
      text: update.message.text,
      r2ObjectKey: uploadedR2ObjectKey ?? undefined,
      mediaType: update.message.photo ? "photo" : update.message.voice ? "voice" : undefined
    };

    if (!sourceEvent.duplicate) {
      await c.env.INGEST_QUEUE.send(queueMessage);
    }

    return c.json(
      sourceEvent.duplicate
        ? { status: "duplicate" }
        : { status: "saved" },
      200
    );
  };

  const userId = payload.data.message?.from?.id ?? payload.data.callback_query?.from?.id ?? null;
  const messageType = payload.data.message?.photo ? "photo" : payload.data.message?.voice ? "voice" : "text";
  const response = await tracer.span(traceId, "webhook.receive", userId, handleValidPayload, { messageType });
  try {
    c.executionCtx.waitUntil(tracer.flush());
  } catch {
    // No ExecutionContext in tests — flush is best-effort
  }
  return response;
}
