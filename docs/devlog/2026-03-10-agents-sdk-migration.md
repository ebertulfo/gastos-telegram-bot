# Ripping Out the Manual Agent Loop

**Date:** 2026-03-10
**Commits:** 13 commits

## What Changed
- Migrated from manual OpenAI Chat Completions agent loop to the OpenAI Agents SDK (`@openai/agents` v0.6.0)
- Upgraded Zod from v3 to v4 (required as Agents SDK peer dependency; fixed `ZodError.errors` -> `ZodError.issues` breaking change)
- Rewrote `src/ai/tools.ts` with SDK `tool()` definitions and a `createAgentTools()` closure factory returning 4 tools: `log_expense`, `edit_expense`, `delete_expense`, `get_financial_report`
- Implemented `src/ai/session.ts` — a D1-backed custom Session adapter mapping between D1 `chat_history` rows and SDK `AgentInputItem` types
- Rewrote `src/ai/agent.ts` — replaced `classifyIntent()`, `runSemanticChat()`, and `looksLikeLeakedToolCall()` with a single `createGastosAgent()` using the SDK `Agent` class
- Simplified `src/queue.ts` to use SDK `run()` for unified agent processing
- Simplified webhook to unified queue dispatch for all message types (no more intent classification before queueing)
- Simplified `ParseQueueMessage` from discriminated union to flat type (agent handles routing, not the queue)
- Updated model strings from `gpt-4o-mini` to `gpt-4.1-nano` for extraction
- Refactored `updateExpense`/`deleteExpense` to take `D1Database` directly (aligning with project db/ patterns)
- Removed deprecated `GetFinancialReportTool` and `executeGetFinancialReport` exports
- Fixed post-deploy bugs: source_event_id collision, missing token quota check, empty reply handling
- Added `.worktrees` to `.gitignore`

## Why
The manual agent loop in `agent.ts` was growing unmanageable. I had a hand-rolled intent classifier (`classifyIntent()`) that decided whether a message was an expense log, a question, or unclear, then routed to separate code paths. Tool execution was manual — parse the function call, execute, feed the result back. Error handling, conversation history, and the tool-call/response loop were all custom code.

The OpenAI Agents SDK abstracts all of that. Define an agent with a system prompt, give it tools, call `run()`, get a response. The SDK handles the tool execution loop, conversation history injection, and multi-turn reasoning internally. The migration was about reducing surface area — less custom code means fewer bugs in the plumbing, and more time spent on what the tools actually do.

## Key Decisions
| Decision | Options Considered | Chosen | Why |
|----------|-------------------|--------|-----|
| Agent architecture | Multi-agent (classifier -> specialist agents), single unified agent | Single unified agent | The intent classifier was the weakest link — it frequently misclassified questions as log attempts. A single agent with all tools can decide on its own whether to log an expense or answer a question. Simpler, and empirically more accurate. |
| Session implementation | `OpenAIConversationsSession` (hosted by OpenAI), D1-backed custom `Session` | D1-backed custom Session | Data ownership. I want conversation history in my D1 database, not in OpenAI's servers. Also, the hosted session doesn't work in Workers environments. Custom Session was ~107 lines — not a big cost for full control. |
| Queue message type | Keep discriminated union (`receipt` / `chat`), flatten to single type | Flat type | The discriminated union existed because the old code had separate handlers for receipts vs. chat. With a unified agent, the queue just passes the message to `run()` and the agent figures it out. The union was adding type complexity for routing logic that no longer existed. |
| Model for agent reasoning | `gpt-4o`, `gpt-4.1-mini`, `gpt-5-mini` | `gpt-5-mini` | Tested `gpt-4.1-mini` first but it was poor at summarization and frequently missed expense categories. `gpt-5-mini` had noticeably better instruction following and category accuracy. Worth the cost increase for a personal bot. Extraction (structured output) stayed on `gpt-4.1-nano` — cheapest and fastest, accuracy is fine for structured tasks. |
| Workers compatibility | Patch SDK internals, use `setDefaultModelProvider()`, fork the SDK | `setDefaultModelProvider()` | The Agents SDK reads `process.env.OPENAI_API_KEY` by default, which doesn't exist in Workers. `setDefaultModelProvider()` lets you inject a custom OpenAI client with the API key from the Workers env. Clean workaround, no forking needed. |

