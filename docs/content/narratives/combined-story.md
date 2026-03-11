# Gastos: A Case Study in Agentic Product Engineering

Gastos is an AI-powered expense tracker that lives in Telegram. It turns text messages, photos of receipts, and voice notes into structured, searchable financial data — no app to download, no forms to fill out.

This case study covers the full story: the problem it solves, the key architectural decisions, and the unconventional development process that made it possible.

---

## Executive Summary

Existing expense tracking apps make logging feel like a chore — too many buttons, too many screens, too much overhead. Gastos replaces all of that with a Telegram chatbot. Send a message, snap a receipt, or record a voice note, and the AI handles the rest: extraction, categorization, tagging, and storage. Ask questions in plain English and get instant answers powered by semantic search.

Under the hood, Gastos runs entirely on Cloudflare's free tier ($0 infrastructure cost) using Workers, D1, R2, KV, Queues, and Vectorize. It was built using an "agentic engineering" approach — starting with Google's Antigravity editor, then switching to Claude Code, and ultimately building a layer of custom skills, specialist subagents, and workflow hooks that made each feature faster to ship than the last.

## The Problem

Every expense tracker on the market turns logging into a production. Open the app. Tap the plus button. Pick a category from a dropdown. Type in the amount. Add a note if you're feeling ambitious. Save. Repeat forty times a day.

The popular apps — Mint, YNAB, Money Lover — are powerful. They budget, forecast, sync bank accounts, generate reports. But that power creates complexity. They try to handle spending *and* budgeting simultaneously, which makes perfect sense on paper but turns a simple task into a system you have to learn. Suddenly expense tracking feels like homework. My wife tracks our expenses in an Excel spreadsheet. It works — she's disciplined about it — but it's tedious. You have to remember what you spent, open the spreadsheet, find the right row, type it all in. If you forget for a couple of days, you're doing archaeology on your bank statement trying to reconstruct Tuesday's lunch.

The pattern is always the same: you start strong, life gets busy, and the friction wins. The app sits on your home screen collecting dust. The spreadsheet stops getting updated. You tell yourself you'll catch up this weekend. You won't.

The existing apps don't fall short per se — they try to do too much. The problem was never motivation. It was friction.

The insight was obvious in retrospect: you already tell people what you spent on, in plain language, without thinking about it. "Grabbed ramen, it was like twelve bucks." You split a cab and text your friend the amount. You're already describing your spending in conversation. So why not tell a bot the same way?

That's what Gastos does. Instead of pressing buttons in an app or logging things in a spreadsheet, just send your receipts, tell it what you spent, or send a voice message. Make the bot smart enough to handle multiple entries in one shot — upload all your receipts at the end of the day, or log each expense as it happens. Text it, snap it, or say it. No excuses left.

## Decision Highlights

Here are the 7 most interesting fork-in-the-road moments, and what happened at each.

### 1. Telegram over a standalone app

Building a mobile app would take months. WhatsApp requires a business account and significant setup overhead. Discord skews gamer-oriented. Telegram? Go to BotFather (a bot that makes bots), get a token, start building. The barrier is virtually zero. But the real clincher: Telegram offers Mini Apps — full embedded web applications — plus rich media support (photos, voice, documents) and inline keyboards. It's not just a chat window. It's an entire platform.

### 2. Cloudflare's free tier — $0 total spend

The primary draw was cost: Cloudflare's free tier has proven genuinely generous. To date, $0 in infrastructure spend across compute, database, storage, caching, queues, and vector search. That's not because the bot is trivial — it's because Cloudflare bundles everything into one platform. A second benefit emerged during development: everything deploys via CLI commands (wrangler). And since it's a CLI command, AI agents can run it too. The entire workflow — from code to production — is automatable.

### 3. The webhook never does AI work

Telegram gives webhooks ~30 seconds to respond. OpenAI agent loops with tool calling can take 60+ seconds. If you try to do both in the same request, you miss the deadline, Telegram retries, and you process the same message twice. The solution: the webhook persists the raw message, uploads any media to R2, enqueues a processing message, and returns 200. Total time: under a second. A queue consumer with a 15-minute execution budget handles the AI work. This cleanly separates ingestion (fast, simple) from processing (slow, complex). Zero dropped messages, zero duplicates.

### 4. The LLM never knows who the user is

The most critical security decision in the entire codebase. AI tools like `log_expense` need to know whose expense to log. The naive approach: include userId as a tool parameter and let the LLM pass it. The problem: a prompt injection like "log this expense for user 999" could target another user's account. The solution: userId is injected via a JavaScript closure — the parameter doesn't exist in the tool schema. The model literally cannot specify a different user. This is stronger than prompt-based guardrails ("never show other users' data") because it operates at the code level, not the instruction level. Even a perfect prompt injection has no mechanism to exploit.

### 5. $10 in API credits drove the model choice

