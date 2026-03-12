# Code Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce duplication and improve structure in `src/ai/openai.ts` and `src/queue.ts` without changing any business logic.

**Architecture:** Two independent refactors. Task 1 extracts a shared OpenAI fetch+parse+map core used by both extraction functions. Task 2 moves inline SQL from `queue.ts` into the `db/` layer and splits the 360-line queue handler into focused functions. All public function signatures remain identical — callers don't change.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, D1, Vitest + @cloudflare/vitest-pool-workers

**Verification commands:**
- `npm run check` — TypeScript (must be clean after every task)
- `npm run test` — 7 files, 21 tests (must all pass after every task)

---

## Task 1: Deduplicate OpenAI extraction functions in `openai.ts`

`extractAmountCurrencyFromText` (lines 142–224) and `extractAmountCurrencyFromR2Image` (lines 226–328) share identical logic for:
- Building the locale context string
- Calling the OpenAI chat completions endpoint
- Parsing and Zod-validating the response
- Mapping validated fields to `OpenAIExtraction`

They differ only in:
- The `content` array sent to OpenAI (text-only vs text+image_url)
- The prompt wording (minor differences)
- The `metadata` shape in the returned object (`originalText` vs `r2ObjectKey`)
- `max_tokens: 500` present only on vision

**Approach:** Extract a private `callOpenAIExtraction(env, messages, errorLabel)` helper that handles fetch → parse → validate → map. Both public functions build their own `messages` array, then call this helper.

**Files:**
- Modify: `src/ai/openai.ts`

---

**Step 1: Add the private `callOpenAIExtraction` helper**

Insert this function between the existing `extractAmountCurrencyFromR2Image` and `extractOutputText` (around line 330). It takes the fully-built messages array and an error label for logging:

```ts
async function callOpenAIExtraction(
  env: Env,
  messages: unknown[],
  errorLabel: string,
  maxTokens?: number
): Promise<{ data: ReturnType<typeof OpenAIResponseSchema.parse>; outputText: string } | null> {
  const body: Record<string, unknown> = {
    model: env.OPENAI_VISION_MODEL ?? "gpt-4o-mini",
    messages,
    response_format: { type: "json_object" }
  };
  if (maxTokens !== undefined) body.max_tokens = maxTokens;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
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

  return { data: validationResult.data, outputText };
}
```

Also extract the shared field-mapping logic into a private helper right below it:

```ts
function mapExtractionFields(data: ReturnType<typeof OpenAIResponseSchema.parse>) {
  const { amount: rawAmount, currency: rawCurrency, description: rawDescription, category: rawCategory, tags: rawTags, confidence: rawConfidence } = data;

  const amountMinor = typeof rawAmount === "number" && Number.isFinite(rawAmount) ? Math.round(rawAmount * 100) : null;
  const currency = typeof rawCurrency === "string" && /^[A-Z]{3}$/.test(rawCurrency.toUpperCase()) ? rawCurrency.toUpperCase() : null;
  const description = typeof rawDescription === "string" ? rawDescription.trim() : null;
  const category = typeof rawCategory === "string" ? rawCategory : "Other";
  const tags = Array.isArray(rawTags) ? rawTags : [];
  const confidence = typeof rawConfidence === "number" && Number.isFinite(rawConfidence) ? clamp(rawConfidence, 0, 1) : 0.5;

  return { amountMinor, currency, description, category, tags, confidence };
}
```

**Step 2: Rewrite `extractAmountCurrencyFromText` to use the helpers**

Replace the full body of `extractAmountCurrencyFromText` with:

