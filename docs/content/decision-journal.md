# Gastos Decision Journal

> Every major fork-in-the-road moment in building Gastos, organized chronologically.
> This journal is the backbone of all Gastos documentation — narratives, blog posts,
> and landing page content are derived from it.

## Phase 0: The Problem

### Decision: Build an expense tracker at all
**Context:** Existing expense tracking apps (Mint, YNAB, Money Lover, etc.) try to do too much — they combine spending tracking with budgeting, present overwhelming options, and make you think about too many things at once. Expense tracking feels like a chore. My wife tracks expenses in an Excel sheet, which works but is tedious. The core insight: why not just *tell* something what you spent, the way you'd tell a friend? Send a receipt photo, type a message, or record a voice note — and it's tracked.
**Options considered:** Use an existing app (Mint, YNAB, Money Lover, spreadsheet) vs. build something custom
**Choice:** Build a chatbot. Instead of pressing buttons in an app or logging things in a spreadsheet, just send your receipts, tell it what you spent, or send a voice message. Make the bot smart enough to handle multiple entries in one shot — upload all your receipts at the end of the day, or log each expense as it happens. The existing apps don't fall short per se — they try to do too much, which is too much for me.
**Outcome:** Gastos project started

### Decision: Build it as a Telegram bot
**Context:** Needed a chat platform to build the bot on. Telegram is the easiest platform to build chatbots on — you just go to BotFather (a bot that makes bots) and you're set up in minutes. WhatsApp requires a business account and significantly more setup overhead. Discord is gamer-oriented. A standalone mobile app would take months.
**Options considered:** Standalone mobile app, web app, WhatsApp bot, Telegram bot, Discord bot
**Choice:** Telegram. The barrier to creating a bot is virtually zero — BotFather handles registration, you get a token, and you're building. Plus Telegram offers a Mini App platform for when you need a full UI, rich media support (photos, voice, documents), and inline keyboards for structured interactions.
**Outcome:** Conversational UX with zero app-switching friction; access to Telegram's Mini App platform for when users need a full dashboard

## Phase 1: Foundation

### Decision: Cloudflare Workers over traditional hosting
**Context:** Need a runtime for the bot. Key requirements: low latency globally, handles webhook traffic, affordable at low scale, supports background processing.
**Options considered:** Vercel serverless, AWS Lambda, Railway/Fly.io (container), Cloudflare Workers
**Choice:** The free tier. Cloudflare has an incredibly generous free tier — to date, $0 in spend for the entire bot (granted, single-user so far, but still). A second factor emerged during development: ease of deployment. Everything happens through the CLI (wrangler), which means deployment is just a command. And since it's a CLI command, AI agents can deploy too — making the entire workflow automatable.
**Outcome:** Single platform for compute, database, storage, queues, search, and caching. No external dependencies. D1 = SQLite (simple), R2 = blob storage (receipts), KV = rate limiting, Queues = async processing, Vectorize = semantic search.

### Decision: D1 (SQLite) over Postgres/Supabase
**Context:** Need a database for users, expenses, chat history. D1 is Cloudflare-native SQLite.
**Options considered:** Supabase (Postgres), PlanetScale (MySQL), Turso (SQLite), D1 (SQLite)
**Choice:** More control. Supabase has a generous free tier but pauses your project after periods of inactivity — constantly unpausing during development breaks was frustrating. D1 gives full control with no surprises. Also bet on simplicity: AI is smart enough to write optimized raw SQL queries, and having worked with SQL since college, an ORM felt like unnecessary abstraction. Considered using one, decided to keep it simple.
**Outcome:** Zero-config database on the same platform. SQL migrations via wrangler. Single request context (no connection pooling needed). Trade-off: no advanced Postgres features, but SQLite is sufficient for this use case.

### Decision: Hono as the HTTP framework
**Context:** Need a lightweight framework for webhook routes and API endpoints on Workers.
**Options considered:** Raw fetch handler, Express-like (itty-router), Hono
**Choice:** Hono — it was recommended by Cloudflare as the go-to framework for Workers. Didn't overthink it.
**Outcome:** Hono provides typed middleware, route grouping, and a familiar Express-like API. Minimal overhead on Workers. Built-in TypeScript support.

