import type { Env } from "../types";
import { z } from "zod";

const OpenAIResponseSchema = z.object({
  amount: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  confidence: z.number().nullable().optional()
});

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

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENAI_VISION_MODEL ?? "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `Extract the total amount, currency, and a short description from this transcribed message. The user might spell out numbers (e.g. "five dollars"). Convert it to digits. The user's default currency is ${userCurrency ?? "unknown"}. If the user says a generic currency word like "dollars" or "$", assume it means their default currency. Return strict JSON with keys: amount (number or null, e.g. 5.0 for five dollars), currency (3-letter ISO code or null), description (string, max 3 words, e.g. "Coffee" or "Food" or "Burger King"), confidence (0-1).`
            },
            {
              type: "text",
              text: text
            }
          ]
        }
      ],
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI text extraction failed with status ${response.status}`);
  }

  const json = (await response.json()) as any;
  const outputText = extractOutputText(json);
  if (!outputText) {
    console.error("No outputText extracted. AI Raw Response:", JSON.stringify(json, null, 2));
    return null;
  }

  const parsed = safeJsonParse(outputText);
  const validationResult = OpenAIResponseSchema.safeParse(parsed);

  if (!validationResult.success) {
    console.warn("OpenAI returned invalid JSON shape for text extraction", validationResult.error.format());
    return null;
  }

  const { amount: rawAmount, currency: rawCurrency, description: rawDescription, confidence: rawConfidence } = validationResult.data;

  const amountMinor = typeof rawAmount === "number" && Number.isFinite(rawAmount) ? Math.round(rawAmount * 100) : null;
  const currency = typeof rawCurrency === "string" && /^[A-Z]{3}$/.test(rawCurrency.toUpperCase()) ? rawCurrency.toUpperCase() : null;
  const description = typeof rawDescription === "string" ? rawDescription.trim() : null;
  const confidence = typeof rawConfidence === "number" && Number.isFinite(rawConfidence) ? clamp(rawConfidence, 0, 1) : 0.5;

  return {
    amountMinor,
    currency,
    confidence,
    needsReview: confidence < 0.9 || amountMinor === null || currency === null,
    metadata: {
      source: "openai_text",
      originalText: text,
      description
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

  let mime = object.httpMetadata?.contentType;
  if (!mime || mime === "application/octet-stream" || mime === "binary/octet-stream") {
    mime = inferMimeType(r2ObjectKey);
  }

  const base64 = toBase64(bytes);
  const dataUrl = `data:${mime};base64,${base64}`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENAI_VISION_MODEL ?? "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `Extract the total amount, currency, and a short description from this receipt image. The user's default currency is ${userCurrency ?? "unknown"}. If the receipt shows a generic symbol like "$" or "dollars", assume it means their default currency. Return strict JSON with keys: amount (number or null, e.g. 15.50), currency (3-letter ISO code or null), description (string, max 3 words, e.g. "Food" or "Groceries" or the merchant name), confidence (0-1).`
            },
            {
              type: "image_url",
              image_url: {
                url: dataUrl
              }
            }
          ]
        }
      ],
      response_format: { type: "json_object" },
      max_tokens: 500
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("OpenAI vision extraction 400 response:", errText);
    throw new Error(`OpenAI vision extraction failed with status ${response.status}`);
  }

  const json = (await response.json()) as any;
  const outputText = extractOutputText(json);
  if (!outputText) {
    console.error("No outputText extracted. AI Raw Response:", JSON.stringify(json, null, 2));
    return null;
  }

  const parsed = safeJsonParse(outputText);
  const validationResult = OpenAIResponseSchema.safeParse(parsed);

  if (!validationResult.success) {
    console.warn("OpenAI returned invalid JSON shape for vision extraction", validationResult.error.format());
    return null;
  }

  const { amount: rawAmount, currency: rawCurrency, description: rawDescription, confidence: rawConfidence } = validationResult.data;

  const amountMinor = typeof rawAmount === "number" && Number.isFinite(rawAmount) ? Math.round(rawAmount * 100) : null;
  const currency = typeof rawCurrency === "string" && /^[A-Z]{3}$/.test(rawCurrency.toUpperCase()) ? rawCurrency.toUpperCase() : null;
  const description = typeof rawDescription === "string" ? rawDescription.trim() : null;
  const confidence = typeof rawConfidence === "number" && Number.isFinite(rawConfidence) ? clamp(rawConfidence, 0, 1) : 0.5;

  return {
    amountMinor,
    currency,
    confidence,
    needsReview: confidence < 0.9 || amountMinor === null || currency === null,
    metadata: {
      source: "openai_vision",
      r2ObjectKey,
      description
    }
  };
}

function extractOutputText(response: any): string | null {
  if (response.choices && response.choices.length > 0) {
    const message = response.choices[0].message;
    if (message && message.content) {
      return message.content;
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
  const len = bytes.byteLength;
  for (let i = 0; i < len; i += 32768) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768) as unknown as number[]);
  }
  return btoa(binary);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
