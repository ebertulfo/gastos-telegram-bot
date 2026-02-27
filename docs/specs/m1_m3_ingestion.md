# Specification: M1-M3 Ingestion & Queue Pipeline

## 1. Intent (The "What")
* **Goal**: To retroactively define the core ingestion pipeline architecture (Webhook -> D1 -> R2 -> Queue -> OpenAI), while simultaneously fixing a critical UX flaw: the user currently receives two disconnected push notifications ("Saved ✅" from the Webhook, followed by "Logged ✅" from the Queue) for a single expense entry.
* **Scope**: The Telegram Webhook request path, the `source_events` DB insertion, the R2 media upload, the Cloudflare Queue enqueue, and the `expenses` AI parse path.
* **UX Fix Scope**: We will eliminate the Webhook's "Saved ✅" message entirely for new expenses. We will also eliminate the "Already saved ✅" message for duplicate retries. The user will simply submit their expense, wait for the AI (1-3 seconds), and receive a single, final "✅ Logged: [Amount]" message from the Queue. 

## 2. Architecture & Data Flow (The "How")
* **External APIs**: 
    * Telegram Webhook (Ingestion) -> Zod Validated.
    * Cloudflare R2 (Media Storage).
    * OpenAI GPT-4o-mini (Vision/Text Parsing).
* **Worker Layer (Webhook Path)**: 
    * Validates Telegram JSON -> Upserts User -> Persists `source_events` (UTC timestamp) -> Uploads R2 media if present.
    * **CHANGE**: Do *not* fire `sendTelegramChatMessage("Saved ✅")` if the event is new.
    * **CHANGE**: Do *not* fire `sendTelegramChatMessage("Already saved ✅")` if `source_event.duplicate` is true. This is a system-level retry guard and should not leak to the user.
    * **CHANGE**: Instead of pinging the user, emit a `console.warn("Duplicate Telegram payload received", { messageId })` so operators can monitor webhook latency and retry health via **Cloudflare Logpush**.
    * Enqueue message to `INGEST_QUEUE`. Return `200 OK` to Telegram silently.
* **Worker Layer (Queue Path)**:
    * Consume queue -> Fetch `source_events` -> Call OpenAI extraction -> Insert `parse_results` -> Insert `expenses`.
    * Fire `sendTelegramChatMessage("✅ Logged: ...")`.

## 3. Data Contract (The Schema)
* **Zod Schemas**: 
    * Telegram Webhook: Strictly validated via `updateSchema` in `src/routes/webhook.ts`.
    * OpenAI Output: Strictly validated via `OpenAIResponseSchema` in `src/ai/openai.ts`.
* **Database Models**: 
    * `source_events` uses a unique index on `(telegram_chat_id, telegram_message_id)` to gracefully catch duplicates on insert.
    * `expenses` maintains a 1-to-1 foreign key back to `source_events.id`.

## 4. Edge Cases & Constraints (The "What Not")
* **Failures**: If OpenAI returns a 500 or hallucinates bad JSON, Zod will trap it. The Queue will degrade the result to "unprocessed", mark `needsReview: true`, save the row, and reply "❌ Failed to extract amount" instead of crashing silently.
* **Idempotency (System-Level)**: Retrying a failed Queue message must not duplicate the `expenses` row (`ON CONFLICT(source_event_id) DO NOTHING`).
* **User-Level Semantic Duplication (Text/Voice/Photo)**: If a user sends the exact same semantic payload multiple times (e.g. typing "Food 5" twice, or uploading the same Camera Roll photo twice), the system will ingest them as separate expenses. We **explicitly punt** cross-modality deduplication to **M9 (Vectorize Setup)**. Brittle string/byte hashing is throwaway work; M9's Vector embeddings will provide a robust structural solution for detecting semantic duplicates.

## 5. Acceptance Criteria
* [ ] The user sends an expense text/photo.
* [ ] The Webhook returns 200 silently (no "Saved" message).
* [ ] The Queue processes the extraction and delivers a single "✅ Logged" message to the user.
* [ ] Sending the exact same message ID again correctly triggers the database duplicate guard, remains completely silent to the user, but emits a `console.warn` in the Cloudflare Worker logs for observability.
