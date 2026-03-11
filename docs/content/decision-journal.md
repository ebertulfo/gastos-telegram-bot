# Gastos Decision Journal

> Every major fork-in-the-road moment in building Gastos, organized chronologically.
> This journal is the backbone of all Gastos documentation — narratives, blog posts,
> and landing page content are derived from it.

## Phase 0: The Problem

### Decision: Build an expense tracker at all
**Context:** [YOUR INPUT NEEDED — What was your personal pain point? What existing apps did you try and why did they fall short?]
**Options considered:** Use an existing app (Mint, YNAB, Money Lover, spreadsheet) vs. build something custom
**Choice:** [YOUR INPUT NEEDED — Why build instead of use?]
**Outcome:** Gastos project started

### Decision: Build it as a Telegram bot
**Context:** [YOUR INPUT NEEDED — Why Telegram specifically? Is it your daily driver? Did you consider other platforms?]
**Options considered:** Standalone mobile app, web app, WhatsApp bot, Telegram bot, Discord bot
**Choice:** [YOUR INPUT NEEDED]
**Outcome:** Conversational UX with zero app-switching friction; access to Telegram's Mini App platform for when users need a full dashboard

## Phase 1: Foundation

### Decision: Cloudflare Workers over traditional hosting
**Context:** Need a runtime for the bot. Key requirements: low latency globally, handles webhook traffic, affordable at low scale, supports background processing.
**Options considered:** Vercel serverless, AWS Lambda, Railway/Fly.io (container), Cloudflare Workers
**Choice:** [YOUR INPUT NEEDED — What drew you to Cloudflare specifically? Was it the integrated ecosystem (D1/R2/KV/Queues/Vectorize all in one)?]
**Outcome:** Single platform for compute, database, storage, queues, search, and caching. No external dependencies. D1 = SQLite (simple), R2 = blob storage (receipts), KV = rate limiting, Queues = async processing, Vectorize = semantic search.

### Decision: D1 (SQLite) over Postgres/Supabase
**Context:** Need a database for users, expenses, chat history. D1 is Cloudflare-native SQLite.
**Options considered:** Supabase (Postgres), PlanetScale (MySQL), Turso (SQLite), D1 (SQLite)
**Choice:** [YOUR INPUT NEEDED — Was it simplicity? Staying in the Cloudflare ecosystem? Cost?]
**Outcome:** Zero-config database on the same platform. SQL migrations via wrangler. Single request context (no connection pooling needed). Trade-off: no advanced Postgres features, but SQLite is sufficient for this use case.

### Decision: Hono as the HTTP framework
**Context:** Need a lightweight framework for webhook routes and API endpoints on Workers.
**Options considered:** Raw fetch handler, Express-like (itty-router), Hono
**Choice:** [YOUR INPUT NEEDED]
**Outcome:** Hono provides typed middleware, route grouping, and a familiar Express-like API. Minimal overhead on Workers. Built-in TypeScript support.

### Decision: TypeScript with strict mode + Zod
**Context:** Need type safety across webhook parsing, database queries, and AI tool definitions.
**Options considered:** Plain JavaScript, TypeScript (loose), TypeScript strict + Zod
**Choice:** [YOUR INPUT NEEDED — Was this a deliberate choice or evolved over time?]
**Outcome:** Zod schemas validate all external inputs (Telegram webhooks, AI tool arguments). `z.infer<typeof Schema>` eliminates manual type duplication. Strict mode catches nullable issues early.

## Phase 2: AI Architecture

### Decision: Webhook returns 200 immediately; all AI work goes to a queue
**Context:** Telegram requires webhook responses within ~30 seconds. OpenAI API calls (especially with tool loops) can take 10-60+ seconds. Missing the deadline = Telegram retries = duplicate processing.
**Options considered:** (A) Respond inline and hope it's fast enough, (B) Optimistic 200 + background processing via waitUntil, (C) Queue-based async processing
**Choice:** Queue-based (C). waitUntil has a ~30s limit on Workers; Queues get 15 minutes. The queue also provides automatic retries, dead-letter handling, and batch processing.
**Outcome:** Zero dropped messages. Users see a "processing..." state briefly, then get a rich response. Architecture cleanly separates ingestion (fast, simple) from processing (slow, complex).

