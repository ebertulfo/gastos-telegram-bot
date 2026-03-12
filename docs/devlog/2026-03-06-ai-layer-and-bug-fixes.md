# The AI Layer Marathon: Schema to Tests in One Day

**Date:** 2026-03-06
**Commits:** 12 commits

## What Changed
- Added 4 D1 migrations: categories, chat history, user quotas, user tiers
- Implemented DB modules for chat history and quota tracking
- Built the full AI agent layer: `agent.ts` (intent classification + semantic chat), `tools.ts` (get_financial_report tool), expanded `openai.ts` with multi-modal capabilities (vision, transcription, embeddings)
- Integrated agent reasoning into webhook and queue processing pipelines
- Added rate limiting system with configurable per-user quotas
- Updated webapp with new Analytics screen and UI components
- Added comprehensive test suites for queue, webhook, and onboarding
- Fixed 6 bugs found during integration: dead grammy dependency, unreachable code path, broken currency regex, unsafe type casts, leaked debug endpoints, dead helper function
- Extracted `callOpenAIExtraction()` helper to DRY up ~80 lines of duplicated fetch/parse/validate logic
- Moved inline SQL from `queue.ts` into `db/` modules, extracted `handleReceiptMessage()` to leave a clean 15-line queue router
- Created the first `CLAUDE.md` for maintaining context across AI coding sessions

## Why
The bot could log expenses, but it couldn't answer questions. "How much did I spend on food this week?" required running a `/thisweek` command and doing mental math. The whole point of building this on top of LLMs was to enable natural language interaction — not just parsing, but conversation.

This session was about closing that gap: add an intent classifier (log vs. question vs. unclear), wire up a semantic chat agent with tools that can query the database, and make it all work end-to-end. Then immediately harden what I'd built.

## Key Decisions
| Decision | Options Considered | Chosen | Why |
|----------|-------------------|--------|-----|
| Intent routing | Single model handles everything, classifier + specialist models | Classifier (gpt-4o-mini) + chat agent (gpt-4o) | Cheap fast model for routing, expensive capable model only when needed. 90% of messages are expense logs that don't need gpt-4o. |
| Agent tools | Multiple granular tools, single unified tool | Single `get_financial_report` tool | One tool with flexible parameters is easier for the LLM to use correctly than 5 narrow tools. The tool does filtering/aggregation and returns formatted data the agent can reason over. |
| Rate limiting | Token-based, request-based, hybrid with tiers | Hybrid with user tiers (free/premium) | Need to control OpenAI costs. Token counting is more accurate but request counting is simpler. Went with quota system that tracks both. |
| Test infrastructure | Jest, Vitest, Miniflare standalone | Vitest + @cloudflare/vitest-pool-workers | Tests run inside actual Workers runtime (Miniflare), not a Node.js approximation. D1 queries, KV reads, queue operations all work as they would in production. |
| Code organization | Keep SQL in handlers, separate db layer | Dedicated `db/` modules per domain | `queue.ts` had grown to 200+ lines with inline SQL mixed into business logic. Extracting to `db/expenses.ts`, `db/parse-results.ts` etc. made queue.ts a clean router. |
| Project context | README, inline comments, separate docs | CLAUDE.md at project root | I'm using AI assistants (Claude, Copilot) extensively. CLAUDE.md gives them project-specific context: architecture, patterns, gotchas. Cheaper than re-explaining every session. |

## How (Workflow)
This was a full-day marathon with three distinct phases.

**Phase 1 — Build (morning).** Bottom-up: migrations first, then db modules, then AI layer, then integration into webhook/queue/API. Each layer was built against the one below it. The agent was the most complex piece — it needed to classify intent, manage chat history, call tools, and format responses, all within the queue's execution context.

**Phase 2 — Ship & Break (afternoon).** Deployed, tested with real Telegram messages, and immediately found 6 bugs. Some were pre-existing (dead grammy dependency, unreachable code), some were introduced during integration (currency regex accepting garbage input, debug endpoints exposed in production). Fixed all 6 in a single focused commit.

**Phase 3 — Clean (evening).** With everything working, I refactored for sustainability. The `openai.ts` extraction calls had ~80 lines of identical fetch/parse/validate/map logic duplicated between text and image paths — extracted into `callOpenAIExtraction()`. The queue processor had inline SQL mixed with orchestration logic — separated into db modules and a clean `handleReceiptMessage()` function. Then wrote CLAUDE.md to capture everything I'd learned.

## Metrics
- 12 commits in a single day
- 67 files changed, ~3,000 lines added, ~320 lines removed
- 4 D1 schema migrations
- 3 new db modules (`chat-history.ts`, `quotas.ts`, `parse-results.ts`)
- 3 core AI files created/expanded (`agent.ts`, `tools.ts`, `openai.ts`)
- 6 bugs identified and fixed
- ~80 lines of duplication removed via extraction helper
- ~120 lines of inline SQL moved to db layer
- Test fixtures added (3 images, 3 audio files)
- First CLAUDE.md created

## Learnings
- **Build bottom-up, debug top-down.** Starting with migrations and db modules meant each layer had a solid foundation. But when things broke in production, I had to trace from the user's message down through webhook -> queue -> agent -> tool -> db to find the issue.
- **Ship fast, then fix what breaks.** Deploying after Phase 1 (before cleanup) was the right call. Real Telegram messages found bugs that tests didn't — like the currency regex accepting "ASDF" as a valid currency code because the regex only checked format, not membership in ISO 4217.
- **DRY matters more in AI code.** The duplicated extraction logic wasn't just ugly — it was dangerous. A bug fix in one path wouldn't propagate to the other. When your code calls an LLM and parses the result, that boundary logic needs to exist exactly once.
- **CLAUDE.md pays for itself in the first session.** I created it at the end of this day. The next time I opened the project with Claude, it already knew the architecture, the patterns, the gotchas. No 10-minute "let me explore the codebase" warmup.
- **Queue.ts as a router is the right pattern.** After extraction, `queue.ts` went from 200+ lines to ~15 lines of routing logic. The actual work lives in `handleReceiptMessage()` and `runSemanticChat()`. When I add new queue message types, it's one new case in the router and a new handler function.
- **Test in the actual runtime.** `@cloudflare/vitest-pool-workers` runs tests inside Miniflare, which means D1 queries, KV reads, and queue operations work exactly as they do in production. This caught issues that Node.js-based tests would have missed entirely.

## Content Angles
- "Building an AI Agent Layer for a Telegram Bot" — architecture of intent classification + tool-using agent on Cloudflare Workers
- "6 Bugs in 6 Hours: What Shipping Fast Actually Looks Like" — honest post-deployment debugging story
- "CLAUDE.md: Giving AI Assistants Project Context" — the pattern and why it works
- "From 200 Lines to 15: Refactoring a Queue Processor" — concrete before/after of extracting handlers from a router
- "Rate Limiting AI Features in a Side Project" — practical quota system to avoid surprise OpenAI bills
