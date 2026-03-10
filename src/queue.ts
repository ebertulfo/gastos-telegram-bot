import { run, getGlobalTraceProvider } from "@openai/agents";
import type { AgentInputItem } from "@openai/agents";
import { createGastosAgent } from "./ai/agent";
import { D1Session } from "./ai/session";
import { transcribeR2Audio } from "./ai/openai";
import { sendTelegramChatMessage, sendChatAction } from "./telegram/messages";
import { checkAndRefreshTokenQuota, incrementTokenUsage } from "./db/quotas";
import type { Env, ParseQueueMessage } from "./types";

export async function handleParseQueueBatch(
  batch: MessageBatch<ParseQueueMessage>,
  env: Env,
  ctx: ExecutionContext,
) {
  for (const message of batch.messages) {
    try {
      await processMessage(env, ctx, message.body);
      message.ack();
    } catch (error) {
      console.error("Queue message processing failed", {
        userId: message.body.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      message.retry();
    }
  }
}

async function processMessage(
  env: Env,
  ctx: ExecutionContext,
  body: ParseQueueMessage,
): Promise<void> {
  const { userId, telegramId, timezone, currency, tier } = body;

  // 1. Check quota
  const allowed = await checkAndRefreshTokenQuota(env.DB, userId, telegramId, tier);
  if (!allowed) {
    await sendTelegramChatMessage(
      env,
      telegramId,
      "You've reached your daily usage limit. Try again tomorrow!",
    );
    return;
  }

  // 2. Send typing indicator
  await sendChatAction(env, telegramId, "typing");

  // 3. Pre-process media into agent input
  let agentInput: string | AgentInputItem[];

  if (body.mediaType === "voice" && body.r2ObjectKey) {
    // Voice: transcribe via Whisper, then pass transcript as string
    const transcript = await transcribeR2Audio(env, body.r2ObjectKey);
    if (!transcript) {
      await sendTelegramChatMessage(env, telegramId, "Could not transcribe your voice message. Please try again.");
      return;
    }
    agentInput = transcript;
  } else if (body.mediaType === "photo" && body.r2ObjectKey) {
    // Photo: fetch from R2, convert to base64, create multimodal input
    const object = await env.MEDIA_BUCKET.get(body.r2ObjectKey);
    if (!object) {
      await sendTelegramChatMessage(env, telegramId, "Could not retrieve the image. Please try again.");
      return;
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    const mime = object.httpMetadata?.contentType ?? "image/jpeg";
    const base64 = arrayBufferToBase64(bytes);
    const dataUrl = `data:${mime};base64,${base64}`;

    const content: Array<{ type: "input_image"; image: string } | { type: "input_text"; text: string }> = [
      { type: "input_image", image: dataUrl },
    ];
    // Include caption text if provided
    if (body.text) {
      content.push({ type: "input_text", text: body.text });
    }

    agentInput = [{ role: "user" as const, content }];
  } else {
    // Text message
    agentInput = body.text ?? "";
  }

  // 4. Create agent and session
  const agent = createGastosAgent(env, userId, telegramId, timezone, currency);
  const session = new D1Session(env.DB, userId);

  // 5. Run the agent
  let result;
  try {
    result = await run(agent, agentInput, { session, maxTurns: 10 });
  } catch (err: unknown) {
    // Check if error has .state for resumption
    if (err && typeof err === "object" && "state" in err && err.state) {
      try {
        result = await run(agent, err.state as any);
      } catch {
        await sendTelegramChatMessage(env, telegramId, "Something went wrong, please try again.");
        return;
      }
    } else {
      throw err; // Re-throw to trigger message.retry()
    }
  }

  // 6. Increment token quota from actual usage
  const totalTokens = result.rawResponses.reduce(
    (sum, r) => sum + (r.usage?.totalTokens ?? 0),
    0,
  );
  if (totalTokens > 0) {
    await incrementTokenUsage(env.DB, userId, totalTokens);
  }

  // 7. Send result to Telegram
  const reply = result.finalOutput || "I couldn't process that. Please try again.";
  await sendTelegramChatMessage(env, telegramId, reply);

  // 8. Flush traces in background
  ctx.waitUntil(getGlobalTraceProvider().forceFlush());
}

function arrayBufferToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