### Decision: TypeScript with strict mode + Zod
**Context:** Need type safety across webhook parsing, database queries, and AI tool definitions.
**Options considered:** Plain JavaScript, TypeScript (loose), TypeScript strict + Zod
**Choice:** Deliberate from day 0. Wanted to exercise the TypeScript muscle and make strict typing part of the development workflow from the start. Zod came naturally as the validation layer — it bridges runtime validation and compile-time types in one schema.
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
**Choice:** Had $10 in OpenAI API credits laying around from previous experiments. That's really it. Had been impressed by their Agents SDK during earlier experimentation. Other providers have comparable or even better agent frameworks, but OpenAI was good enough — especially with unused credits already purchased.
**Outcome:** Using gpt-4o-mini for most tasks (cost-effective), gpt-4o for semantic chat (quality), whisper-1 for voice transcription, text-embedding-3-small for semantic search. OpenAI Agents SDK for structured tool calling and session management.

### Decision: Inject userId via closures, never from LLM
**Context:** AI tools like `log_expense` need to know which user is logging the expense. If the LLM provides the userId, a prompt injection could log expenses to another user's account.
**Options considered:** (A) Pass userId as a tool parameter (LLM decides), (B) Inject userId from authenticated session via closure
**Choice:** (B) Closure injection. The tool function closes over the authenticated userId from the queue message. The LLM literally cannot specify a different user — the parameter doesn't exist in the tool schema.
**Outcome:** Row-level security baked into the architecture. Even a perfect prompt injection attack cannot cross user boundaries. All DB queries filter by userId automatically.

### Decision: OpenAI Agents SDK over raw Chat Completions
**Context:** Started with raw Chat Completions API for tool calling. Managing the tool call loop (call model -> execute tools -> feed results back -> repeat) manually was error-prone.
**Options considered:** Raw Chat Completions with manual tool loop, LangChain, OpenAI Agents SDK
**Choice:** To make the bot less dumb and to not reinvent the wheel. Was manually building intent classification, tool routing, and execution verification — deriving intent from the user's message, passing it to the correct tool, making sure tools do what they're supposed to. Then remembered reading about the Agents SDK. Why go through all that pain and suffering when somebody already went through it and built something you can just use?
**Outcome:** Agents SDK handles the tool call loop, session management (D1Session), and multi-turn conversations. Cleaner code, fewer bugs. `run(agent, input, { session, maxTurns: 10 })` replaces ~100 lines of manual orchestration.

## Phase 3: Features