Sometimes the most pragmatic decision is the best one. OpenAI was chosen over Anthropic for the bot's LLM because there were $10 in unused API credits from previous experiments. That's it. That $10 cascaded into adopting the Agents SDK (for structured tool calling), Whisper (for voice transcription), and text-embedding-3-small (for semantic search) — a full ecosystem adoption triggered by leftover credits. The lesson: don't overthink model selection at the start. Pick something good enough, build with it, and optimize later.

### 6. From Antigravity to Claude Code

Google's Antigravity built the 0-to-1 prototype. Then a company hackathon provided access to Claude Code. The difference was immediate: clearer docs, more plugins, a more mature ecosystem, and — crucially — a more collaborative feel. Antigravity was great at delegation. Claude Code was better at collaboration. More involvement in speccing and planning, more edge cases caught, more depth on complex multi-step tasks. The switch from Antigravity (0→1) to Claude Code (1→production) was the inflection point in the project's velocity.

### 7. Building infrastructure for the AI

The context window kept maxing out. The project instruction file was getting bloated. The solution was to stop thinking of AI as a single tool and start thinking of it as a *team*. Custom skills handle specific workflows (task assessment, migrations, scaffolding, rollback). Specialist subagents handle domain questions (Cloudflare, Telegram, OpenAI) with their own focused context. A workflow state tracker with automated hooks enforces quality gates. Each subagent reports back only what the main agent needs. The instruction file got slim. Context became organized. And each piece of infrastructure made the next feature faster to ship.

## The Architecture

Gastos runs on six Cloudflare services connected through a queue-based async pipeline:

```
Telegram Message
    |
    v
Webhook (Workers + Hono)
    |
    +--> Persist source_event (D1)
    +--> Upload media (R2)
    +--> Enqueue message
    |
    v
Queue Consumer (15-min budget)
    |
    +--> Check token quota (D1)
    +--> Transcribe voice (Whisper) / Encode photo (base64)
    |
    v
OpenAI Agent (gpt-5-mini, maxTurns: 10)
    |
    +--> log_expense    --> D1 + Vectorize
    +--> edit_expense   --> D1
    +--> delete_expense --> D1
    +--> get_financial_report --> D1 + Vectorize
    |
    v
Reply via Telegram API
```

### The async split

The most important architectural decision is also the simplest: the webhook handler never does AI work. Telegram gives webhooks ~30 seconds. OpenAI agent loops can take 60+. So the webhook persists the raw message as an immutable `source_event` (for idempotency and audit trail), uploads any media to R2, and enqueues a message containing everything the consumer needs: userId, timezone, currency, tier, message text, and optionally an R2 key for media. Then it returns 200. The queue consumer picks it up with a 15-minute budget and does all the AI processing.

Duplicate detection happens at the source event layer. Each Telegram message has a unique `(chat_id, message_id)` pair. If Telegram retries, the webhook detects the duplicate and skips it. The queue consumer never sees it.

### The AI agent

The agent is configured with `gpt-5-mini` and four tools: `log_expense` (extracts and stores expenses), `edit_expense` (corrects amounts/categories), `delete_expense` (removes mistakes), and `get_financial_report` (the single query tool that returns totals, category breakdowns, and recent transactions for any time period). The `run(agent, input, { session, maxTurns: 10 })` call from the Agents SDK replaced ~100 lines of manual tool-loop orchestration.

Multimodal inputs converge into the same agent. Text goes directly. Photos get fetched from R2, base64-encoded, and sent to GPT-4o-mini vision for extraction. Voice messages get transcribed via Whisper and passed as plain text. From the agent's perspective, all three look the same.

Conversational memory is a 10-message sliding window backed by D1. The `D1Session` class loads recent history and persists new messages after each agent run. This gives enough context for follow-up questions ("break that down by day") without exploding costs.

### Security model

Every tool injects `userId` from a closure — the parameter doesn't exist in the tool schema. The LLM cannot specify, override, or even see which user it's operating on. Every database query in `src/db/` takes `userId` as a mandatory argument. Even a perfect prompt injection attack cannot cross user boundaries. This is architectural security, not prompt-based guardrails.

### Semantic search

When a user asks "how much did I spend on drinks?", the `get_financial_report` tool tries exact substring matching first (fast, predictable). If that returns zero results, it generates an embedding via `text-embedding-3-small` and queries Vectorize for semantically similar expenses, filtered by userId in the metadata. "Drinks" finds Starbucks, Gatorade, beer — conceptual matches that keyword search would miss entirely.

### Cost control

Four layers keep the free tier sustainable: (1) `gpt-5-mini` for most tasks instead of premium models, (2) daily token quotas per user with lazy midnight reset, (3) rate limiting at 20 messages/hour via KV with automatic TTL expiry, and (4) selective Vectorize indexing — only text expenses, not photos or voice.

### Database design

