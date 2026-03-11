# Documentation Content Kit — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. **NOTE:** This is a content-writing project, not a code project. Tasks involve writing markdown, interviewing the user for context, and iterating on drafts.

**Goal:** Produce 6 standalone documents (decision journal, 4 narratives, user guide) that serve as source material for a landing page, blog posts, LinkedIn content, and portfolio showcase.

**Architecture:** Decision-journal-first approach. The journal is written first via an interactive interview session with the user (Claude knows the *what* from the codebase; the user provides the *why*). All derivative narratives are filtered views of the journal. Each doc stands alone.

**Spec:** `docs/superpowers/specs/2026-03-11-documentation-content-kit-design.md`

---

## File Structure

```
docs/content/
├── decision-journal.md            # CREATE — backbone, ~20 decisions across 6 phases
├── narratives/
│   ├── product-story.md           # CREATE — user-facing, ~1000-1500 words
│   ├── technical-story.md         # CREATE — engineering showcase, ~2000-2500 words
│   ├── process-story.md           # CREATE — Agentic Engineering story, ~2000-2500 words
│   └── combined-story.md          # CREATE — case study, ~3000-4000 words
└── user-guide.md                  # CREATE — getting started, ~500-800 words
```

**Reference files** (read-only, for context during writing):
- `CLAUDE.md` — project patterns, architecture summary
- `src/ai/agent.ts` — agent configuration, system prompt
- `src/ai/tools.ts` — tool definitions (log_expense, edit_expense, delete_expense, get_financial_report)
- `src/queue.ts` — queue processing pipeline
- `src/routes/webhook.ts` — webhook handler
- `src/ai/session.ts` — D1Session for conversational memory
- `src/db/` — all database modules
- `src/onboarding.ts` — /start flow
- `src/totals.ts` — period calculations
- `migrations/` — database schema evolution
- `webapp/src/` — Mini App screens
- `.claude/` — skills, agents, hooks (agentic engineering infrastructure)
- `wrangler.toml` — Cloudflare bindings and deployment config
- `docs/plans/` — existing design docs for historical context

---

## Chunk 1: Decision Journal (Interactive)

### Task 1: Scaffold the decision journal with known facts

**Files:**
- Create: `docs/content/decision-journal.md`

This task pre-fills the journal structure with everything we know from the codebase. Each decision entry gets the **Context**, **Options considered**, and **Outcome** filled from code analysis. The **Choice** section gets a draft that the user will validate/expand.

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p docs/content/narratives
```

- [ ] **Step 2: Write the decision journal scaffold**

Write `docs/content/decision-journal.md` with:

```markdown
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
**Outcome:** Using gpt-4o-mini for most tasks (cost-effective), gpt-4o for semantic chat (quality), whisper-1 for voice transcription, text-embedding-3-small for semantic search. OpenAI Agents SDK v0.6.0 for structured tool calling and session management.

### Decision: Inject userId via closures, never from LLM
**Context:** AI tools like `log_expense` need to know which user is logging the expense. If the LLM provides the userId, a prompt injection could log expenses to another user's account.
**Options considered:** (A) Pass userId as a tool parameter (LLM decides), (B) Inject userId from authenticated session via closure
**Choice:** (B) Closure injection. The tool function closes over the authenticated userId from the queue message. The LLM literally cannot specify a different user — the parameter doesn't exist in the tool schema.
**Outcome:** Row-level security baked into the architecture. Even a perfect prompt injection attack cannot cross user boundaries. All DB queries filter by userId automatically.

### Decision: OpenAI Agents SDK over raw Chat Completions
**Context:** Started with raw Chat Completions API for tool calling. Managing the tool call loop (call model → execute tools → feed results back → repeat) manually was error-prone.
**Options considered:** Raw Chat Completions with manual tool loop, LangChain, OpenAI Agents SDK
**Choice:** [YOUR INPUT NEEDED — What triggered the migration? Was it the session management? Cleaner tool calling? Something else?]
**Outcome:** Agents SDK handles the tool call loop, session management (D1Session), and multi-turn conversations. Cleaner code, fewer bugs. `run(agent, input, { session, maxTurns: 10 })` replaces ~100 lines of manual orchestration.

## Phase 3: Features