### Decision: Support photo and voice input (multimodal)
**Context:** People take photos of receipts and sometimes prefer voice notes over typing.
**Options considered:** Text-only, text + photo, text + photo + voice
**Choice:** This was always the vision — had previously attempted a web-based chatbot with multimodal support but got overwhelmed on execution. Using Telegram as the medium made it much easier. The core motivation: remove every excuse for not logging an expense. You can send a photo, type a message, or record a voice note. Hell, you can even send a video (soon, if people think it'd be useful). No excuses left.
**Outcome:** Photos -> R2 storage -> base64 -> GPT-4o-mini vision extraction. Voice -> R2 storage -> Whisper transcription -> text pipeline. Same agent processes all three modalities.

### Decision: Semantic search via Vectorize
**Context:** Users ask questions like "what did I spend on coffee last week?" Keyword matching misses "latte" or "Starbucks".
**Options considered:** SQL LIKE queries, full-text search (FTS5), vector embeddings (Vectorize)
**Choice:** Part curiosity, part cool factor. Wanted to learn how semantic search actually works, and it makes the app significantly more impressive — you can say "how much did I spend on drinks?" and it returns your expenses for Gatorade, Starbucks, and everything else that's semantically related. Keyword matching would miss all of that.
**Outcome:** Expense descriptions are embedded via text-embedding-3-small and indexed in Vectorize. The `get_financial_report` tool tries exact substring match first, falls back to semantic search. Metadata filter ensures cross-user isolation.

### Decision: 10-message conversational memory window
**Context:** Users have multi-turn conversations ("What did I spend on food?" -> "Break that down by day"). Need context, but full history would explode the context window and cost.
**Options considered:** No memory (stateless), full history, sliding window (N messages), summarization
**Choice:** 10-message sliding window stored in D1 `chat_history` table. Simple, predictable cost, sufficient for follow-up questions.
**Outcome:** D1Session loads last 10 messages via `getRecentChatHistory()`. Natural multi-turn conversations work. Cost stays bounded regardless of conversation length.

### Decision: Daily token quotas per user
**Context:** OpenAI API calls cost money. A single user could theoretically rack up significant costs through heavy usage or abuse.
**Options considered:** No limits (trust users), hard rate limit (N messages/day), token-based quota
**Choice:** Purely preventive. Only have $10 in API credits to work with — not about to burn through all of that. Also prep for opening the bot to other users, especially strangers on the internet. Don't want to burn all the API credits just because some asshole thought it'd be funny to spam the bot.
**Outcome:** `user_quotas` table tracks `tokens_used_today` with lazy refresh at midnight UTC. Quota checked before every agent run. Free tier gets a daily allowance; premium tier gets more.

## Phase 4: Tooling Evolution

### Decision: Start with Google Antigravity (0->1)
**Context:** Discovered Antigravity through YouTube videos. The reviews were impressive, so gave it a try.
**Options considered:** Cursor, GitHub Copilot, Antigravity, manual coding
**Choice:** Antigravity. Google's models are amazing at getting you from 0 to 1. Smart enough to handle complicated workflows for building production-ready, agentically engineered apps. You can create skills that cover gaps in your knowledge — for example, security. Do your research, make a skill out of it, and plug that hole in your expertise.
**Outcome:** Got to a working Telegram bot with core functionality: logging expenses, user onboarding, querying expenses, and a Mini App where users can update and manage their expenses. A solid foundation, but not the final form.

### Decision: Switch from Antigravity to Claude Code
**Context:** Company hackathon gave access to Claude Code. Found it better and easier to extend than Antigravity right out of the box.
**Options considered:** Stay with Antigravity, switch to Cursor, switch to Claude Code, use multiple tools
**Choice:** Claude Code. Amazing out of the box — the plugins are incredibly helpful, the docs are much clearer, and there are far more resources about how to use it than Antigravity. It feels more extensible and the ecosystem is more mature.
**Outcome:** More involved in speccing and planning. Claude Code is more human-in-the-middle friendly than Antigravity — it feels like a collaboration rather than handing off work. It can go deeper too, handling more complex multi-step tasks with better context management.

### Decision: Build custom skills, subagents, and workflow hooks
**Context:** Kept maxing out the context window in Claude Code. The CLAUDE.md was getting bloated trying to hold all the project context, patterns, and instructions in one place.
**Options considered:** Use Claude Code vanilla, build light customizations, build full workflow infrastructure
**Choice:** Built 4 custom skills (assess-task-size, d1-migration, new-db-module, rollback), 3 specialist subagents (cloudflare, telegram, openai), workflow state tracker with pre-commit/pre-deploy hooks. Enabling subagents and custom skills made the CLAUDE.md slimmer — subagents have their own context and only report back what the parent agent needs to know. Context became much more organized.
**Outcome:** Dramatic speed gains. Migrating from the hand-rolled tool-calling agent to the OpenAI Agents SDK took only 1 hour to get working, plus 30 minutes to debug — a task that would have taken much longer without the structured workflow. The compounding effect: each skill and subagent made the next feature faster because the infrastructure was already there. Retrospectively, would have leaned harder into existing Claude Code plugins (like Superpowers) earlier instead of reinventing workflows they already cover — built a custom spec-driven development workflow only to discover a plugin that does exactly that.

## Phase 5: Production

### Decision: Telegram Mini App for analytics (instead of bot-only)
**Context:** Chat interfaces are great for input and quick queries, but poor for browsing data, charts, and bulk editing.
**Options considered:** Bot-only (send charts as images), standalone web app, Telegram Mini App
**Choice:** Keep it simple — and curiosity. Antigravity suggested it during development because it was in the Telegram docs being referenced. When I heard you can make an app within Telegram, I was sold. No separate domain, no separate auth, no separate deployment pipeline. Everything stays in Telegram.
**Outcome:** React 19 + Vite + Tailwind + Radix UI app embedded in Telegram. Three screens: Dashboard (expense list + inline editing), Analytics (charts + trends), Review Queue (confirm uncertain expenses). Auth via Telegram initData signature — no separate login.

### Decision: Proactive notifications (hourly cron)
**Context:** Wasn't logging regularly. Kept forgetting the chatbot exists — a problem that's not unique. People have more and more distractions nowadays, and a passive tool gets forgotten.
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
**Choice:** The bot must be able to sustain itself. Running AI-enabled features isn't free, and to keep it operational and working for people, it needs a path to self-sustainability. Plan: introduce premium features. Free tier covers basic usage; premium unlocks higher quotas and advanced features. Multi-layered cost controls keep the free tier sustainable.
**Outcome:** Multi-layered: (1) gpt-4o-mini for most tasks (cheap), (2) daily token quotas per user, (3) rate limiting, (4) selective Vectorize indexing (only text, not photos/voice). Free tier is sustainable; premium tier offsets costs.
