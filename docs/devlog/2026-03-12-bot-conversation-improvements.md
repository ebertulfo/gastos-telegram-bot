# Fixing Real Bot Conversations — Production Chat Analysis to Deployed Fixes

**Date:** 2026-03-12
**Duration:** ~2.5h
**Commits:** 8 commits (squash-merged as PR #4)
**PRs:** #4

## What Changed

- **System prompt hardened** with explicit DATE HANDLING, QUERY SCOPE, and CATEGORIES sections in `buildSystemPrompt()`
- **Date validation safeguard** — `validateOccurredAt()` rejects hallucinated dates (>30 days past or any future) at the tool call level
- **Content-based message dedup** — `findRecentDuplicateContent()` catches rapid retaps (same text within 30s window) that telegram_message_id dedup misses
- **D1 composite index** on `(user_id, text_raw, created_at_utc)` for the dedup hot-path query
- **Webhook flow reordered** — ack message now fires before dedup check so users get immediate feedback
- **CLAUDE.md freshness fixes** — test counts (7→13 files, 21→96 tests), queue type description, db module list

## Why

The user and I analyzed 116 production chat messages and 23 expense records from D1 to find real UX pain points. The smoking gun: logging "coffee 5 and lunch 12" on March 12 resulted in the agent hallucinating `occurred_at: "2026-03-10"` for one item, making it invisible when the user asked "how much today?" This was a trust-breaking bug — the bot confirmed it logged both items but the data told a different story.

Other issues surfaced from the same analysis: over-clarification on simple messages, context bleeding between questions, category miscategorization (protein shake → "Other" instead of "Food"), and duplicate messages from retaps when the bot was slow.

## Key Decisions

| Decision | Options Considered | Chosen | Why |
|----------|-------------------|--------|-----|
| Date hallucination fix | Prompt-only fix vs code safeguard | Both (defense in depth) | Prompt tells LLM not to guess dates; code rejects bad dates anyway |
| Future date threshold | Allow +1 day (timezone buffer) vs reject all future | Reject all future (`diffDays < 0`) | Code review caught that +1 day was too permissive |
| Content dedup location | Webhook (blocking) vs queue (async) | Webhook with ack-first reorder | Prevents unnecessary source event creation + queue work; ack fires before the check |
| Index column order | `(user_id, text_raw, created_at_utc)` vs `(user_id, created_at_utc, text_raw)` | text_raw before created_at | Query uses equality on text_raw and range on created_at — equality columns first is correct for B-tree |

## How (Workflow)

Full Medium pipeline executed:

1. **Assess** (`gastos:assess-task-size`) — classified as Medium (3+ files, new dedup concept)
2. **Plan** (`superpowers:writing-plans`) — 7-task plan with TDD steps, reviewed by plan-document-reviewer
3. **Worktree** — isolated branch `fix/bot-conversation-improvements`
4. **TDD** — red-green for each feature: prompt tests, date validation tests, dedup unit tests, webhook integration test
5. **Verify** — 96/96 tests, TypeScript clean
6. **Code review** (`superpowers:code-reviewer`) — caught missing edit_expense validation, misleading log message
7. **Simplify** — 3 parallel agents (reuse, quality, efficiency) found 2 actionable fixes: redundant `!== undefined` guard, ack-before-dedup reorder
8. **Audit context** (`gastos:audit-context`) — found 3 stale items across CLAUDE.md, MEMORY.md, backlog
9. **Revise CLAUDE.md** — added webhook test mock ordering gotcha
10. **Deploy** — migration 0008 applied, then code deployed

Specialist agents dispatched: openai-specialist (prompt engineering research), telegram-specialist (webhook patterns), cloudflare-specialist (D1 index design).

## Metrics

- Tests: 96 passing (13 files) — up from 87
- Type check: clean
- Lines changed: +237 / -14
- New files: 1 (migration)
- Deployment: yes (migration + code)

## Learnings

- **Production chat analysis is gold** — reading actual user conversations with the bot revealed 6 issues that no amount of code review would have found. The date hallucination bug was invisible in logs because the bot *said* it logged correctly.
- **Defense in depth for LLM outputs** — prompt instructions are necessary but insufficient. The `validateOccurredAt()` safeguard catches dates the prompt should have prevented but didn't. This pattern (prompt + code validation) should be standard for any LLM tool parameter that affects data integrity.
- **Simplify agents catch real issues** — the efficiency reviewer correctly identified that the ack message was blocked by the dedup query. Simple reorder, meaningful UX improvement.
- **Context audits pay off** — CLAUDE.md had test counts from months ago (7 files → 13 files). Every session that read "21 tests" was getting a slightly wrong mental model.
- **Webhook test mock ordering is fragile** — D1 mock routing in tests uses string matching on SQL queries. More specific matchers must come before generic ones or they silently fail to match.

## Content Angles

- "Debugging AI Hallucinations with Production Data" — how reading 116 real chat messages revealed a date hallucination bug that broke user trust
- "Defense in Depth for LLM Tool Calls" — why prompt engineering alone isn't enough and you need code-level validation on LLM outputs
- "The 10-Step AI-Assisted Development Pipeline" — walking through the full Medium workflow from production analysis to deployed fix
- "Content-Based Dedup at the Edge" — implementing rapid-retap detection in Cloudflare Workers with D1 indexes
