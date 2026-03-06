import type { Context } from "hono";
import { z } from "zod";
import { persistSourceEvent, setSourceEventR2ObjectKey } from "../db/source-events";
import { upsertUserForIngestion } from "../db/users";
import { handleOnboardingOrCommand } from "../onboarding";
import { checkRateLimit } from "../rate-limiter";
import { classifyIntent } from "../ai/agent";
import { sendTelegramChatMessage, sendChatAction } from "../telegram/messages";
import { uploadTelegramMediaToR2 } from "../telegram/media";
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
      console.error("Zod Validation Error:", JSON.stringify(payload.error.errors));
      console.log("Raw Telegram Payload:", JSON.stringify(json));
    }
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

  // Admin Check: Drop banned users instantly
  if ((config.admin.banned_telegram_ids as number[]).includes(telegramUserId)) {
    return c.json({ status: "ignored", message: "User is banned by config" }, 200);
  }

  const user = await upsertUserForIngestion(c.env, telegramUserId, chatId);

  // M10: Semantic Chat Routing (Text messages only)
  if (update.message.text && !update.message.photo && !update.message.voice) {
    // 1. Defend against API Spam via the KV Rate Limiter
    const allowed = await checkRateLimit(c.env, telegramUserId);
    if (!allowed) {
      await sendTelegramChatMessage(c.env, chatId, "⏳ You are asking questions too fast. Please wait a bit before requesting more financial data.");
      return c.json({ status: "rate_limited" }, 429);
    }

    // 2. Fast Intent Classification
    const intent = await classifyIntent(c.env, user.id, update.message.text);

    // 3. Branching Logic
    if (intent === "question") {
      // FIRE TYPING INDICATOR: Instant visual feedback before the webhook returns 200 OK
      await sendChatAction(c.env, chatId, "typing");

      // Offload the heavy reasoning model to the 15-minute async Queue to bypass Cloudflare 30s Guillotine
      const chatMessage: ParseQueueMessage = {
        type: "chat",
        userId: user.id,
        telegramId: chatId,
        timezone: user.timezone ?? "UTC",
        tier: user.tier,
        text: update.message.text
      };
      await c.env.INGEST_QUEUE.send(chatMessage);

      return c.json({ status: "handled", intent: "question_queued" }, 200);
    }

    if (intent === "unclear") {
      await sendTelegramChatMessage(c.env, chatId, "🤔 I'm not sure what you meant. Are you trying to:\n\n• **Log an expense?** Send it like: \"15 lunch\" or \"grab 6\"\n• **Ask a question?** Try: \"How much did I spend this week?\"");
      return c.json({ status: "handled", intent: "unclear" }, 200);
    }
  }

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

  if (sourceEvent.duplicate) {
    console.warn("Duplicate Telegram payload received", {
      chatId,
      messageId: update.message.message_id,
      sourceEventId: sourceEvent.id
    });
  }

  const queueMessage: ParseQueueMessage = {
    type: "receipt",
    sourceEventId: sourceEvent.id,
    userId: user.id,
    r2ObjectKey: uploadedR2ObjectKey
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
}
