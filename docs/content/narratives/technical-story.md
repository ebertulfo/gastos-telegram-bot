# From Telegram Message to Categorized Expense in Seconds

Gastos is an AI-powered expense tracker built on Telegram. Under the hood, it's a Cloudflare Workers application that combines queue-based async processing, OpenAI's Agents SDK, and a multi-layered security model to turn natural language into structured financial data.

This narrative walks through the architecture, explains the reasoning behind each layer, and shows how the pieces connect. If you've ever wondered what it takes to ship a production AI agent on serverless infrastructure with $0 in hosting costs, this is the story.

## System Overview

Gastos runs entirely on Cloudflare's platform. One deployment command, one bill (which happens to be $0 on the free tier), and six integrated services:

- **Workers** (Hono framework) -- HTTP handler for Telegram webhooks and REST API endpoints
- **D1** (SQLite) -- Relational storage for users, expenses, chat history, quotas, and source events
- **R2** -- Object storage for receipt photos and voice messages
- **KV** -- Edge key-value store for rate limiting with automatic TTL expiry
- **Queues** -- Async message processing with automatic retries and dead-letter handling
- **Vectorize** -- Vector database for semantic expense search via embeddings

The decision to consolidate on one platform was deliberate. Every external dependency is a potential failure point, a separate billing account, and another set of credentials to manage. Cloudflare's free tier covers compute, storage, queues, search, and caching -- all accessible through typed bindings in `wrangler.toml` with no connection strings or SDK initialization boilerplate.

