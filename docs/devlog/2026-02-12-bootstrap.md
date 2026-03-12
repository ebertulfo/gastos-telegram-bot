# From Zero to Expense Bot in One Commit

**Date:** 2026-02-12
**Commits:** 1 commit (the big bang)

## What Changed
- Scaffolded entire Cloudflare Workers project with Hono, D1, R2, KV, and Queues bindings
- Implemented Telegram webhook ingestion with idempotent source_events persistence
- Built `/start` onboarding flow with city-based timezone resolution and currency quick-picks (PHP, SGD, USD, EUR + ASEAN coverage)
- Added totals commands (`/today`, `/thisweek`, `/thismonth`, `/thisyear`) with timezone-aware UTC boundary conversion
- Wired up queue-based expense parsing: text via OpenAI extraction, photos via GPT vision, voice via Whisper transcription
- Created user upsert, source event tracking, parse result storage, and conditional expense creation
- Added test coverage across webhook, onboarding, totals, queue parsing, and source event classification
- Wrote project docs: AGENTS.md, RULES.md, WORKFLOW.md, DECISIONS.md, SETUP.md

## Why
I wanted a personal expense tracker that lives inside Telegram — no separate app to open, no login walls. Just send a message like "grabbed coffee 4.50" or snap a receipt photo, and it's logged. The constraint was that it had to run on edge infrastructure with zero ongoing server costs (Cloudflare Workers free tier is generous).

The single-commit bootstrap was intentional. I had the architecture mapped out beforehand and wanted to get to a working vertical slice as fast as possible: message in, expense out, totals queryable.

## Key Decisions
| Decision | Options Considered | Chosen | Why |
|----------|-------------------|--------|-----|
| Runtime | Node.js server, AWS Lambda, Cloudflare Workers | Cloudflare Workers | Edge deployment, no cold starts, built-in queue/storage/DB. Free tier covers a personal bot easily. |
| Framework | Express, Hono, itty-router | Hono | Lightweight, Workers-native, good TypeScript support. Express doesn't run on Workers without polyfills. |
| Database | Postgres (Neon/Supabase), PlanetScale, D1 | D1 (serverless SQLite) | Zero config, lives in the same Cloudflare ecosystem, no connection pooling headaches. SQLite is plenty for a personal expense tracker. |
| Async processing | Direct response, background tasks, Cloudflare Queues | Cloudflare Queues | Webhook must return 200 within ~30s or Telegram retries. OpenAI calls (especially vision/transcription) can take 10-15s. Queue gives 15min timeout. |
| Onboarding | Multi-step wizard, manual config, inferential | Multi-step with city input | Needed timezone and currency upfront for correct totals. Went with explicit city input to resolve IANA timezone. (Later replaced with inferential approach.) |

## How (Workflow)
Built this in a single extended session. Started with the Cloudflare Workers scaffold and D1 migration, then layered on Telegram webhook handling, onboarding state machine, OpenAI integration, and queue processing. Used Vitest with `@cloudflare/vitest-pool-workers` from day one so tests run inside Miniflare (actual Workers runtime, not just Node.js pretending).

The decision to use Queues was made early after hitting the Telegram webhook timeout wall during prototyping. Returning 200 immediately and offloading all AI work to the queue was the cleanest solution.

## Metrics
- 35 files created, ~6,900 lines added
- 6 test files with coverage across webhook, onboarding, totals, queue parsing, source events, and OpenAPI contract
- 1 D1 migration (init schema)
- Full vertical slice: message -> parse -> store -> query -> respond

## Learnings
- **D1 is surprisingly capable for this use case.** SQLite semantics, no connection management, and the query API is clean. The main limitation is no real-time replication, but that doesn't matter for a single-user bot.
- **Queue architecture pays for itself immediately.** Even before adding the AI layer properly, having the queue boundary meant I could evolve parsing logic without touching the webhook handler.
- **Onboarding is harder than it looks.** Timezone resolution from a city name requires mapping to IANA zones. Currency quick-picks need regional awareness (a user in Manila wants PHP first, not USD). I spent more time on the onboarding state machine than on the actual expense parsing.
- **Single big commits are fine for bootstraps, terrible for everything after.** This commit is essentially unreviewable. I knew that going in — the goal was to get to a working state, not to have a pretty git history for the foundation.

## Content Angles
- "Building a Telegram Expense Bot on Cloudflare Workers: Architecture Decisions" — why edge + queues + serverless SQLite for a personal tool
- "Queue-First Architecture for Chatbot Backends" — the pattern of returning 200 immediately and doing all work async
- "D1 for Side Projects: When Serverless SQLite Makes Sense" — honest take on where D1 works and where it doesn't
