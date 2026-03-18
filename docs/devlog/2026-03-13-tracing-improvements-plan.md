# Planning Tracing Improvements for Latency Debugging

**Date:** 2026-03-13
**Duration:** ~30m
**Commits:** 0 commits (planning only)
**PRs:** none

## What Changed

- Created implementation plan at `docs/superpowers/plans/2026-03-13-tracing-improvements.md`
- Assessed current tracing infrastructure (7 traced operations, many gaps)
- Designed 6-task plan to improve observability: NoopTracer pattern, 10 new spans, queue wait time tracking, 3 debug endpoints

## Why

Response latency is the biggest pain point with the bot. The existing `Tracer` class records spans to D1, but coverage is incomplete — many operations (user upsert, rate limit check, quota check, queue wait time) are invisible. There's also no way to query the trace data without running raw SQL via wrangler. The goal is to instrument everything so we can identify where time is actually being spent.

## Key Decisions

| Decision | Options Considered | Chosen | Why |
|----------|-------------------|--------|-----|
| Eliminate `if (tracer)` branching | (a) Make KV optional in Tracer constructor, (b) NoopTracer subclass, (c) Explicit ITracer interface + noopTracer singleton | (c) ITracer interface + noopTracer | Cleanest for tests — webhook tests don't set TRACES_KV, so noopTracer avoids mock DB interference. Also keeps tracing opt-in. |
| ITracer as interface vs `Pick<Tracer, ...>` | Pick type alias vs explicit interface | Explicit interface | Plan reviewer caught that `Pick` loses the generic `<T>` on `span()`, widening return types to `unknown`. Blocking bug avoided before any code was written. |
| Queue wait time tracking | (a) Metadata on queue.receipt span, (b) Synthetic span via new `record()` method | (b) `record()` method | Separate span enables SQL aggregation by span_name without JSON parsing. `record()` is reusable for any pre-computed timing. |
| Debug endpoint naming | `totalMs` vs `sumMs` for span duration sum | `sumMs` | Reviewer pointed out that summing all spans double-counts nested spans (webhook.receive includes inner spans). `sumMs` is honest about what it computes. |

## How (Workflow)

- **`gastos:assess-task-size`** — classified as Medium (3+ files, enhancing existing pattern)
- **`superpowers:writing-plans`** — created detailed TDD implementation plan with 6 tasks
- **Explore subagent** — deep-dived the entire tracing infrastructure (tracer.ts, queue.ts, webhook.ts, app.ts, tests, migrations, types)
- **Two plan reviewer subagents dispatched in parallel** — one per chunk. Caught 2 blocking TypeScript issues (generic erasure with `Pick`, missing parameter on noopTracer) and 4 lower-priority issues (ambiguous placement, missing test, misleading metric name, input validation)
- All reviewer feedback incorporated into the plan before saving

## Metrics

- Tests: 96 passing (13 files) — unchanged, no code written
- Type check: clean
- Lines changed: +0 / -0 (plan document only)
- New files: 1 (plan)
- Deployment: no

## Learnings

- **Plan review pays off**: The subagent reviewer caught that `Pick<Tracer, ...>` silently loses generic type parameters — this would have been a frustrating type error during implementation. Catching it at plan time costs nothing.
- **Tracing coverage matters more than tracing sophistication**: The existing Tracer class is solid. The problem is just that half the operations aren't wrapped. Simple span wrapping gives more value than fancy distributed tracing.
- **Queue wait time is invisible by default**: There's no built-in way to measure time-in-queue on Cloudflare Queues. Adding `enqueuedAtUtc` to the message payload is a simple workaround.
- **The `if (tracer)` pattern is a code smell**: Having every traced call site double in size with an if/else branch discourages adding new spans. The NoopTracer pattern makes adding new spans trivial (one-line change).

## Content Angles

- "Observability on Cloudflare Workers: Building a DIY tracer with D1 and KV" — the Tracer design, batching constraints, KV error index
- "Plan review with AI subagents" — how dispatching parallel reviewers caught a TypeScript generics bug before any code was written
- "The NoopTracer pattern" — how a simple no-op implementation eliminates conditional boilerplate and makes instrumentation frictionless