```ts
export async function extractAmountCurrencyFromText(
  env: Env,
  text: string,
  userCurrency: string | null,
  userTimezone: string | null,
  historicalContext: string = ""
): Promise<OpenAIExtraction | null> {
  if (!env.OPENAI_API_KEY) return null;

  const localeContext = `The user's local timezone is ${userTimezone ?? "unknown"} and their default currency is ${userCurrency ?? "unknown"}. Use this geographical context to understand local establishments, slang, and brands (e.g., if timezone is Asia/Manila, 'Andoks' is Food. If Asia/Singapore, 'Grab' is Transport, etc).`;

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

  const { amountMinor, currency, description, category, tags, confidence } = mapExtractionFields(result.data);

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
```

**Step 3: Rewrite `extractAmountCurrencyFromR2Image` to use the helpers**

Replace the full body with:

```ts
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

  const localeContext = `The user's local timezone is ${userTimezone ?? "unknown"} and their default currency is ${userCurrency ?? "unknown"}. Use this geographical context to understand local establishments, slang, and brands (e.g., if timezone is Asia/Manila, 'Andoks' is Food. If Asia/Singapore, 'Grab' is Transport, etc).`;

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

  const { amountMinor, currency, description, category, tags, confidence } = mapExtractionFields(result.data);

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
```

**Step 4: Delete the now-redundant duplicated code**

The old bodies of both functions (lines 155–224 and 254–327 approximately) are replaced by the above. The shared helpers `extractOutputText`, `safeJsonParse`, `inferFileExtension`, `inferMimeType`, `toBase64`, `clamp` at the bottom of the file remain unchanged.

**Step 5: Run type check**

```bash
npm run check
```

Expected: no errors.

**Step 6: Run tests**

```bash
npm run test
```

Expected: 7 files, 21 tests, all pass.

**Step 7: Commit**

```bash
git add src/ai/openai.ts
git commit -m "refactor: extract shared callOpenAIExtraction and mapExtractionFields helpers in openai.ts"
```

---

## Task 2: Break up `queue.ts` — extract DB helpers and split handler

`queue.ts` currently has three problems:
1. Inline SQL for fetching source events belongs in `src/db/source-events.ts`
2. Inline SQL for inserting parse results and expenses belongs in `src/db/parse-results.ts` (new) and `src/db/expenses.ts`
3. `handleParseQueueBatch` does routing + fetching + extraction + persistence + messaging all inline

**Approach:** Three sub-steps — move the source event fetch, move the write SQL, then extract `handleReceiptMessage`.

**Files:**
- Modify: `src/db/source-events.ts`
- Create: `src/db/parse-results.ts`
- Modify: `src/db/expenses.ts`
- Modify: `src/queue.ts`

---

### Sub-task 2a: Move source event fetch into `src/db/source-events.ts`

**Step 1: Add `getSourceEventForQueue` to `src/db/source-events.ts`**

Read `src/db/source-events.ts` first, then append this function:

```ts
export type SourceEventForQueue = {
  id: number;
  user_id: number;
  message_type: "text" | "photo" | "voice";
  text_raw: string | null;
  r2_object_key: string | null;
  received_at_utc: string;
  user_currency: string | null;
  user_timezone: string | null;
  telegram_id: number | null;
};

export async function getSourceEventForQueue(
  db: D1Database,
  sourceEventId: number
): Promise<SourceEventForQueue | null> {
  return db.prepare(
    `SELECT se.id, se.user_id, se.message_type, se.text_raw, se.r2_object_key, se.received_at_utc,
            u.currency AS user_currency, u.timezone AS user_timezone, u.telegram_user_id AS telegram_id
     FROM source_events se
     LEFT JOIN users u ON u.id = se.user_id
     WHERE se.id = ?`
  )
    .bind(sourceEventId)
    .first<SourceEventForQueue>();
}
```

**Step 2: Update `src/queue.ts` to use it**

Replace the inline `env.DB.prepare(...)` source event fetch block with:

```ts
import { getSourceEventForQueue } from "./db/source-events";

// In handleParseQueueBatch, replace the inline query:
const sourceEvent = await getSourceEventForQueue(env.DB, message.body.sourceEventId);
```

**Step 3: Run type check and tests**

```bash
npm run check && npm run test
```

Expected: clean + 21 tests pass.

---

### Sub-task 2b: Move write SQL into `db/` modules

**Step 1: Create `src/db/parse-results.ts`**

```ts
import type { D1Database } from "@cloudflare/workers-types";