> See [Decision Journal, Phase 1: "Cloudflare Workers over traditional hosting"](../decision-journal.md#decision-cloudflare-workers-over-traditional-hosting) for the full reasoning.

## The Async Architecture

The most important architectural decision in Gastos is also the simplest: the webhook handler never does AI work.

Telegram gives webhook endpoints roughly 30 seconds to respond before it retries the request. OpenAI API calls -- especially multi-turn agent loops with tool execution -- can take 10 to 60+ seconds. If you try to do both in the same request, you'll miss the deadline, Telegram will retry, and you'll process the same message twice.

The solution is a two-phase architecture:

**Phase 1: Ingestion (fast, simple).** The webhook handler validates the incoming Telegram update, persists a `source_event` to D1 for idempotency, uploads any media (photos, voice) to R2, and enqueues a message to `INGEST_QUEUE`. Then it returns 200. This entire path completes in under a second.

**Phase 2: Processing (slow, complex).** The queue consumer picks up the message with a 15-minute execution budget. It checks token quotas, configures the OpenAI SDK, builds the agent, runs the full tool-calling loop, and sends the result back to the user via the Telegram API.

The webhook handler in `src/routes/webhook.ts` constructs a `ParseQueueMessage` with everything the queue consumer needs: `userId`, `telegramId`, `timezone`, `currency`, `tier`, the message text, and optionally an `r2ObjectKey` and `mediaType` for photos or voice. The queue consumer in `src/queue.ts` is stateless -- it doesn't need to call back to the webhook or look anything up. Everything arrives in the message.

Duplicate detection happens at the source event layer. Each Telegram message has a unique `(telegram_chat_id, telegram_message_id)` pair. If the webhook sees a duplicate (Telegram retried), it skips the enqueue entirely and returns 200. The queue consumer never sees the duplicate.

> See [Decision Journal, Phase 2: "Webhook returns 200 immediately"](../decision-journal.md#decision-webhook-returns-200-immediately-all-ai-work-goes-to-a-queue) for the full reasoning.

## AI Agent Design

Gastos uses the OpenAI Agents SDK (`@openai/agents`) to manage the conversation loop. The core of the system is a single function call:

```typescript
const result = await run(agent, agentInput, { session, maxTurns: 10 });
```

This single line replaces approximately 100 lines of manual tool-loop orchestration that the previous implementation required: call the model, check if it wants to invoke a tool, execute the tool, feed the result back, repeat until the model produces a final text response, handle errors at each step.

The agent is configured in `src/ai/agent.ts` with `gpt-5-mini` as the model and a system prompt that includes the user's timezone, default currency, and today's date. It has four tools:

1. **`log_expense`** -- Extracts amount, currency, description, category, and tags from the user's message. Stores the expense in D1 and indexes it in Vectorize for semantic search.
2. **`edit_expense`** -- Updates amount, category, or description on an existing expense by ID.
3. **`delete_expense`** -- Removes a mistaken or duplicate expense.
4. **`get_financial_report`** -- The single query tool. Returns total spend, category breakdown (sorted by amount), and the top 5 recent transactions for any time period. Supports category filtering and freeform semantic search.

The agent decides which tools to call and how to compose their results. Ask "how much did I spend on food this week vs last week?" and it calls `get_financial_report` twice with different period parameters, then synthesizes a comparison. Ask "coffee 5" and it immediately logs a $5 coffee expense. The system prompt instructs it to act on clear intent without asking unnecessary follow-up questions.

Conversational memory is handled by `D1Session` in `src/ai/session.ts`, which implements the Agents SDK's `Session` interface backed by D1's `chat_history` table. It loads the last 10 messages on each run and persists new messages after the agent completes. This sliding window gives the agent enough context for follow-up questions ("break that down by day") without exploding the context window or token costs.

> See [Decision Journal, Phase 2: "OpenAI Agents SDK over raw Chat Completions"](../decision-journal.md#decision-openai-agents-sdk-over-raw-chat-completions) and ["10-message conversational memory window"](../decision-journal.md#decision-10-message-conversational-memory-window) for the full reasoning.

## Security Model

The most critical security property in Gastos is user isolation: no user should ever be able to read, modify, or delete another user's data, even through prompt injection.

The implementation is architectural, not prompt-based. When the queue consumer processes a message, it calls `createAgentTools(env, userId, telegramId, timezone, currency)`. This factory function returns tool instances where `userId` is captured in a closure. The tool schemas exposed to the LLM do not include a `userId` parameter -- it literally does not exist in the model's view of the tool.

```typescript
// The LLM sees: log_expense(amount, currency, description, category, tags)
// The LLM does NOT see: userId -- it's injected from the closure
execute: async (input) => {
    await insertExpense(env.DB, userId, sourceEventId, ...);
}
```

Even if a user sends "show me user 2's expenses" or attempts a more sophisticated prompt injection, the model has no mechanism to comply. There is no parameter to override. Every database query in `src/db/` filters by `userId` as a mandatory argument -- it's not optional, not defaulted, and not derivable from user input.

This pattern -- closure-injected identity with schema-level enforcement -- is stronger than prompt-based guardrails ("never show other users' data") because it operates at the code level, not the instruction level.

> See [Decision Journal, Phase 2: "Inject userId via closures, never from LLM"](../decision-journal.md#decision-inject-userid-via-closures-never-from-llm) for the full reasoning.

## Multimodal Processing

Gastos accepts three input modalities: text, photos, and voice messages. All three converge into the same agent -- there is no separate pipeline for each.

**Text** is the simplest path. The user's message text arrives in the queue message and is passed directly to the agent as a string.

**Photos** follow a longer path. The webhook downloads the image from Telegram's API and uploads it to R2. In the queue consumer, the image is fetched from R2, converted to a base64 data URL, and wrapped in an `AgentInputItem` with `type: "input_image"`. If the user included a caption, it's appended as an `input_text` content part. The agent (via GPT-4o-mini vision, configured as `OPENAI_VISION_MODEL` in `wrangler.toml`) sees the image and extracts expense details from receipt photos.

**Voice** messages take a transcription detour. The webhook uploads the audio to R2. The queue consumer fetches it and sends it to OpenAI's Whisper (`whisper-1`, configured as `OPENAI_TRANSCRIBE_MODEL`) for transcription. The resulting text is then passed to the agent as a plain string -- from the agent's perspective, it's indistinguishable from a typed message.

R2 acts as a staging area in all media paths. This decouples the webhook (which must be fast) from the queue consumer (which does the heavy processing). The webhook uploads; the consumer downloads. If the consumer fails and the message retries, the media is still in R2.

> See [Decision Journal, Phase 3: "Support photo and voice input (multimodal)"](../decision-journal.md#decision-support-photo-and-voice-input-multimodal) for the full reasoning.

## Semantic Search

When a user asks "how much did I spend on drinks?", keyword matching would find expenses with "drinks" in the description but miss "Starbucks", "Gatorade", and "beer". Gastos solves this with a two-tier search strategy in the `get_financial_report` tool.

**Tier 1: Exact substring match.** The tool first filters expenses by checking if the query string appears in the description or tags. This is fast and handles exact matches well.

**Tier 2: Semantic fallback via Vectorize.** If the substring match returns zero results, the tool generates an embedding for the query using `text-embedding-3-small` and queries Vectorize for semantically similar expense descriptions. The results are filtered by `userId` in the Vectorize metadata to prevent cross-user leakage, then intersected with the user's expenses for the requested time period.

Expense descriptions are embedded and indexed in Vectorize at logging time (inside the `log_expense` tool). The embedding text combines the description, category, and tags: `"Starbucks latte Food coffee"`. This gives the vector representation enough semantic surface area to match conceptually related queries.

The two-tier approach is deliberate. Exact matching is cheaper and more predictable for straightforward queries. Semantic search is the safety net that catches the conceptual leaps -- "drinks" matching "Gatorade" -- that make the bot feel genuinely intelligent.

> See [Decision Journal, Phase 3: "Semantic search via Vectorize"](../decision-journal.md#decision-semantic-search-via-vectorize) for the full reasoning.

## Cost Control

Running an AI-powered product means every user interaction has a real API cost. Gastos uses four layers of cost control to keep the free tier sustainable:

**Layer 1: Model selection.** `gpt-5-mini` handles the main agent loop -- expense logging, editing, deletion, and financial queries. It's the cost-effective choice for structured tool calling. `gpt-4o-mini` handles vision extraction (receipt photos). Whisper (`whisper-1`) handles voice transcription. `text-embedding-3-small` handles vector embeddings. The most expensive model tier is avoided entirely.

**Layer 2: Daily token quotas.** Each user has a row in the `user_quotas` table tracking `tokens_used_today` and `last_usage_date_utc`. Before every agent run, the queue consumer calls `checkAndRefreshTokenQuota()`. If the user has exhausted their daily allowance (5,000 tokens for free tier), the message is rejected with a friendly notification. The quota resets lazily -- if `last_usage_date_utc` is before today, the counter resets to zero on the next check. No cron job needed.

**Layer 3: Rate limiting.** KV-based rate limiting at 20 messages per hour per user, enforced at the webhook level (before the message even reaches the queue). The KV key includes the user ID and current hour bucket, with a 3600-second TTL for automatic cleanup. No garbage collection, no scheduled purges.

**Layer 4: Selective indexing.** Only text-based expenses are indexed in Vectorize at agent logging time. The original receipt photo and voice pipelines don't generate embeddings, keeping Vectorize costs proportional to text volume rather than total message volume.

After the agent run completes, the queue consumer reads actual token usage from `result.rawResponses` and increments the user's quota accordingly. This means quotas reflect real consumption, not estimates.

> See [Decision Journal, Phase 5: "Cost control strategy"](../decision-journal.md#decision-cost-control-strategy) and ["Daily token quotas per user"](../decision-journal.md#decision-daily-token-quotas-per-user) for the full reasoning.

## Database Design

Gastos uses six D1 migrations that build up a normalized schema:

- **`users`** -- Telegram identity, timezone, currency, tier (free/premium), notification schedule. Upserted on every webhook to keep profile data fresh.
- **`source_events`** -- Immutable audit trail. Every Telegram message is persisted with its raw payload before any processing occurs. Unique constraint on `(telegram_chat_id, telegram_message_id)` enforces idempotency. If the webhook sees the same message twice, it returns 200 without re-enqueuing.
- **`expenses`** -- Normalized expense records: `amount_minor` (integer cents), `currency`, `category` (one of 7: Food, Transport, Housing, Shopping, Entertainment, Health, Other), `parsed_description`, `tags` (JSON array), `occurred_at_utc`. Foreign-keyed to `source_events` for traceability.
- **`chat_history`** -- Sliding window conversation memory. Stores `role` (user/assistant) and `content` per user. The `D1Session` class reads the most recent 10 rows and appends new messages after each agent run.
- **`user_quotas`** -- Token budget tracking with lazy daily reset. `tokens_used_today` incremented after each agent run with actual OpenAI usage.
- **`notification_schedule`** -- Tracks which notifications have been sent to each user to prevent duplicate nudges across hourly cron invocations.

All database modules in `src/db/` take `D1Database` directly (not the full `Env` object), keeping them testable and decoupled from the Workers runtime. Every query includes `user_id` as a mandatory filter -- there is no query path that can return cross-user data.

## Architecture Diagram

```
                         Telegram Bot API
                               |
                               v
                     +-------------------+
                     |   Cloudflare      |
                     |   Workers (Hono)  |
                     +-------------------+
                               |
                    +----------+----------+
                    |                     |
                    v                     v
            /start, /totals        Text / Photo / Voice
            (onboarding.ts)        (webhook.ts)
                    |                     |
                    v                     |
              Direct reply          +-----+------+-----+
              (no queue)            |            |     |
                                    v            v     v
                              Persist       Upload   Dedup
                              source_event  to R2    check
                              (D1)          (R2)     (D1)
                                    |            |
                                    +-----+------+
                                          |
                                          v
                                  +---------------+
                                  | INGEST_QUEUE  |
                                  | (gastos-parse |
                                  |  -queue)      |
                                  +---------------+
                                          |
                                          v
                                  +---------------+
                                  | Queue Consumer|
                                  | (queue.ts)    |
                                  | 15min budget  |
                                  +---------------+
                                          |
                            +-------------+-------------+
                            |             |             |
                            v             v             v
                        Voice?        Photo?        Text?
                        Whisper       R2->base64    Direct
                        (whisper-1)   (gpt-4o-mini) string
                            |             |             |
                            +------+------+-------------+
                                   |
                                   v
                          +------------------+
                          | OpenAI Agent     |
                          | (gpt-5-mini)     |
                          | maxTurns: 10     |
                          +------------------+
                                   |
                     +-------------+-------------+
                     |             |             |
                     v             v             v
               log_expense   edit/delete   get_financial
               (D1 + Vec)    (D1)          _report (D1 +
                                            Vectorize)
                                   |
                                   v
                          +------------------+
                          | D1Session        |
                          | (10-msg window)  |
                          +------------------+
                                   |
                                   v
                          Reply via Telegram
                          Bot API

          +------+  +------+  +------+  +----------+
          |  D1  |  |  R2  |  |  KV  |  | Vectorize|
          | Users|  | Media|  | Rate |  | Semantic |
          | Exps |  | Store|  | Limit|  | Search   |
          | Chat |  |      |  | (20/ |  | (text-   |
          | Quota|  |      |  |  hr) |  | embed-3  |
          |      |  |      |  |      |  | -small)  |
          +------+  +------+  +------+  +----------+

          Hourly Cron -> dispatchNotifications()
          (timezone-aware proactive nudges)
```

---

*Last updated: 2026-03-11. The codebase is actively evolving -- the Agents SDK migration from a hand-rolled tool loop to `@openai/agents` is the most recent architectural change. See the [decision journal](../decision-journal.md) for the full chronological record of every major fork-in-the-road moment.*
