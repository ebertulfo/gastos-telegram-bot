import { run, getGlobalTraceProvider, setDefaultModelProvider } from "@openai/agents";
import { OpenAIProvider } from "@openai/agents-openai";
import type { AgentInputItem } from "@openai/agents";
import { createGastosAgent } from "./ai/agent";
import { D1Session } from "./ai/session";
import { transcribeR2Audio } from "./ai/openai";
import { sendTelegramChatMessage, sendChatAction } from "./telegram/messages";
import { checkAndRefreshTokenQuota, incrementTokenUsage } from "./db/quotas";
import { Tracer } from "./tracer";
import type { Env, ParseQueueMessage } from "./types";

export async function handleParseQueueBatch(
  batch: MessageBatch<ParseQueueMessage>,
  env: Env,
  ctx: ExecutionContext,
) {
  for (const message of batch.messages) {
    const traceId = message.body.traceId ?? crypto.randomUUID();
    const tracer = env.TRACES_KV ? new Tracer(env.DB, env.TRACES_KV) : null;
    try {
      if (tracer) {
        await tracer.span(traceId, "queue.receipt", message.body.userId, async () => {
          await processMessage(env, ctx, message.body, tracer, traceId);
        });
      } else {
        await processMessage(env, ctx, message.body, tracer, traceId);
      }
      message.ack();
    } catch (error) {
      console.error("Queue message processing failed", {
        traceId,
        userId: message.body.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      message.retry();
    } finally {
      if (tracer) {
        ctx.waitUntil(tracer.flush());
      }
    }
  }
}

async function processMessage(
  env: Env,
  ctx: ExecutionContext,
  body: ParseQueueMessage,
  tracer: Tracer | null,
  traceId: string,
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

  // 2. Configure OpenAI SDK with API key from Workers env (no process.env on Workers)
  setDefaultModelProvider(new OpenAIProvider({ apiKey: env.OPENAI_API_KEY }));

  // 3. Send typing indicator
  await sendChatAction(env, telegramId, "typing");

  // 4. Pre-process media into agent input
  let agentInput: string | AgentInputItem[];

  if (body.mediaType === "voice" && body.r2ObjectKey) {
    // Voice: transcribe via Whisper, then pass transcript as string
    let transcript: string | null;
    if (tracer) {
      transcript = await tracer.span(traceId, "ai.transcribe", userId, async () => {
        return transcribeR2Audio(env, body.r2ObjectKey!);
      });
    } else {
      transcript = await transcribeR2Audio(env, body.r2ObjectKey);
    }
    if (!transcript) {
      await sendTelegramChatMessage(env, telegramId, "Could not transcribe your voice message. Please try again.");
      return;
    }
    agentInput = transcript;
  } else if (body.mediaType === "photo" && body.r2ObjectKey) {
    // Photo: fetch from R2, convert to base64, create multimodal input
    let object: R2ObjectBody | null;
    if (tracer) {
      object = await tracer.span(traceId, "queue.media_fetch", userId, async () => {
        return env.MEDIA_BUCKET.get(body.r2ObjectKey!);
      }, { r2Key: body.r2ObjectKey });
    } else {
      object = await env.MEDIA_BUCKET.get(body.r2ObjectKey);
    }
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

  // 5. Create agent and session
  const agent = createGastosAgent(env, userId, telegramId, timezone, currency);
  const session = new D1Session(env.DB, userId);

  // 6. Run the agent
  let result;
  const runAgent = async () => {
    try {
      return await run(agent, agentInput, { session, maxTurns: 10 });
    } catch (err: unknown) {
      // Check if error has .state for resumption
      if (err && typeof err === "object" && "state" in err && err.state) {
        try {
          return await run(agent, err.state as any);
        } catch {
          await sendTelegramChatMessage(env, telegramId, "Something went wrong, please try again.");
          return null;
        }
      } else {
        throw err; // Re-throw to trigger message.retry()
      }
    }
  };

  if (tracer) {
    result = await tracer.span(traceId, "ai.semantic_chat", userId, runAgent, { model: "gpt-5-mini" });
  } else {
    result = await runAgent();
  }

  if (!result) return;

  // 7. Increment token quota from actual usage
  const totalTokens = result.rawResponses.reduce(
    (sum, r) => sum + (r.usage?.totalTokens ?? 0),
    0,
  );
  if (totalTokens > 0) {
    await incrementTokenUsage(env.DB, userId, totalTokens);
  }

  // 8. Send result to Telegram
  const reply = result.finalOutput || "I couldn't process that. Please try again.";
  if (tracer) {
    await tracer.span(traceId, "telegram.send_reply", userId, async () => {
      await sendTelegramChatMessage(env, telegramId, reply);
    });
  } else {
    await sendTelegramChatMessage(env, telegramId, reply);
  }

  // 9. Flush traces in background
  ctx.waitUntil(getGlobalTraceProvider().forceFlush());
}

function arrayBufferToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