## How (Workflow)
This was a large task — used the full pipeline (design doc, plan, worktree, TDD, verification, review). The worktree was critical because the migration touches nearly every core file; I needed to experiment without breaking the main branch.

Build order was bottom-up: dependency upgrades first (Zod v4, SDK install, model strings), then tools, then session, then agent, then queue, then webhook. Each layer was tested before moving to the next. The TDD approach caught several issues early — particularly in the Session adapter where the SDK's `AgentInputItem` type system is more complex than you'd expect (it has `UserMessageItem`, `AssistantMessageItem`, plus tool call/result types that I chose to silently skip).

The deploy was rough. Three bugs surfaced immediately: a source_event_id collision (the queue was re-inserting an event that already existed), a missing token quota check (the old code checked before queueing, the new code didn't), and an empty reply bug (when the agent returns only tool calls with no text response). All three were fixed in the follow-up commit.

## Metrics
- 19 files changed, ~1,177 lines added, ~801 lines removed (net reduction of ~376 lines of plumbing)
- 2 new source files (`src/ai/session.ts`, rewritten `src/ai/tools.ts`)
- 3 new/expanded test files (`tests/session.test.ts` — 15 tests, `tests/tools.test.ts` — expanded, `tests/queue.test.ts` — rewritten)
- 1 dependency added (`@openai/agents`), 1 upgraded (`zod` v3 -> v4)
- Intent classifier removed entirely (~150 lines of classify + route logic)
- Post-deploy hotfix: 3 bugs found and fixed within hours

## Learnings
- **Removing the intent classifier was the biggest win.** The classifier was a fragile middleman — it had to guess what the user meant before the agent could act. With a unified agent, the model sees the full context (system prompt + tools + history) and makes better decisions than a standalone classifier ever could. This is a general pattern: if your pre-routing logic is weaker than the agent itself, remove it and let the agent route.
- **Custom Session adapters are straightforward.** The SDK's Session interface is just `getMessages()`, `addMessages()`, `clear()`. Mapping to/from D1 rows was ~100 lines. If you're hesitating because you don't want to use OpenAI's hosted sessions, the custom path is easier than you'd think.
- **Workers compatibility is the biggest friction point.** `process.env` doesn't exist in Workers. The SDK assumes Node.js. `setDefaultModelProvider()` fixes it, but I only found it by reading the SDK source code — it wasn't in the docs. If you're deploying Agents SDK to Workers, this is the first thing you need to know.
- **Test your deploy, not just your code.** All three post-deploy bugs passed the test suite. They were integration-level issues (DB constraint violations, missing middleware, response format edge cases) that unit tests don't catch. The gap between "tests pass" and "it works in prod" is real.
- **Model selection matters more than prompt engineering.** I spent 2 hours tweaking prompts for `gpt-4.1-mini` before trying `gpt-5-mini`. The model switch fixed the summarization and category issues immediately. Sometimes the answer isn't a better prompt — it's a better model.

## Content Angles
- "Migrating from Manual Chat Completions to the OpenAI Agents SDK: A Practical Guide" — step-by-step migration path with before/after code and gotchas
- "Why I Removed the Intent Classifier and Let the Agent Decide" — the case for single-agent over classifier-then-specialist architectures
- "Deploying OpenAI Agents SDK on Cloudflare Workers" — the `setDefaultModelProvider()` workaround and other Workers-specific issues
- "The Three Bugs That Passed All Tests" — a post-mortem on integration-level bugs that unit tests miss, and what to do about it