### Decision: OpenAI over Anthropic for the bot's LLM
**Context:** Need a model for intent classification, expense extraction, and conversational chat. Both OpenAI and Anthropic offer capable models.
**Options considered:** OpenAI (GPT-4o, GPT-4o-mini), Anthropic (Claude Sonnet/Haiku), open-source (Llama via Workers AI)
**Choice:** [YOUR INPUT NEEDED — Why OpenAI? Was it the Agents SDK? Tool calling quality? Vision capabilities? Whisper for voice?]
**Outcome:** Using gpt-4o-mini for most tasks (cost-effective), gpt-4o for semantic chat (quality), whisper-1 for voice transcription, text-embedding-3-small for semantic search. OpenAI Agents SDK for structured tool calling and session management.

### Decision: Inject userId via closures, never from LLM
**Context:** AI tools like `log_expense` need to know which user is logging the expense. If the LLM provides the userId, a prompt injection could log expenses to another user's account.
**Options considered:** (A) Pass userId as a tool parameter (LLM decides), (B) Inject userId from authenticated session via closure
**Choice:** (B) Closure injection. The tool function closes over the authenticated userId from the queue message. The LLM literally cannot specify a different user — the parameter doesn't exist in the tool schema.
**Outcome:** Row-level security baked into the architecture. Even a perfect prompt injection attack cannot cross user boundaries. All DB queries filter by userId automatically.

### Decision: OpenAI Agents SDK over raw Chat Completions
**Context:** Started with raw Chat Completions API for tool calling. Managing the tool call loop (call model -> execute tools -> feed results back -> repeat) manually was error-prone.
**Options considered:** Raw Chat Completions with manual tool loop, LangChain, OpenAI Agents SDK
**Choice:** [YOUR INPUT NEEDED — What triggered the migration? Was it the session management? Cleaner tool calling? Something else?]
**Outcome:** Agents SDK handles the tool call loop, session management (D1Session), and multi-turn conversations. Cleaner code, fewer bugs. `run(agent, input, { session, maxTurns: 10 })` replaces ~100 lines of manual orchestration.

## Phase 3: Features

### Decision: Support photo and voice input (multimodal)
**Context:** People take photos of receipts and sometimes prefer voice notes over typing.
**Options considered:** Text-only, text + photo, text + photo + voice
**Choice:** [YOUR INPUT NEEDED — Was this a day-1 feature or added later? What motivated it?]
**Outcome:** Photos -> R2 storage -> base64 -> GPT-4o-mini vision extraction. Voice -> R2 storage -> Whisper transcription -> text pipeline. Same agent processes all three modalities.

### Decision: Semantic search via Vectorize
**Context:** Users ask questions like "what did I spend on coffee last week?" Keyword matching misses "latte" or "Starbucks".
**Options considered:** SQL LIKE queries, full-text search (FTS5), vector embeddings (Vectorize)
**Choice:** [YOUR INPUT NEEDED — Was semantic search a planned feature or did it emerge from user needs?]
**Outcome:** Expense descriptions are embedded via text-embedding-3-small and indexed in Vectorize. The `get_financial_report` tool tries exact substring match first, falls back to semantic search. Metadata filter ensures cross-user isolation.

### Decision: 10-message conversational memory window
**Context:** Users have multi-turn conversations ("What did I spend on food?" -> "Break that down by day"). Need context, but full history would explode the context window and cost.
**Options considered:** No memory (stateless), full history, sliding window (N messages), summarization
**Choice:** 10-message sliding window stored in D1 `chat_history` table. Simple, predictable cost, sufficient for follow-up questions.
**Outcome:** D1Session loads last 10 messages via `getRecentChatHistory()`. Natural multi-turn conversations work. Cost stays bounded regardless of conversation length.

### Decision: Daily token quotas per user
**Context:** OpenAI API calls cost money. A single user could theoretically rack up significant costs through heavy usage or abuse.
**Options considered:** No limits (trust users), hard rate limit (N messages/day), token-based quota
**Choice:** [YOUR INPUT NEEDED — What drove the quota decision? Had you seen abuse, or was it preventive?]
**Outcome:** `user_quotas` table tracks `tokens_used_today` with lazy refresh at midnight UTC. Quota checked before every agent run. Free tier gets a daily allowance; premium tier gets more.

