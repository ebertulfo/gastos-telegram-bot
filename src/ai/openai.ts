import type { Env } from "../types";
import { z } from "zod";

const OpenAIResponseSchema = z.object({
  amount: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  category: z.enum([
    "Food", "Transport", "Housing", "Shopping", "Entertainment", "Health", "Other"
  ]).nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  confidence: z.number().nullable().optional()
});

export type OpenAIExtraction = {
  amountMinor: number | null;
  currency: string | null;
  category: string;
  tags: string[];
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

export async function generateEmbedding(env: Env, text: string): Promise<number[]> {
  if (!env.OPENAI_API_KEY || !text.trim()) {
    return [];
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text
    })
  });

  if (!response.ok) {
    console.error("Embedding failed", await response.text());
    return [];
  }

  const json = (await response.json()) as any;
  if (json.data && json.data.length > 0) {
    return json.data[0].embedding;
  }
  return [];
}

export async function getHistoricalContext(env: Env, userId: number, text: string): Promise<string> {
  const embedding = await generateEmbedding(env, text);
  if (!embedding.length) {
    return "";
  }

  try {
    const results = await env.VECTORIZE.query(embedding, { topK: 3, filter: { user_id: userId } });
    if (!results.matches || results.matches.length === 0) {
      return "";
    }

    let context = "\nHere are 3 of the user's most similar historical expenses. You MUST analyze these past decisions and align your current extraction (especially the Category and Tags) to match their historical precedent:\n";
    for (const match of results.matches) {
      if (match.metadata) {
        const m = match.metadata as any;
        context += `- Raw Text: "${m.raw_text}" -> Parsed as: [${m.category}]. Tags: ${m.tags}.\n`;
      }
    }
    return context;
  } catch (error) {
    console.error("Vectorize query failed", error);
    return "";
  }
}

/**
 * Semantic search for expenses via Vectorize.
 * Embeds the query text and returns matching expense source_event IDs.
 */
export async function searchExpensesBySemantic(
  env: Env,
  userId: number,
  query: string,
  topK: number = 20
): Promise<number[]> {
  const embedding = await generateEmbedding(env, query);
  if (!embedding.length) return [];

  try {
    const results = await env.VECTORIZE.query(embedding, {
      topK,
      filter: { user_id: userId },
      returnMetadata: "all"
    });

    if (!results.matches || results.matches.length === 0) return [];

    return results.matches
      .filter(m => m.metadata?.expense_id != null)
      .map(m => m.metadata!.expense_id as number);
  } catch (error) {
    console.error("Vectorize semantic search failed", error);
    return [];
  }
}

export async function extractAmountCurrencyFromText(
  env: Env,
  text: string,
  userCurrency: string | null,
  userTimezone: string | null,
  historicalContext: string = ""
): Promise<OpenAIExtraction | null> {
  if (!env.OPENAI_API_KEY) return null;

  const localeContext = buildLocaleContext(userTimezone, userCurrency);
  const messages = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `${localeContext}${historicalContext}\nExtract the total amount, currency, a short description, category, and tags from this transcribed message. The user might spell out numbers (e.g. "five dollars"). Convert it to digits. If the user says a generic currency word like "dollars" or "$", assume it means their default currency. CRITICAL: If the message contains a standalone number (e.g. "13 grab", "lunch 5.50", "20"), YOU MUST extract that number as the amount even if there is no explicit currency symbol present.\nReturn strict JSON with keys: amount (number or null), currency (3-letter ISO code or null), description (string, max 3 words), category (MUST be exactly one of: Food, Transport, Housing, Shopping, Entertainment, Health, Other), tags (array of 1-3 lowercase string contexts, e.g. ["coffee", "starbucks"]), confidence (0-1).`
        },
        { type: "text", text }
      ]
    }
  ];

  const result = await callOpenAIExtraction(env, messages, "text extraction");
  if (!result) return null;

  const { amountMinor, currency, description, category, tags, confidence } = mapExtractionFields(result);
  return {
    amountMinor,
    currency,
    category,
    tags,
    confidence,
    needsReview: confidence < 0.9 || amountMinor === null || currency === null || category === "Other",
    metadata: { source: "openai_text", originalText: text, description }
  };
}

