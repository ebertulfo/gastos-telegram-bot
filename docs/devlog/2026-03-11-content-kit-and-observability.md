# Two Threads, One Session: Documentation and Observability

**Date:** 2026-03-11
**Commits:** 21 commits

## What Changed

### Thread 1: Documentation Content Kit
- Created design spec for a decision-first documentation approach
- Scaffolded and completed a decision journal covering 20 decisions across 6 project phases
- Wrote a user guide for the Gastos bot
- Wrote 3 narrative documents: product story (~1,150 words), technical story (~2,350 words), process story (~2,050 words, first-person Agentic Engineering journey)
- Wrote a combined case study (~2,650 words) with problem statement, 7 decision highlights, architecture deep dive, and development methodology
- Polished and cross-referenced all documents (fixed relative links, updated model names to match codebase, removed placeholder tags)

### Thread 2: Observability System
- Designed D1 traces + KV error index observability architecture
- Wrote implementation plan (~761 lines)
- Added D1 migration (`0007_add_traces.sql`) with traces table schema and `TRACES_KV` binding
- Built `src/tracer.ts` — Tracer class with `span()` for timing operations and `flush()` for batch D1 writes + KV error indexing
- Instrumented `src/routes/webhook.ts` with top-level `webhook.receive` span and nested `webhook.media_upload` spans, propagating `traceId` to queue messages
- Instrumented `src/queue.ts` with trace spans for agent processing
- Added daily trace cleanup in the cron handler (reusing the hourly scheduled trigger)
- Created `gastos-debug` skill with pre-built trace queries and a debugging playbook

### Thread 3: Tool Fixes and UX
- Fixed `edit_expense` tool column mapping bug (wrong column names in UPDATE query)
- Added expense IDs to `get_financial_report` and `log_expense` output (agent can now reference specific expenses)
- Added `occurred_at` date parameter to both `log_expense` and `edit_expense` tools
- Built contextual ack messages — bot sends a typing indicator + context-aware message (question-aware heuristic) immediately before the agent runs, reducing perceived latency

## Why
Two different motivations converged in one session. The content kit was overdue — I had a working product with interesting architectural decisions but no written narrative. Every time someone asked "what's this project about?" I was explaining from scratch. The decision journal approach (document decisions first, derive narratives from them) came from noticing that the most interesting parts of any project are the choices, not the features.

The observability system was triggered by the Agents SDK deploy the day before. Three bugs slipped through testing and I had no visibility into what was happening in production. No traces, no error aggregation, no way to correlate a webhook request with its queue processing. For a serverless app with async queue processing, that's flying blind.

The tool fixes and ack messages were small quality-of-life improvements I'd been putting off. The ack messages in particular address a real UX problem — the agent can take 3-8 seconds to respond, and during that time the user sees nothing. A quick "thinking about your question..." message bridges the gap.

## Key Decisions
| Decision | Options Considered | Chosen | Why |
|----------|-------------------|--------|-----|
| Tracing backend | External service (Sentry, Baselime, Axiom), D1 + KV, Workers Analytics Engine | D1 + KV | Keeps the project on free tier. External services add cost and a dependency. D1 handles structured queries over trace data; KV provides hot error lookup with 7-day TTL auto-expiry. Workers Analytics Engine was considered but has a write-only API — no ad hoc queries. |
| KV role in observability | KV for all traces, KV only for errors, no KV | KV for error index only | D1 is the source of truth for all traces. KV is a hot cache for recent errors only — the 7-day TTL means stale errors auto-expire without cleanup logic. This avoids KV's 25MB value limit for large trace sets while keeping error lookup fast. |
| Trace write strategy | Write each span immediately, batch at end of request | Batch writes via `flush()` | D1 has per-request overhead. Batching all spans into a single `flush()` call at the end of the handler minimizes round-trips. The Tracer accumulates spans in memory and writes them all in one batch statement. |
| Documentation approach | Feature-by-feature docs, chronological blog posts, decision journal + derived narratives | Decision journal as backbone | Features change; decisions explain why. A decision journal captures the reasoning that's hardest to reconstruct later. The four narratives (product, technical, process, combined) are different lenses on the same decisions, optimized for different audiences. |
| Ack message content | Generic "processing...", typing indicator only, context-aware message | Context-aware with question detection | Generic messages feel robotic. The heuristic checks if the user's text looks like a question (starts with question word, ends with ?) and responds accordingly: "let me look into that..." for questions, "logging that..." for expenses. Small touch, noticeable improvement in perceived responsiveness. |

