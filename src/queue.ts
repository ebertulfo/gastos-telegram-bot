import { run, getGlobalTraceProvider, setDefaultModelProvider, addTraceProcessor } from "@openai/agents";
import { OpenAIProvider } from "@openai/agents-openai";
import type { AgentInputItem } from "@openai/agents";
import { createGastosAgent } from "./ai/agent";
import { D1Session } from "./ai/session";
import { getRecentExpenses, getTopUserTags } from "./db/expenses";
import { transcribeR2Audio } from "./ai/openai";
import { sendTelegramChatMessage, sendChatAction } from "./telegram/messages";
import { StreamingReplyManager, getToolStatusText } from "./telegram/streaming";
import { checkAndRefreshTokenQuota, incrementTokenUsage } from "./db/quotas";
import { createTracer } from "./tracer";
import type { ITracer } from "./tracer";
import { agentTraceProcessor } from "./ai/agent-trace-processor";
import type { Env, ParseQueueMessage } from "./types";

addTraceProcessor(agentTraceProcessor);

export async function handleParseQueueBatch(
  batch: MessageBatch<ParseQueueMessage>,
  env: Env,
  ctx: ExecutionContext,
) {
  for (const message of batch.messages) {
    const traceId = message.body.traceId ?? crypto.randomUUID();
    const tracer = createTracer(env.DB, env.TRACES_KV);
    try {
      await tracer.span(traceId, "queue.receipt", message.body.userId, async () => {
        await processMessage(env, ctx, message.body, tracer, traceId);
      });
      message.ack();
    } catch (error) {
      console.error("Queue message processing failed", {
        traceId,
        userId: message.body.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      message.retry();
    } finally {
      ctx.waitUntil(tracer.flush());
    }
  }
}

async function processMessage(
  env: Env,
  ctx: ExecutionContext,
  body: ParseQueueMessage,
  tracer: ITracer,
  traceId: string,
): Promise<void> {
  const { userId, telegramId, timezone, currency, tier } = body;

  // Record queue wait time (time between webhook enqueue and queue dequeue)
  if (body.enqueuedAtUtc) {
    const waitMs = Date.now() - new Date(body.enqueuedAtUtc).getTime();
    tracer.record(traceId, "queue.wait_time", userId, waitMs);
  }

  // 1. Check quota + send typing indicator in parallel (typing is best-effort)
  const [allowed] = await Promise.all([
    tracer.span(traceId, "queue.quota_check", userId, async () => {
      return checkAndRefreshTokenQuota(env.DB, userId, telegramId, tier);
    }),
    tracer.span(traceId, "queue.typing_indicator", userId, async () => {
      await sendChatAction(env, telegramId, "typing");
    }),
  ]);
  if (!allowed) {
    await sendTelegramChatMessage(
      env,
      telegramId,
      "You've hit your daily limit — try again tomorrow",
    );
    return;
  }

  // 2. Configure OpenAI SDK with API key from Workers env (no process.env on Workers)
  setDefaultModelProvider(new OpenAIProvider({ apiKey: env.OPENAI_API_KEY }));

  // 3. Pre-process media into agent input
  let agentInput: string | AgentInputItem[];
  let inputSummaryForLog: string; // Redacted version for audit log (no base64 blobs)

  if (body.mediaType === "voice" && body.r2ObjectKey) {
    // Voice: transcribe via Whisper, then pass transcript as string
    let transcript: string | null;
    transcript = await tracer.span(traceId, "ai.transcribe", userId, async () => {
      return transcribeR2Audio(env, body.r2ObjectKey!);
    });
    if (!transcript) {
      await sendTelegramChatMessage(env, telegramId, "Couldn't transcribe that voice message — try sending it again");
      return;
    }
    // Persist transcript so Mini App can show "Heard: ..." preview
    if (body.sourceEventId) {
      env.DB.prepare(`UPDATE source_events SET transcript = ? WHERE id = ?`)
        .bind(transcript, body.sourceEventId).run().catch(() => {});
    }
    agentInput = transcript;
    inputSummaryForLog = transcript;
  } else if (body.mediaType === "photo" && body.r2ObjectKey) {
    // Photo: fetch from R2, convert to base64, create multimodal input
    let object: R2ObjectBody | null;
    object = await tracer.span(traceId, "queue.media_fetch", userId, async () => {
      return env.MEDIA_BUCKET.get(body.r2ObjectKey!);
    }, { r2Key: body.r2ObjectKey });
    if (!object) {
      await sendTelegramChatMessage(env, telegramId, "Couldn't load that image — try sending it again");
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
    inputSummaryForLog = body.text ? `[photo] ${body.text}` : "[photo]";
  } else {
    // Text message
    agentInput = body.text ?? "";
    inputSummaryForLog = agentInput;
  }

  // 4. Fetch recent expenses + top tags for agent context
  const [recentExpenses, userTopTags] = await Promise.all([
    getRecentExpenses(env.DB, userId, 10),
    getTopUserTags(env.DB, userId, 10),
  ]);
  const recentExpensesContext = recentExpenses.length > 0
    ? recentExpenses.map(e => {
        const date = new Date(e.occurred_at_utc).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const amount = (e.amount_minor / 100).toFixed(2);
        let tags = "";
        try {
          const parsed = JSON.parse(e.tags || "[]");
          if (Array.isArray(parsed) && parsed.length > 0) tags = ` (${parsed.join(", ")})`;
        } catch { /* ignore */ }
        return `#${e.id} ${date} — ${e.currency} ${amount} — ${e.description ?? "Unknown"}${tags}`;
      }).join("\n")
    : undefined;

  // 5. Create agent and session
  const agent = createGastosAgent(env, userId, telegramId, timezone, currency, recentExpensesContext, body.sourceEventId, userTopTags);
  const session = new D1Session(env.DB, userId);

  // 6. Run the agent (streaming)
  let result;
  const manager = new StreamingReplyManager(env, telegramId);

  const runAgent = async () => {
    try {
      const stream = await run(agent, agentInput, { session, maxTurns: 10, stream: true });

      for await (const event of stream) {
        if (event.type === "run_item_stream_event" && event.name === "tool_called") {
          // SDK stream types don't expose rawItem on RunItem union — cast needed
          const rawItem = (event.item as any).rawItem;
          const toolName = rawItem?.name ?? "";
          await manager.sendDraft(getToolStatusText(toolName));
        }
        if (event.type === "raw_model_stream_event" && event.data.type === "output_text_delta") {
          if (!manager.started) {
            await manager.sendDraft("...");
          }
          await manager.appendText(event.data.delta);
        }
      }

      await stream.completed;
      return stream;
    } catch (err: unknown) {
      // Error resumption falls back to non-streaming run() — no double-complexity on retry
      if (err && typeof err === "object" && "state" in err && err.state) {
        try {
          return await run(agent, err.state as any);
        } catch {
          await sendTelegramChatMessage(env, telegramId, "Something went wrong — try again");
          return null;
        }
      } else {
        // Ack instead of retry: without a DLQ, retrying persistent errors leads to
        // silent drops after 3 attempts. Prefer user notification over silent failure.
        console.error("Agent run failed without state", { error: err instanceof Error ? err.message : String(err) });
        await sendTelegramChatMessage(env, telegramId, "Something went wrong — try again");
        return null;
      }
    }
  };

  // IMPORTANT: Preserve agentTraceProcessor context — this wraps the span so
  // ai.turn and ai.tool sub-spans from AgentTraceProcessor are attributed correctly
  agentTraceProcessor.setContext(traceId, userId, tracer);
  const agentStartMs = Date.now();
  try {
    result = await tracer.span(traceId, "ai.semantic_chat", userId, runAgent, { model: "gpt-5-mini" });
  } finally {
    agentTraceProcessor.clearContext();
  }
  const agentLatencyMs = Date.now() - agentStartMs;

  if (!result) return;

  // 7. Increment token quota
  const totalTokens = result.rawResponses.reduce(
    (sum: number, r: any) => sum + (r.usage?.totalTokens ?? 0),
    0,
  );
  if (totalTokens > 0) {
    await tracer.span(traceId, "queue.token_increment", userId, async () => {
      await incrementTokenUsage(env.DB, userId, totalTokens);
    });
  }

  // 7b. Extract reply text (needed by both audit log and finalize)
  const reply = result.finalOutput || "";

  // 7c. Audit log — capture LLM call details for debugging (fire-and-forget)
  ctx.waitUntil((async () => {
    try {
      const { insertAuditLog } = await import("./db/audit-log");

      const toolCalls: Array<{name: string; input: string}> = [];
      for (const r of result.rawResponses) {
        const output = (r as any).output;
        if (Array.isArray(output)) {
          for (const item of output) {
            if (item.type === "function_call") {
              toolCalls.push({ name: item.name, input: item.arguments ?? "" });
            }
          }
        }
      }

      const anomalies: string[] = [];
      if (!reply) anomalies.push("empty_response");
      if (result.rawResponses.length > 5) anomalies.push("excessive_turns");

      await insertAuditLog(env.DB, {
        trace_id: traceId,
        user_id: userId,
        messages_sent: inputSummaryForLog,
        response_received: reply,
        tool_calls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : null,
        total_tokens: totalTokens,
        latency_ms: agentLatencyMs,
        anomaly_flags: anomalies.length > 0 ? JSON.stringify(anomalies) : null,
      });
    } catch (err) {
      console.error("Audit log insert failed", err instanceof Error ? err.message : String(err));
    }
  })());

  // 8. Finalize streaming reply
  await tracer.span(traceId, "telegram.send_reply", userId, async () => {
    await manager.finalize(reply);
  });

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
