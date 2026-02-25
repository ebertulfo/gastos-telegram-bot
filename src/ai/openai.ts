import type { Env } from "../types";

export type OpenAIExtraction = {
  amountMinor: number | null;
  currency: string | null;
  confidence: number;
  needsReview: boolean;
  metadata: Record<string, unknown>;
};

export async function transcribeR2Audio(env: Env, r2ObjectKey: string): Promise<string | null> {
  const object = await env.MEDIA_BUCKET.get(r2ObjectKey);
  if (!object) {
    return null;
  }

  if (!env.OPENAI_API_KEY) {
    return null;
  }

  const fileExt = inferFileExtension(r2ObjectKey);
  const form = new FormData();
  form.append("model", env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe");
  form.append("file", new File([await object.arrayBuffer()], `audio.${fileExt}`));

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: form
  });

  if (!response.ok) {
    throw new Error(`OpenAI transcription failed with status ${response.status}`);
  }

  const json = (await response.json()) as { text?: string };
  return json.text?.trim() || null;
}

export async function extractAmountCurrencyFromText(
  env: Env,
  text: string,
  userCurrency: string | null
): Promise<OpenAIExtraction | null> {
  if (!env.OPENAI_API_KEY) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENAI_VISION_MODEL ?? "gpt-4o-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                `Extract the total amount and currency from this transcribed message. The user might spell out numbers (e.g. "five dollars"). Convert it to digits. The user's default currency is ${userCurrency ?? "unknown"}. If the user says a generic currency word like "dollars" or "$", assume it means their default currency. Return strict JSON with keys: amount_minor (integer or null, e.g. 500 for five dollars), currency (3-letter ISO code or null), confidence (0-1).`
            },
            {
              type: "input_text",
              text: text
            }
          ]
        }
      ],
      text: { format: { type: "json_object" } }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI text extraction failed with status ${response.status}`);
  }

  const json = (await response.json()) as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  const outputText = extractOutputText(json);
  if (!outputText) {
    return null;
  }

  const parsed = safeJsonParse(outputText);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const rawAmount = (parsed as { amount_minor?: unknown }).amount_minor;
  const rawCurrency = (parsed as { currency?: unknown }).currency;
  const rawConfidence = (parsed as { confidence?: unknown }).confidence;

  const amountMinor = typeof rawAmount === "number" && Number.isFinite(rawAmount) ? Math.round(rawAmount) : null;
  const currency = typeof rawCurrency === "string" && /^[A-Z]{3}$/.test(rawCurrency.toUpperCase()) ? rawCurrency.toUpperCase() : null;
  const confidence = typeof rawConfidence === "number" && Number.isFinite(rawConfidence) ? clamp(rawConfidence, 0, 1) : 0.5;

  return {
    amountMinor,
    currency,
    confidence,
    needsReview: confidence < 0.9 || amountMinor === null || currency === null,
    metadata: {
      source: "openai_text",
      originalText: text
    }
  };
}

export async function extractAmountCurrencyFromR2Image(
  env: Env,
  r2ObjectKey: string,
  userCurrency: string | null
): Promise<OpenAIExtraction | null> {
  const object = await env.MEDIA_BUCKET.get(r2ObjectKey);
  if (!object) {
    return null;
  }

  if (!env.OPENAI_API_KEY) {
    return null;
  }

  const bytes = new Uint8Array(await object.arrayBuffer());
  const mime = object.httpMetadata?.contentType ?? inferMimeType(r2ObjectKey);
  const base64 = toBase64(bytes);
  const dataUrl = `data:${mime};base64,${base64}`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENAI_VISION_MODEL ?? "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                `Extract only the total amount and currency from this receipt image. The user's default currency is ${userCurrency ?? "unknown"}. If the receipt shows a generic symbol like "$" or "dollars", assume it means their default currency. Return strict JSON with keys: amount_minor (integer or null), currency (3-letter ISO code or null), confidence (0-1).`
            },
            {
              type: "input_image",
              image_url: dataUrl
            }
          ]
        }
      ],
      text: { format: { type: "json_object" } }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI vision extraction failed with status ${response.status}`);
  }

  const json = (await response.json()) as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  const outputText = extractOutputText(json);
  if (!outputText) {
    return null;
  }

  const parsed = safeJsonParse(outputText);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const rawAmount = (parsed as { amount_minor?: unknown }).amount_minor;
  const rawCurrency = (parsed as { currency?: unknown }).currency;
  const rawConfidence = (parsed as { confidence?: unknown }).confidence;

  const amountMinor = typeof rawAmount === "number" && Number.isFinite(rawAmount) ? Math.round(rawAmount) : null;
  const currency = typeof rawCurrency === "string" && /^[A-Z]{3}$/.test(rawCurrency.toUpperCase()) ? rawCurrency.toUpperCase() : null;
  const confidence = typeof rawConfidence === "number" && Number.isFinite(rawConfidence) ? clamp(rawConfidence, 0, 1) : 0.5;

  return {
    amountMinor,
    currency,
    confidence,
    needsReview: confidence < 0.9 || amountMinor === null || currency === null,
    metadata: {
      source: "openai_vision",
      r2ObjectKey
    }
  };
}

function extractOutputText(response: { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }): string | null {
  for (const item of response.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && part.text) {
        return part.text;
      }
    }
  }
  return null;
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    const start = input.indexOf("{");
    const end = input.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(input.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function inferFileExtension(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".mp3")) return "mp3";
  if (lower.endsWith(".wav")) return "wav";
  if (lower.endsWith(".m4a")) return "m4a";
  if (lower.endsWith(".ogg") || lower.endsWith(".oga")) return "ogg";
  if (lower.endsWith(".webm")) return "webm";
  return "mp3";
}

function inferMimeType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