## How (Workflow)
This was a dense session that jumped between three workstreams. The content kit came first (morning) — scaffolded the decision journal, did a self-interview to fill in context for all 20 decisions, then generated the derivative narratives. The observability system came second (afternoon) — design doc, plan, then bottom-up implementation (migration, Tracer, instrumentation, cleanup, debug skill). Tool fixes and ack messages were interleaved throughout as I noticed issues while testing.

The Tracer was built with TDD — 11 tests covering span timing, flush batching, KV error indexing, and edge cases (empty spans, flush without errors). The tracing instrumentation in webhook.ts and queue.ts was designed to be conditional on `TRACES_KV` availability, so existing tests that don't mock the binding continue to pass without changes.

The content kit was the least "coding" part — more interviewing myself about past decisions and turning raw reasoning into structured prose. The combined case study went through multiple rounds of editing to get the narrative arc right (problem -> decisions -> architecture -> methodology -> results).

## Metrics
- 27 files changed, ~3,334 lines added, ~105 lines removed
- 1 D1 migration (`0007_add_traces.sql`)
- 2 new source files (`src/tracer.ts`, contextual ack in `src/telegram/messages.ts`)
- 1 new test file (`tests/tracer.test.ts` — 11 tests), plus expanded tool tests
- 6 documentation files created (decision journal, user guide, 3 narratives, case study)
- 2 design specs + 1 implementation plan (~1,158 lines of planning docs)
- 1 new Claude Code skill (`gastos-debug`)
- 3 tool bug fixes

## Learnings
- **D1 + KV is a solid free-tier observability stack.** It's not Datadog, but for a personal project it provides exactly what I needed: structured trace queries, error aggregation, and auto-expiring hot indexes. The batch write pattern keeps D1 costs negligible.
- **Conditional instrumentation is essential.** Making tracing depend on `TRACES_KV` availability meant zero changes to existing tests. If I'd made it mandatory, I'd have spent half the session updating test fixtures. Feature flags for observability are just as important as feature flags for product features.
- **Decision journals are the highest-leverage documentation.** Writing the narratives was easy once the decisions were documented. The journal is the raw material; the stories are just different edits of the same footage. If you only document one thing about a project, make it the decisions.
- **Ack messages are a cheap UX win.** Two lines of code (detect question, send appropriate message) make the bot feel significantly more responsive. The actual processing time doesn't change, but perceived latency drops because the user gets immediate feedback. This is a well-known pattern in consumer apps but easy to overlook in bot development.
- **Dense sessions need thread discipline.** Jumping between content kit, observability, and bug fixes in one session works but requires conscious context switching. I used the commit history as a breadcrumb trail — each commit message is detailed enough to reconstruct where I was in each thread.

## Content Angles
- "D1 + KV as a Free-Tier Observability Stack for Cloudflare Workers" — architecture, batch writes, KV error indexing with TTL auto-expiry
- "Decision Journals: The Highest-Leverage Documentation You're Not Writing" — the approach of documenting decisions first and deriving all other content from them
- "Reducing Perceived Latency in Chatbots with Contextual Ack Messages" — the simple heuristic-based approach and why generic "processing..." messages fall flat
- "Observability as an Afterthought: What Three Production Bugs Taught Me" — the real-world motivation for adding tracing to a side project
