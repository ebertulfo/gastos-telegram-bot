import { extractAmountCurrencyFromR2Image, extractAmountCurrencyFromText, transcribeR2Audio } from "./ai/openai";
import { sendTelegramChatMessage } from "./telegram/messages";
import type { Env, ParseQueueMessage } from "./types";

export async function handleParseQueueBatch(batch: MessageBatch<ParseQueueMessage>, env: Env) {
  for (const message of batch.messages) {
    try {
      const sourceEvent = await env.DB.prepare(
        `SELECT se.id, se.user_id, se.message_type, se.text_raw, se.r2_object_key, se.received_at_utc, u.currency AS user_currency, u.telegram_id
         FROM source_events se
         LEFT JOIN users u ON u.id = se.user_id
         WHERE se.id = ?`
      )
        .bind(message.body.sourceEventId)
        .first<{
          id: number;
          user_id: number;
          message_type: "text" | "photo" | "voice";
          text_raw: string | null;
          r2_object_key: string | null;
          received_at_utc: string;
          user_currency: string | null;
          telegram_id: number | null;
        }>();

      if (!sourceEvent) {
        throw new Error(`Source event not found: ${message.body.sourceEventId}`);
      }

      const extraction = await extractForSourceEvent(env, sourceEvent, message.body.r2ObjectKey);

      await env.DB.prepare(
        `INSERT INTO parse_results (
           source_event_id,
           parser_version,
           parsed_json,
           confidence,
           needs_review,
           created_at_utc
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(
          sourceEvent.id,
          sourceEvent.message_type === "text" ? "v1-text-parser" : "v1-multimodal-parser",
          JSON.stringify(extraction.parsedJson),
          extraction.confidence,
          extraction.needsReview ? 1 : 0,
          new Date().toISOString()
        )
        .run();

      if (extraction.amountMinor !== null && extraction.currency) {
        await env.DB.prepare(
          `INSERT INTO expenses (
             user_id,
             source_event_id,
             amount_minor,
             currency,
             occurred_at_utc,
             status,
             created_at_utc
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(source_event_id) DO NOTHING`
        )
          .bind(
            sourceEvent.user_id,
            sourceEvent.id,
            extraction.amountMinor,
            extraction.currency,
            sourceEvent.received_at_utc,
            extraction.needsReview ? "needs_review" : "final",
            new Date().toISOString()
          )
          .run();

        if (sourceEvent.telegram_id) {
          const formattedMinor = (extraction.amountMinor / 100).toFixed(2);
          let replyText = `✅ Logged: ${extraction.currency} ${formattedMinor}`;
          if (extraction.needsReview) {
            replyText += `\n⚠️ Marked for review (confidence: ${Math.round(extraction.confidence * 100)}%)`;
          }
          await sendTelegramChatMessage(env, sourceEvent.telegram_id, replyText);
        }
      } else {
        if (sourceEvent.telegram_id) {
          const reason = String(extraction.parsedJson.reason || "unrecognized format");
          await sendTelegramChatMessage(env, sourceEvent.telegram_id, `❌ Failed to extract amount: ${reason}`);
        }
      }

      message.ack();
    } catch (error) {
      console.error("Queue message processing failed", {
        sourceEventId: message.body.sourceEventId,
        error: error instanceof Error ? error.message : String(error)
      });
      message.retry();
    }
  }
}

type ExtractionResult = {
  amountMinor: number | null;
  currency: string | null;
  needsReview: boolean;
  confidence: number;
  parsedJson: Record<string, unknown>;
};

export async function extractForSourceEvent(
  env: Env,
  sourceEvent: {
    message_type: "text" | "photo" | "voice";
    text_raw: string | null;
    r2_object_key: string | null;
    user_currency: string | null;
  },
  queueR2ObjectKey: string | null
): Promise<ExtractionResult> {
  const messageType = sourceEvent.message_type;
  const textRaw = sourceEvent.text_raw;
  const userCurrency = sourceEvent.user_currency;
  const mediaKey = queueR2ObjectKey ?? sourceEvent.r2_object_key;

  if (messageType === "voice") {
    if (!mediaKey || !env.OPENAI_API_KEY) {
      return unprocessedResult("voice", "missing_voice_media_or_openai_key");
    }

    const transcript = await transcribeR2Audio(env, mediaKey);
    if (!transcript) {
      return unprocessedResult("voice", "transcription_empty");
    }

    const aiExtraction = await extractAmountCurrencyFromText(env, transcript, userCurrency);
    if (!aiExtraction) {
      return unprocessedResult("voice", "ai_text_extraction_failed");
    }

    let resolvedCurrency = aiExtraction.currency;
    if (!resolvedCurrency) {
      resolvedCurrency = userCurrency;
    }

    return {
      amountMinor: aiExtraction.amountMinor,
      currency: resolvedCurrency,
      needsReview: aiExtraction.needsReview || !aiExtraction.currency,
      confidence: aiExtraction.confidence,
      parsedJson: {
        modality: "voice",
        status: aiExtraction.amountMinor !== null && resolvedCurrency ? "extracted" : "unprocessed",
        amountMinor: aiExtraction.amountMinor,
        currency: resolvedCurrency,
        transcript,
        ...aiExtraction.metadata
      }
    };
  }

  if (messageType === "photo") {
    if (!mediaKey || !env.OPENAI_API_KEY) {
      return unprocessedResult("photo", "missing_photo_media_or_openai_key");
    }

    const visionExtraction = await extractAmountCurrencyFromR2Image(env, mediaKey, userCurrency);
    if (!visionExtraction) {
      return unprocessedResult("photo", "vision_empty");
    }

    return {
      amountMinor: visionExtraction.amountMinor,
      currency: visionExtraction.currency,
      needsReview: visionExtraction.needsReview,
      confidence: visionExtraction.confidence,
      parsedJson: {
        modality: "photo",
        status: visionExtraction.amountMinor !== null && visionExtraction.currency ? "extracted" : "unprocessed",
        amountMinor: visionExtraction.amountMinor,
        currency: visionExtraction.currency,
        ...visionExtraction.metadata
      }
    };
  }

  return extractFromText(textRaw ?? "", userCurrency);
}

function extractFromText(text: string, userCurrency: string | null): ExtractionResult {
  const normalizedText = text ?? "";
  const amountMinor = extractAmountMinor(normalizedText);
  const explicitCurrency = extractExplicitCurrency(normalizedText);
  const currency = explicitCurrency ?? userCurrency;
  const inferredCurrency = !explicitCurrency && Boolean(userCurrency);
  const needsReview = inferredCurrency;

  if (amountMinor === null || !currency) {
    return {
      amountMinor: null,
      currency: currency ?? null,
      needsReview: true,
      confidence: amountMinor === null ? 0 : 0.5,
      parsedJson: {
        modality: "text",
        status: "unprocessed",
        amountMinor,
        currency,
        reason: amountMinor === null ? "amount_missing" : "currency_missing"
      }
    };
  }

  return {
    amountMinor,
    currency,
    needsReview,
    confidence: inferredCurrency ? 0.75 : 0.95,
    parsedJson: {
      modality: "text",
      status: "extracted",
      amountMinor,
      currency,
      currencySource: explicitCurrency ? "explicit" : "user_default"
    }
  };
}

function unprocessedResult(modality: "photo" | "voice", reason: string): ExtractionResult {
  return {
    amountMinor: null,
    currency: null,
    needsReview: true,
    confidence: 0,
    parsedJson: {
      modality,
      status: "unprocessed",
      reason
    }
  };
}

function extractAmountMinor(text: string): number | null {
  const normalized = text.replace(/,/g, "");
  const decimalMatches = normalized.match(/-?\d+\.\d{1,2}/g) ?? [];
  const integerMatches = normalized.match(/-?\d+/g) ?? [];
  const amountString = decimalMatches[0] ?? integerMatches[0];
  if (!amountString) {
    return null;
  }

  const parsed = Number.parseFloat(amountString);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.round(parsed * 100);
}

function extractExplicitCurrency(text: string): string | null {
  const match = text.toUpperCase().match(/\b[A-Z]{3}\b/);
  return match?.[0] ?? null;
}