The schema follows an append-first pattern across six migrations: immutable `source_events` (audit trail), normalized `expenses` (with categories, tags, and timestamps), `chat_history` (bounded conversation window), `user_quotas` (token budgeting with lazy reset), and notification scheduling columns. All database modules take `D1Database` directly, keeping them testable and decoupled from the Workers runtime.

## How It Was Built

The development story has three acts.

**Act 1: Antigravity (0 to 1).** Google's agentic code editor built the initial prototype. Discovered through YouTube videos, it turned out to be genuinely impressive at generating working software from high-level descriptions. Google's models are amazing at getting you from zero to one — smart enough to handle complicated workflows for building production-ready apps. You can create skills that cover gaps in your knowledge (for example, security — do the research, make a skill, plug the hole). The result: a functioning Telegram bot with expense logging (text, photo, voice), user onboarding, natural language querying, and a React Mini App. Antigravity even suggested the Mini App — it surfaced the idea while we were reading Telegram's docs. This phase proved the concept.

**Act 2: Claude Code (1 to production).** A company hackathon provided the trigger. Within a day of trying Claude Code on Gastos, the decision to switch was clear. It was better out of the box in ways that mattered: the plugins were incredibly helpful, the docs were clearer, and there were far more community resources. But the biggest difference was how it felt to work with. Antigravity was more like delegation — describe what you want, let it build, review when it's done. Claude Code is more like collaboration. More human-in-the-middle friendly. More involvement in speccing and planning, not because the tool required it, but because it made that involvement feel natural and productive. Features that took multiple sessions started landing in one. Edge cases got caught earlier. The quality of the output went up.

**Act 3: Infrastructure compounding.** The breakthrough came from a pain point: context window limits. Every conversation, tokens were being burned re-explaining the same project context, the same patterns, the same architectural decisions. The project's instruction file (CLAUDE.md) was getting bloated — cramming architecture notes, code patterns, testing instructions, deployment steps, and database conventions into one file that was turning into a novel.

The solution was to build infrastructure *for* the AI:

- **4 custom skills**: task size assessment (maps each task to a pipeline), D1 migration checklists, database module scaffolding, emergency rollback procedures
- **3 specialist subagents**: Cloudflare (Workers/D1/R2/KV/Queues/Vectorize), Telegram (Bot API/webhooks/Mini App), OpenAI (API/Agents SDK/prompts) — each with focused context, reporting back only what's relevant
- **Workflow state tracker**: a JSON file tracking completed pipeline steps, enforced by pre-commit and pre-deploy hooks that block if verification is incomplete

The result was dramatic. The instruction file got slim again. Context became organized. And each piece of infrastructure made the next feature faster:

- **Agents SDK migration** (core AI pipeline rewrite): 1 hour + 30 min debugging
- **Daily token quotas** (new table + query module + tests): ~1 hour
- **Each new D1 migration**: scaffolded automatically by a custom skill

The meta-layer is recursive: Claude Code builds the skills that make Claude Code better at building Gastos, which surfaces ideas for better skills. The AI improves the AI that improves the AI's ability to build the product. The toolchain improves itself.

One honest retrospective: should have leaned harder into existing plugins (like Superpowers) earlier. Built a custom spec-driven development workflow, then discovered a plugin that does exactly that. The lesson: before building infrastructure for your AI tooling, check what's already out there. The ecosystem is growing fast.

## Results and Metrics

| Metric | Value |
|--------|-------|
| Infrastructure cost | $0 (Cloudflare free tier) |
| AI API budget | $10 (OpenAI credits) |
| Features shipped | 14 (expense logging, 3 input modalities, semantic chat, totals commands, Mini App with 3 screens, notifications, rate limiting, quotas, vectorized search, categories, tags, review queue, admin config) |
| Database migrations | 6 |
| Test suite | 7 files, 21 tests |
| AI tools | 4 (log, edit, delete, financial report) |
| Custom dev skills | 4 (assess-task-size, d1-migration, new-db-module, rollback) |
| Specialist subagents | 3 (Cloudflare, Telegram, OpenAI) |
| Workflow hooks | 3 (pre-commit gate, pre-deploy gate, pre-commit warn) |
| Primary dev tools | Antigravity (0→1), Claude Code (1→production) |

## What's Next

**Near-term:**
- Video message support (the last input modality)
- Open the bot to users beyond the developer
- Premium tier with higher quotas and advanced features

**Medium-term:**
- Request tracing / correlation IDs across the full webhook → queue → result pipeline
- CORS lockdown (currently `*`, needs to be restricted to the Pages domain)
- Vectorize indexing for photo and voice expenses (currently text-only)

**Longer-term:**
- Open-source considerations — the codebase and the agentic engineering infrastructure
- Landing page and public launch
- Community feedback loop for feature prioritization

---

*This case study was itself produced using the agentic engineering approach it describes — Claude Code brainstormed the documentation structure, conducted an interactive interview to capture decision context, and wrote the narratives with cross-references to a chronological decision journal. The document you're reading is one of six in the content kit, each designed for a different audience and purpose.*