### Decision: Support photo and voice input (multimodal)
**Context:** People take photos of receipts and sometimes prefer voice notes over typing.
**Options considered:** Text-only, text + photo, text + photo + voice
**Choice:** [YOUR INPUT NEEDED — Was this a day-1 feature or added later? What motivated it?]
**Outcome:** Photos → R2 storage → base64 → GPT-4o-mini vision extraction. Voice → R2 storage → Whisper transcription → text pipeline. Same agent processes all three modalities.

### Decision: Semantic search via Vectorize
**Context:** Users ask questions like "what did I spend on coffee last week?" Keyword matching misses "latte" or "Starbucks".
**Options considered:** SQL LIKE queries, full-text search (FTS5), vector embeddings (Vectorize)
**Choice:** [YOUR INPUT NEEDED — Was semantic search a planned feature or did it emerge from user needs?]
**Outcome:** Expense descriptions are embedded via text-embedding-3-small and indexed in Vectorize. The `get_financial_report` tool tries exact substring match first, falls back to semantic search. Metadata filter ensures cross-user isolation.

### Decision: 10-message conversational memory window
**Context:** Users have multi-turn conversations ("What did I spend on food?" → "Break that down by day"). Need context, but full history would explode the context window and cost.
**Options considered:** No memory (stateless), full history, sliding window (N messages), summarization
**Choice:** 10-message sliding window stored in D1 `chat_history` table. Simple, predictable cost, sufficient for follow-up questions.
**Outcome:** D1Session loads last 10 messages via `getRecentChatHistory()`. Natural multi-turn conversations work. Cost stays bounded regardless of conversation length.

### Decision: Daily token quotas per user
**Context:** OpenAI API calls cost money. A single user could theoretically rack up significant costs through heavy usage or abuse.
**Options considered:** No limits (trust users), hard rate limit (N messages/day), token-based quota
**Choice:** [YOUR INPUT NEEDED — What drove the quota decision? Had you seen abuse, or was it preventive?]
**Outcome:** `user_quotas` table tracks `tokens_used_today` with lazy refresh at midnight UTC. Quota checked before every agent run. Free tier gets a daily allowance; premium tier gets more.

## Phase 4: Tooling Evolution

