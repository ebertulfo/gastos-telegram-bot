# Streaming Agent Replies to Telegram

**Date:** 2026-03-14
**Duration:** ~4h (spans two sessions — brainstorm/design + implementation)
**Commits:** 4 commits (implementation only; design spec committed in prior session)
**PRs:** None (merged locally)

## What Changed

- Added `sendMessageDraft` function to call Telegram Bot API 9.3+ draft streaming endpoint
- Created `StreamingReplyManager` class — manages draft lifecycle (send, throttle, accumulate, finalize)
- Switched queue processor from `run()` to `run({ stream: true })` — progressive drafts during agent generation
- Tool status messages shown while tools execute ("Logging your expense...", "Looking up your expenses...")
- 11 new tests for StreamingReplyManager, updated 5 existing queue tests for streaming mocks

## Why

The agent's `run()` call takes 7-20s (avg ~11s). During that time users see only a "typing..." indicator, then a wall of text. After deploying the AgentTraceProcessor (previous session), sub-span analysis revealed Turn 1 (model generating reply after receiving tool data) is 81% of total time — pure generation latency that can't be reduced server-side.

Streaming the response progressively makes the bot feel alive: users see tool status messages within 3s, then text appearing word-by-word, then a final formatted message.

## Key Decisions

| Decision | Options Considered | Chosen | Why |
|----------|-------------------|--------|-----|
| Streaming API | A) `editMessageText` (edit in place) B) `sendMessageDraft` (Bot API 9.3+) | B | No "message not modified" errors, designed for streaming cadence, simpler throttle (1s vs 2-3s), no message_id tracking needed |
| Mid-stream formatting | A) MarkdownV2 throughout B) Plain text drafts, MarkdownV2 on final | B | Partial MarkdownV2 with unmatched markers causes parse errors — plain text during streaming avoids this entirely |
| Error retry path | A) Stream on retry too B) Fall back to non-streaming `run()` | B | No double-complexity on error path — retry is rare, simplicity wins |
| Tool status UX | A) Just "typing..." indicator B) Named status messages per tool | B | Users see "Looking up your expenses..." vs generic indicator — more informative, builds trust |

## How (Workflow)

Full large-task pipeline executed:

1. **Brainstorming** (`superpowers:brainstorming`) — explored editMessageText vs sendMessageDraft, user found the draft API and redirected the design
2. **Design spec** — written, committed, reviewed by spec-document-reviewer subagent
3. **Plan** (`superpowers:writing-plans`) — 3-task plan with complete code, reviewed by plan-document-reviewer subagent
4. **Worktree** (`superpowers:using-git-worktrees`) — isolated workspace at `.worktrees/streaming-replies`
5. **Subagent-driven execution** (`superpowers:subagent-driven-development`) — Sonnet implementers, Haiku spec reviewers, Opus code quality reviewers
6. **Final review** — full-implementation code review by Opus subagent
7. **Merge** — fast-forward to main, worktree cleaned up
8. **Deploy** — live on Cloudflare Workers
9. **Context audit** (`gastos:audit-context`) — fixed stale test counts and file map

Specialist agents: `telegram-specialist` dispatched during brainstorming for sendMessageDraft API research. Added "Research Scope" section to its definition after it went too broad (researching grammY, python-telegram-bot — we call the API directly).

## Metrics

- Tests: 133 passing (16 files)
- Type check: clean
- Lines changed: +355 / -24
- New files: 2 (`src/telegram/streaming.ts`, `tests/streaming.test.ts`)
- Deployment: yes

## Learnings

**Technical:**
- Telegram's `sendMessageDraft` is purpose-built for streaming — no "message not modified" errors, accepts identical content gracefully, 1s throttle is safe
- OpenAI Agents SDK streaming types are complex — `RunItem` union doesn't expose `rawItem` on tool_called events cleanly, requiring `as any` cast
- `useResponses: false` on `OpenAIProvider` is critical — without it, the SDK uses Responses API which emits `response` spans instead of `generation` spans, breaking our tracing

**Process:**
- Subagent-driven development with two-stage review (spec compliance + code quality) caught real issues: implementer correctly identified that the plan pointed at wrong test file for mock updates
- The brainstorming phase course-corrected significantly — started with editMessageText, user found sendMessageDraft API mid-conversation, redesigned entirely

**AI collaboration:**
- Telegram specialist subagent needs scope constraints — without explicit "Research Scope" section, it researched irrelevant bot frameworks
- Haiku spec reviewers are fast and accurate for mechanical verification — good cost/speed tradeoff vs. Opus for this role

## Content Angles

- "Making AI bots feel alive: streaming responses to Telegram with sendMessageDraft"
- "Subagent-driven development: how I use Claude to coordinate its own code reviews"
- "From 20-second wall of text to progressive streaming — measuring and fixing perceived latency"