## Phase 4: Tooling Evolution

### Decision: Start with Google Antigravity (0->1)
**Context:** [YOUR INPUT NEEDED — How did you discover Antigravity? What made you pick it as the starting tool?]
**Options considered:** [YOUR INPUT NEEDED — What other AI coding tools were you considering at the time?]
**Choice:** [YOUR INPUT NEEDED — What did Antigravity do well in the early stages?]
**Outcome:** [YOUR INPUT NEEDED — How far did Antigravity get you? What was the state of the project when you started considering alternatives?]

### Decision: Switch from Antigravity to Claude Code
**Context:** [YOUR INPUT NEEDED — What triggered the switch? Was there a specific moment or a gradual realization?]
**Options considered:** Stay with Antigravity, switch to Cursor, switch to Claude Code, use multiple tools
**Choice:** [YOUR INPUT NEEDED — What specifically made Claude Code "the best thing humans ever invented"? What capabilities mattered most?]
**Outcome:** [YOUR INPUT NEEDED — What changed in your development velocity/quality after the switch?]

### Decision: Build custom skills, subagents, and workflow hooks
**Context:** [YOUR INPUT NEEDED — When did you realize you needed development infrastructure beyond just "an AI that writes code"? What pain points triggered building the skills/hooks system?]
**Options considered:** Use Claude Code vanilla, build light customizations, build full workflow infrastructure
**Choice:** Built 4 custom skills (assess-task-size, d1-migration, new-db-module, rollback), 3 specialist subagents (cloudflare, telegram, openai), workflow state tracker with pre-commit/pre-deploy hooks.
**Outcome:** [YOUR INPUT NEEDED — What was the compounding effect? Can you give concrete examples of tasks that got dramatically faster?]

## Phase 5: Production

### Decision: Telegram Mini App for analytics (instead of bot-only)
**Context:** Chat interfaces are great for input and quick queries, but poor for browsing data, charts, and bulk editing.
**Options considered:** Bot-only (send charts as images), standalone web app, Telegram Mini App
**Choice:** [YOUR INPUT NEEDED — Why Mini App over a standalone web app?]
**Outcome:** React 19 + Vite + Tailwind + Radix UI app embedded in Telegram. Three screens: Dashboard (expense list + inline editing), Analytics (charts + trends), Review Queue (confirm uncertain expenses). Auth via Telegram initData signature — no separate login.

### Decision: Proactive notifications (hourly cron)
**Context:** [YOUR INPUT NEEDED — Why did you add notifications? Were users forgetting to log expenses?]
**Options considered:** No notifications, daily digest only, timezone-aware smart notifications
**Choice:** Hourly cron job that dispatches timezone-aware notifications: morning summary, evening reminder, weekly digest, monthly report. Each user's notification schedule tracked in the `users` table to prevent duplicates.
**Outcome:** Users get relevant nudges at the right time in their timezone. Cron runs every hour but only sends to users whose local time matches the notification window.

### Decision: Rate limiting via KV
**Context:** Need to prevent abuse (accidental or intentional rapid-fire messages).
**Options considered:** No rate limiting, in-memory counter, D1-based counter, KV-based counter
**Choice:** KV with 20 messages/hour per user. KV is fast (edge-cached), atomic, and has built-in TTL for automatic expiry.
**Outcome:** Simple, effective abuse prevention. KV's TTL means no cleanup jobs needed. Rate limit info included in rejection message so users know when they can try again.

### Decision: Cost control strategy
**Context:** Running an AI-powered product means every user interaction has a real cost (OpenAI API tokens).
**Options considered:** Absorb all costs, charge users immediately, freemium with quotas
**Choice:** [YOUR INPUT NEEDED — What's your cost control philosophy? How do you think about per-user economics?]
**Outcome:** Multi-layered: (1) gpt-4o-mini for most tasks (cheap), (2) daily token quotas per user, (3) rate limiting, (4) selective Vectorize indexing (only text, not photos/voice). Free tier is sustainable; premium tier offsets costs.
