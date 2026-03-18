# Debugging a Real User, Fixing 3 Bugs, and Shipping Feedback Commands

**Date:** 2026-03-18
**Duration:** ~3h
**Commits:** 15 commits
**PRs:** #10, #11, #12

## What Changed

- **Debugged user 152's experience** — queried prod D1 to reconstruct their full journey (expenses, chat history, source events, traces)
- **Fixed leaked chain-of-thought reasoning** — switched OpenAI provider from Chat Completions (`useResponses: false`) to Responses API, which structurally separates reasoning tokens from content
- **Fixed silent queue failures** — agent errors without `.state` now notify the user instead of silently retrying until Cloudflare drops the message
- **Fixed tracing regression** — updated `AgentTraceProcessor` to handle `response` spans (Responses API) in addition to `generation` spans
- **Fixed duplicate source events** — threaded original `sourceEventId` from webhook through queue/agent/tools so `log_expense` reuses it instead of minting synthetic duplicates
- **Shipped `/feedback` and `/bug` commands** — users can now report issues directly from the bot, stored in D1 with chat context, auto-creates GitHub Issues (privacy-safe — no chat content in issues)

## Why

Started from a simple question: "can we debug using another user's data?" Pulled up user 152 (latest signup, joined yesterday from Singapore). Found three real bugs in their experience:

1. Chat history ID 238 contained leaked internal reasoning ("We have context. User added another expense...") — the model's chain-of-thought was streaming to the user
2. Source events 135/136 ("Tada 17.22 transport") processed through the full pipeline but produced zero output — no expense, no error, no notification
3. Every expense created two source events — one from the webhook, one synthetic from `log_expense` — leaving the original orphaned

The feedback commands were a natural follow-up: if users can't report issues, we only find bugs by manually querying prod.

## Key Decisions

| Decision | Options Considered | Chosen | Why |
|----------|-------------------|--------|-----|
| Fix reasoning leak | Strip reasoning post-hoc; switch to Responses API; disable reasoning | Responses API | Structural guarantee — event types prevent leakage by design, not heuristics |
| Error handling on agent failure | Keep retry + add DLQ; catch and notify user | Catch and notify | No DLQ configured; retrying persistent errors = silent drops after 3 attempts |
| Feedback storage | D1 only; GitHub Issues only; both | Both | D1 for queryable history, GitHub for actionable tracking |
| Chat context in GitHub Issues | Full content; message IDs only | IDs only | Privacy — user chat content shouldn't be on public GitHub |

## How (Workflow)

**Debugging phase:**
- Used `npx wrangler d1 execute --remote` extensively to query prod D1 — expenses, chat history, source events, traces
- Dispatched `feature-dev:code-explorer` subagents in parallel to trace all three bugs through the codebase
- Cross-referenced trace timestamps to identify the silent failure pattern (1s `queue.receipt` vs 8.5s on success)

**Bug fix phase (PRs #10, #11):**
- Assessed as Small tasks, followed TDD pipeline
- Dispatched `openai-specialist` to research `useResponses` behavior before implementing
- Code reviewer caught a critical tracing regression (AgentTraceProcessor only handled `generation` spans, not `response` spans) — fixed before merge
- Both PRs merged cleanly

**Feature phase (PR #12):**
- Full brainstorming flow: clarifying questions one at a time, design proposal, spec document, implementation plan
- Subagent-driven development: dispatched 3 implementation subagents in parallel (Tasks 2-4), did Task 1 and 5 directly
- Task 6 (integration) dispatched to a single subagent with full context
- 187 tests passing at merge

## Metrics

- Tests: 187 passing (18 files) — up from 173 at session start
- Type check: clean
- Lines changed: +700 / -20 (approximate)
- New files: 6 (migration, feedback.ts, github.ts, 3 test files)
- Deployments: 1 (after PR #12 merge)

## Learnings

**Technical:**
- `gpt-5-mini` with `useResponses: false` can leak reasoning tokens in `delta.content` — the Chat Completions API doesn't guarantee separation. The Responses API does, structurally, via event type discrimination.
- Cloudflare Queues without a DLQ silently drops messages after 3 retries. Adding user notifications on the error path is a cheap insurance policy.
- Cross-referencing trace span durations against successful interactions is a powerful debugging technique (1s vs 8.5s immediately reveals the failure point).

**Process:**
- "Can we debug using another user's data?" is a great session starter — real user issues surface bugs that tests miss
- Parallel subagent dispatch for independent modules (feedback DB, chat-history, GitHub) saved significant time — all three completed while I handled the trivial tasks
- The privacy concern about chat content in GitHub Issues was caught by the user during brainstorming — good example of why human review of specs matters

**AI collaboration:**
- Specialist subagents (openai-specialist) prevent costly mistakes — the tracing regression would have shipped without the research
- Code reviewer subagent caught the AgentTraceProcessor gap that I missed — two-stage review pays off
- Subagent-driven development worked well for this feature — clear boundaries, parallel execution, clean commits

## Content Angles

- "Debugging Production Users with D1 Traces" — the full debugging flow from user query to root cause
- "Why Your AI Bot Might Be Leaking Its Thoughts" — the reasoning token leakage bug and the Chat Completions vs Responses API difference
- "Building a User Feedback Loop for Telegram Bots" — from bug discovery to shipping /feedback in one session
- "Parallel Subagent Development" — dispatching 3 agents simultaneously for independent modules