export async function extractAmountCurrencyFromR2Image(
  env: Env,
  r2ObjectKey: string,
  userCurrency: string | null,
  userTimezone: string | null,
  historicalContext: string = ""
): Promise<OpenAIExtraction | null> {
  if (!env.OPENAI_API_KEY) return null;

  const object = await env.MEDIA_BUCKET.get(r2ObjectKey);
  if (!object) return null;

  const bytes = new Uint8Array(await object.arrayBuffer());
  let mime = object.httpMetadata?.contentType;
  if (!mime || mime === "application/octet-stream" || mime === "binary/octet-stream") {
    mime = inferMimeType(r2ObjectKey);
  }
  const dataUrl = `data:${mime};base64,${toBase64(bytes)}`;

  const localeContext = buildLocaleContext(userTimezone, userCurrency);
  const messages = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `${localeContext}${historicalContext}\nExtract the total amount, currency, a short description, category, and tags from this receipt image. If the receipt shows a generic symbol like "$" or "dollars", assume it means their default currency. CRITICAL: If the receipt only has a prominent number without a currency symbol, YOU MUST extract that number as the amount.\nReturn strict JSON with keys: amount (number or null), currency (3-letter ISO code or null), description (string, max 3 words), category (MUST be exactly one of: Food, Transport, Housing, Shopping, Entertainment, Health, Other), tags (array of 1-3 lowercase string contexts, e.g. ["coffee", "starbucks"]), confidence (0-1).`
        },
        { type: "image_url", image_url: { url: dataUrl } }
      ]
    }
  ];

  const result = await callOpenAIExtraction(env, messages, "vision extraction", 500);
  if (!result) return null;

  const { amountMinor, currency, description, category, tags, confidence } = mapExtractionFields(result);
  return {
    amountMinor,
    currency,
    category,
    tags,
    confidence,
    needsReview: confidence < 0.9 || amountMinor === null || currency === null || category === "Other",
    metadata: { source: "openai_vision", r2ObjectKey, description }
  };
}

function buildLocaleContext(userTimezone: string | null, userCurrency: string | null): string {
  return `The user's local timezone is ${userTimezone ?? "unknown"} and their default currency is ${userCurrency ?? "unknown"}. Use this geographical context to understand local establishments, slang, and brands (e.g., if timezone is Asia/Manila, 'Andoks' is Food. If Asia/Singapore, 'Grab' is Transport, etc).`;
}

async function callOpenAIExtraction(
  env: Env,
  messages: unknown[],
  errorLabel: string,
  maxTokens?: number
): Promise<z.infer<typeof OpenAIResponseSchema> | null> {
  const body: Record<string, unknown> = {
    model: env.OPENAI_VISION_MODEL ?? "gpt-4.1-nano",
    messages,
    response_format: { type: "json_object" }
  };
  if (maxTokens !== undefined) body.max_tokens = maxTokens;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY!}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`OpenAI ${errorLabel} error response:`, errText);
    throw new Error(`OpenAI ${errorLabel} failed with status ${response.status}`);
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
    console.warn(`OpenAI returned invalid JSON shape for ${errorLabel}`, validationResult.error.format());
    return null;
  }

  return validationResult.data;
}

function mapExtractionFields(data: z.infer<typeof OpenAIResponseSchema>): {
  amountMinor: number | null;
  currency: string | null;
  description: string | null;
  category: string;
  tags: string[];
  confidence: number;
} {
  const { amount: rawAmount, currency: rawCurrency, description: rawDescription, category: rawCategory, tags: rawTags, confidence: rawConfidence } = data;

  const amountMinor = typeof rawAmount === "number" && Number.isFinite(rawAmount) ? Math.round(rawAmount * 100) : null;
  const currency = typeof rawCurrency === "string" && /^[A-Z]{3}$/.test(rawCurrency.toUpperCase()) ? rawCurrency.toUpperCase() : null;
  const description = typeof rawDescription === "string" ? rawDescription.trim() : null;
  const category = typeof rawCategory === "string" ? rawCategory : "Other";
  const tags = Array.isArray(rawTags) ? rawTags : [];
  const confidence = typeof rawConfidence === "number" && Number.isFinite(rawConfidence) ? clamp(rawConfidence, 0, 1) : 0.5;

  return { amountMinor, currency, description, category, tags, confidence };
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