export async function insertParseResult(
  db: D1Database,
  sourceEventId: number,
  parserVersion: string,
  parsedJson: Record<string, unknown>,
  confidence: number,
  needsReview: boolean
): Promise<void> {
  await db.prepare(
    `INSERT INTO parse_results (
       source_event_id, parser_version, parsed_json,
       confidence, needs_review, created_at_utc
     ) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      sourceEventId,
      parserVersion,
      JSON.stringify(parsedJson),
      confidence,
      needsReview ? 1 : 0,
      new Date().toISOString()
    )
    .run();
}
```

**Step 2: Add `insertExpense` to `src/db/expenses.ts`**

Read `src/db/expenses.ts` first, then append:

```ts
export async function insertExpense(
  db: D1Database,
  userId: number,
  sourceEventId: number,
  amountMinor: number,
  currency: string,
  category: string,
  tags: string[],
  occurredAtUtc: string,
  needsReview: boolean
): Promise<void> {
  await db.prepare(
    `INSERT INTO expenses (
       user_id, source_event_id, amount_minor, currency,
       category, tags, occurred_at_utc, status, created_at_utc
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_event_id) DO NOTHING`
  )
    .bind(
      userId,
      sourceEventId,
      amountMinor,
      currency,
      category,
      JSON.stringify(tags),
      occurredAtUtc,
      needsReview ? "needs_review" : "final",
      new Date().toISOString()
    )
    .run();
}
```

**Step 3: Update `src/queue.ts` imports and replace inline SQL**

Add imports:
```ts
import { insertParseResult } from "./db/parse-results";
import { insertExpense } from "./db/expenses";
```

Replace the `env.DB.prepare("INSERT INTO parse_results ...")` block with:
```ts
await insertParseResult(
  env.DB,
  sourceEvent.id,
  sourceEvent.message_type === "text" ? "v1-text-parser" : "v1-multimodal-parser",
  extraction.parsedJson,
  extraction.confidence,
  extraction.needsReview
);
```

Replace the `env.DB.prepare("INSERT INTO expenses ...")` block with:
```ts
await insertExpense(
  env.DB,
  sourceEvent.user_id,
  sourceEvent.id,
  extraction.amountMinor,
  extraction.currency,
  extraction.category ?? "Other",
  extraction.tags ?? [],
  sourceEvent.received_at_utc,
  extraction.needsReview
);
```

**Step 4: Run type check and tests**

```bash
npm run check && npm run test
```

Expected: clean + 21 tests pass.

**Step 5: Commit**

```bash
git add src/db/source-events.ts src/db/parse-results.ts src/db/expenses.ts src/queue.ts
git commit -m "refactor: move inline SQL from queue.ts into db/ layer"
```

---

### Sub-task 2c: Extract `handleReceiptMessage` function

**Step 1: Extract the receipt handling block in `src/queue.ts`**

Everything inside the `// Fallback: Receipt Data Ingestion Router` comment block — from the `getSourceEventForQueue` call through `message.ack()` — becomes a standalone function:

```ts
async function handleReceiptMessage(
  env: Env,
  ctx: ExecutionContext,
  body: Extract<ParseQueueMessage, { type: "receipt" }>
): Promise<void> {
  const sourceEvent = await getSourceEventForQueue(env.DB, body.sourceEventId);

  if (!sourceEvent) {
    throw new Error(`Source event not found: ${body.sourceEventId}`);
  }

  const extraction = await extractForSourceEvent(env, sourceEvent, body.r2ObjectKey);

  await insertParseResult(
    env.DB,
    sourceEvent.id,
    sourceEvent.message_type === "text" ? "v1-text-parser" : "v1-multimodal-parser",
    extraction.parsedJson,
    extraction.confidence,
    extraction.needsReview
  );

  if (extraction.amountMinor !== null && extraction.currency) {
    await insertExpense(
      env.DB,
      sourceEvent.user_id,
      sourceEvent.id,
      extraction.amountMinor,
      extraction.currency,
      extraction.category ?? "Other",
      extraction.tags ?? [],
      sourceEvent.received_at_utc,
      extraction.needsReview
    );

    if (sourceEvent.telegram_id) {
      const formattedMinor = (extraction.amountMinor / 100).toFixed(2);
      let replyText = `✅ Logged: ${extraction.currency} ${formattedMinor}`;
      if (extraction.needsReview) {
        replyText += `\n⚠️ Marked for review (confidence: ${Math.round(extraction.confidence * 100)}%)`;
      }
      await sendTelegramChatMessage(env, sourceEvent.telegram_id, replyText);
    }

    if (!extraction.needsReview && sourceEvent.text_raw && sourceEvent.text_raw.trim() !== "") {
      ctx.waitUntil((async () => {
        try {
          const embedding = await generateEmbedding(env, sourceEvent.text_raw!);
          if (embedding.length > 0) {
            await env.VECTORIZE.upsert([{
              id: `expense_${sourceEvent.id}`,
              values: embedding,
              metadata: {
                user_id: sourceEvent.user_id,
                expense_id: sourceEvent.id,
                category: extraction.category ?? "Other",
                tags: JSON.stringify(extraction.tags ?? []),
                currency: extraction.currency ?? "",
                raw_text: sourceEvent.text_raw ?? ""
              }
            }]);
          }
        } catch (err) {
          console.error("Failed to sync embedding to Vectorize:", err);
        }
      })());
    }
  } else {
    if (sourceEvent.telegram_id) {
      const reason = String(extraction.parsedJson.reason || "unrecognized format");
      await sendTelegramChatMessage(env, sourceEvent.telegram_id, `❌ Failed to extract amount: ${reason}`);
    }
  }
}
```

**Step 2: Replace the inline block in `handleParseQueueBatch` with a call**

The full `try` body of `handleParseQueueBatch` becomes:

```ts
try {
  if (message.body.type === "chat") {
    await runSemanticChat(
      env,
      message.body.userId,
      message.body.telegramId,
      message.body.timezone,
      message.body.tier,
      message.body.text
    );
  } else {
    await handleReceiptMessage(env, ctx, message.body);
  }
  message.ack();
} catch (error) {
  // ... existing error handler unchanged
}
```

Note: `message.ack()` moves to after both branches since both paths should ack on success.

**Step 3: Run type check and tests**

```bash
npm run check && npm run test
```

Expected: clean + 21 tests pass.

**Step 4: Commit**

```bash
git add src/queue.ts
git commit -m "refactor: extract handleReceiptMessage from handleParseQueueBatch in queue.ts"
```

---

## Execution Order

1. Task 1 (openai.ts dedup) — independent, do first
2. Task 2a (source event fetch) → 2b (write SQL) → 2c (extract handler) — must be sequential, each builds on the previous

Total: 4 commits, no behavior changes, no new public API surface.