### Decision: Start with Google Antigravity (0→1)
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
```

- [ ] **Step 3: Review and verify all technical facts**

Read the scaffold and verify every technical claim against the codebase. Fix any inaccuracies.

- [ ] **Step 4: Commit the scaffold**

```bash
git add docs/content/decision-journal.md
git commit -m "docs: scaffold decision journal with codebase facts and user input placeholders"
```

### Task 2: Interview session — fill in [YOUR INPUT NEEDED] tags

**Files:**
- Modify: `docs/content/decision-journal.md`

This is an **interactive task**. Present the user with each `[YOUR INPUT NEEDED]` placeholder one at a time, ask for their answer, and fill it in. Group related questions when they're in the same phase.

- [ ] **Step 1: Ask Phase 0 questions (The Problem)**

Present to user:
1. What was your personal pain point with expense tracking? What apps did you try?
2. Why Telegram specifically? Is it your daily driver?

- [ ] **Step 2: Ask Phase 1 questions (Foundation)**

Present to user:
1. What drew you to Cloudflare? Was it the integrated ecosystem?
2. Why D1 over Postgres/Supabase?
3. Was Hono a deliberate choice or did you discover it along the way?
4. Was TypeScript strict + Zod deliberate from day 1 or evolved?

- [ ] **Step 3: Ask Phase 2 questions (AI Architecture)**

Present to user:
1. Why OpenAI over Anthropic for the bot's LLM?
2. What triggered the Agents SDK migration from raw Chat Completions?

- [ ] **Step 4: Ask Phase 3 questions (Features)**

Present to user:
1. Was multimodal (photo/voice) a day-1 feature or added later?
2. Was semantic search planned or emerged from user needs?
3. What drove the token quota decision — preventive or reactive to abuse?

- [ ] **Step 5: Ask Phase 4 questions (Tooling Evolution)**

Present to user:
1. How did you discover Antigravity? What made you pick it?
2. How far did Antigravity get you? What was the state of the project when you hit its limits?
3. What triggered the switch to Claude Code? Was there a specific moment?
4. What changed in development velocity/quality immediately after switching, before you built the custom infrastructure?
5. When did you realize you needed custom skills/hooks? What pain points?
6. What was the compounding effect? Concrete examples of speed gains?
7. What would you do differently if starting over?

- [ ] **Step 6: Ask Phase 5 questions (Production)**

Present to user:
1. Why Mini App over a standalone web app?
2. Why add proactive notifications? Were users forgetting?
3. What's your cost control philosophy?

- [ ] **Step 7: Fill in all answers and remove [YOUR INPUT NEEDED] tags**

Update `docs/content/decision-journal.md` with user's answers. Every placeholder replaced.

- [ ] **Step 8: User reviews final decision journal**

Present the complete journal for a final read-through. Fix any inaccuracies.

- [ ] **Step 9: Commit the completed journal**

```bash
git add docs/content/decision-journal.md
git commit -m "docs: complete decision journal with user context for all decisions"
```

---

## Chunk 2: User Guide

### Task 3: Write the user guide

**Files:**
- Create: `docs/content/user-guide.md`

**Reference:** `src/onboarding.ts` (for /start flow), `src/totals.ts` (for commands), `src/ai/tools.ts` (for what the bot can do in Q&A), `webapp/src/` (for Mini App screens)

- [ ] **Step 1: Write user-guide.md**

Structure (~500-800 words):
1. **What is Gastos?** — 2-sentence intro
2. **Getting Started** — search bot, /start, choose currency + timezone
3. **Logging Expenses** — text examples ("lunch 15.50", "grabbed coffee for 4.80"), photo (snap a receipt), voice (say what you spent)
4. **Asking Questions** — "how much did I spend this week?", "what did I spend on food?", "break down last month by category"
5. **Quick Commands** — `/today`, `/yesterday`, `/thisweek`, `/lastweek`, `/thismonth`, `/lastmonth`, `/thisyear`
6. **Mini App** — how to open it, Dashboard/Analytics/Review screens

Tone: friendly, scannable, use example messages the user would actually type.

- [ ] **Step 2: User reviews guide for accuracy**

Verify bot username, available commands, and feature descriptions match reality.

- [ ] **Step 3: Commit**

```bash
git add docs/content/user-guide.md
git commit -m "docs: add user guide for Gastos bot"
```

---

## Chunk 3: Derivative Narratives

### Task 4: Write product-story.md

**Files:**
- Create: `docs/content/narratives/product-story.md`

**Reference:** Decision journal (Phase 0, Phase 3, Phase 5), user-guide.md

- [ ] **Step 1: Write product-story.md (~1000-1500 words)**

Open with 2-sentence "what is Gastos" standalone intro. Pull from:
- Phase 0 decisions (the problem, why Telegram)
- Phase 3 decisions (multimodal, semantic search)
- Phase 5 decisions (Mini App, notifications)
- User guide (concrete examples of usage)

Tone: conversational, benefit-driven, zero architecture talk. This is the landing page / "why I built Gastos" blog post source. Link back to relevant decision journal entries (e.g., `[read more](../decision-journal.md#decision-build-it-as-a-telegram-bot)`) but ensure the narrative stands alone without following them.

- [ ] **Step 2: User reviews for tone and accuracy**

- [ ] **Step 3: Commit**

```bash
git add docs/content/narratives/product-story.md
git commit -m "docs: add product story narrative"
```

### Task 5: Write technical-story.md

**Files:**
- Create: `docs/content/narratives/technical-story.md`

**Reference:** Decision journal (Phase 1, Phase 2, Phase 3), `src/ai/agent.ts`, `src/ai/tools.ts`, `src/queue.ts`, `src/routes/webhook.ts`, `migrations/`, `wrangler.toml`

- [ ] **Step 1: Write technical-story.md (~2000-2500 words)**

Open with 2-sentence standalone intro. Sections:
1. **System overview** — stack diagram, Cloudflare ecosystem
2. **The async architecture** — webhook → queue → agent (ref Phase 2 decisions)
3. **AI agent design** — Agents SDK, tool definitions, session management, multimodal handling
4. **Security model** — closure-based userId injection, why LLM never knows the user (ref Phase 2 decision)
5. **Semantic search** — Vectorize, exact-match-first fallback, cross-user isolation
6. **Cost control** — quotas, rate limiting, model selection strategy
7. **Database design** — immutable source events → normalized expenses → chat history windowing
8. **Architecture diagram** — ASCII or Mermaid diagram of the full flow

Tone: technical but accessible. Show the *thinking* behind each choice, not just the implementation. Link back to decision journal entries where relevant. **Note:** The Agents SDK migration is in-progress. Document the current architecture state at time of writing, not the target state.

- [ ] **Step 2: Verify all technical claims against codebase**

Cross-check model names, table schemas, tool names, queue config against actual code.

- [ ] **Step 3: User reviews for accuracy and tone**

- [ ] **Step 4: Commit**

```bash
git add docs/content/narratives/technical-story.md
git commit -m "docs: add technical story narrative"
```

### Task 6: Write process-story.md

**Files:**
- Create: `docs/content/narratives/process-story.md`

**Reference:** Decision journal (Phase 4), `.claude/skills/`, `.claude/agents/`, `.claude/settings.local.json`, `CLAUDE.md`, `docs/plans/`

- [ ] **Step 1: Write process-story.md (~2000-2500 words)**

Open with 2-sentence standalone intro. This is **first-person voice** — written as if the user is telling their story. Sections:
1. **What is Agentic Engineering** — framing: using AI agents not just in your product, but to build it
2. **Phase 1: Antigravity (0→1)** — what it did well, where it hit limits (from interview answers)
3. **Phase 2: The switch to Claude Code** — the trigger, first impressions, "best thing humans ever invented"
4. **Phase 3: Building the dev infrastructure** — custom skills (assess-task-size, d1-migration, new-db-module, rollback), specialist subagents (cloudflare, telegram, openai), workflow state tracker, hooks (pre-commit-gate, pre-deploy-gate)
5. **The compounding effect** — each tool made the next feature faster. Concrete examples from interview.
6. **The meta-layer** — using Claude Code to build the skills that make Claude Code better at building Gastos
7. **What I'd do differently** — honest retrospective (from interview)

Tone: personal, narrative, honest. This is the LinkedIn/blog gold piece. Link back to relevant decision journal entries but ensure the narrative stands alone without following them.

- [ ] **Step 2: User reviews for voice authenticity**

This one especially needs the user's sign-off since it's written in their voice.

- [ ] **Step 3: Commit**

```bash
git add docs/content/narratives/process-story.md
git commit -m "docs: add process story narrative (Agentic Engineering)"
```

### Task 7: Write combined-story.md

**Files:**
- Create: `docs/content/narratives/combined-story.md`

**Reference:** All previous docs (decision-journal.md, product-story.md, technical-story.md, process-story.md)

- [ ] **Step 1: Write combined-story.md (~3000-4000 words)**

Open with 2-sentence standalone intro. Case study format:
1. **Executive summary** — one paragraph: problem, solution, how it was built, key results
2. **The problem** — condensed from product-story.md
3. **Decision highlights** — 5-7 most interesting fork-in-the-road moments from the journal, with outcomes
4. **The architecture** — condensed from technical-story.md, with the ASCII/Mermaid diagram
5. **How it was built** — condensed from process-story.md (Antigravity → Claude Code arc)
6. **Results & metrics** — features shipped, test coverage, development velocity, cost per user (whatever numbers exist)
7. **What's next** — future plans, open-source considerations

Tone: case study — structured, evidence-driven, professional but not dry. Link back to relevant decision journal entries but ensure the narrative stands alone without following them.

- [ ] **Step 2: User reviews the full case study**

- [ ] **Step 3: Commit**

```bash
git add docs/content/narratives/combined-story.md
git commit -m "docs: add combined case study narrative"
```

---

## Chunk 4: Final Review & Polish

### Task 8: Cross-reference check and final polish

**Files:**
- Modify: all 6 docs in `docs/content/`

- [ ] **Step 1: Verify cross-referencing rules**

Check that:
- Each narrative opens with a standalone 2-sentence "what is Gastos" intro
- Decision journal anchor links work (if used)
- No narrative depends on another
- No orphaned `[YOUR INPUT NEEDED]` tags remain

- [ ] **Step 2: Consistency pass**

Verify consistent:
- Bot name / username across all docs
- Feature descriptions match between docs
- Technical facts are identical everywhere they appear
- Tone matches the spec for each doc

- [ ] **Step 3: Final user review**

Present a summary of all 6 docs with word counts. User gives final approval.

- [ ] **Step 4: Final commit**

```bash
git add docs/content/
git commit -m "docs: polish and cross-reference all content kit documents"
```
