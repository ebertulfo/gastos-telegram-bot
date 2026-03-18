# Security Sweep + Agent Experience Overhaul — The "Bot Stopped Working" Session

**Date:** 2026-03-18
**Duration:** ~3h
**Commits:** 25+ commits (security sweep merge + agent experience fixes + hotfixes)
**PRs:** #8 (agent experience fixes)

## What Changed

- **Merged security sweep** — 10 security fixes from `feature/security-sweep` branch (webhook signature validation, CORS restriction, API rate limiting, security headers, column whitelist, currency validation, Hono upgrade, debug endpoint secret, IDOR fix, initData expiration)
- **Fixed mock data fallback** — Mini App was silently showing demo data ("Lunch at hawker center", "Uniqlo t-shirts") when API calls failed, making users think they were seeing someone else's expenses. Replaced with error state + retry button.
- **Fixed CORS origin mismatch** — `ALLOWED_ORIGINS` pointed to `gastos-mini-app.pages.dev` but actual Pages domain is `gastos-telegram-mini-app.pages.dev`. Every Mini App API call was getting rejected.
- **Fixed hallucinated expense IDs** — agent was inventing expense IDs (e.g. #1001) when editing because tool call results were dropped from session history. Fixed by injecting last 10 expenses from DB into system prompt.
- **Fixed silent update/delete failures** — `updateExpense`/`deleteExpense` returned void, so "Updated Coffee" was a lie when 0 rows matched. Now returns `meta.changes` count.
- **Added log_expense dedup guard** — Set-based dedup in tool closure prevents model from calling log_expense twice for the same item in one turn.
- **Added 8 new prompt rules** — amount disambiguation, duplicate prevention, ambiguous amounts vs brand names, latest/recent defaults, corrections-as-edits, dollar sign currency, English-only, anti-hallucination for transaction counts.
- **Optimized latency** — restructured prompt for OpenAI caching (static rules first, dynamic context last), set `reasoning.effort: "minimal"`. First turn dropped from 19s to ~2-3s.

## Why

User reported three separate production issues in rapid succession:
1. "Bot stopped working" — turned out webhook secret needed re-registration with Telegram after security sweep deploy
2. "I'm seeing someone else's expenses in the Mini App" — mock data fallback was displaying demo data when CORS rejected API calls
3. "The agent says it updated but it didn't" — hallucinated expense IDs + silent void returns from DB functions

Each fix revealed the next problem. The mock data issue was particularly bad for user trust — it looked like a data leak when it was actually fake data being shown as if it were real.

## Key Decisions

| Decision | Options Considered | Chosen | Why |
|----------|-------------------|--------|-----|
| How to give agent real expense IDs | A) Store full tool call history in D1Session, B) Inject recent expenses into system prompt, C) Make edit_expense search-based | B) System prompt injection | Simplest, no schema migration, fresh from DB every time, works for both immediate corrections and delayed lookups |
| How to handle "$" symbol | Map to USD, map to user's default currency, always ask | Map to user's default currency | User's currency is SGD — "$" meaning USD is an American-centric assumption |
| How to prevent duplicate logging | Prompt-only, code guard only, both | Both prompt + code guard | Belt and suspenders — prompt for model behavior, Set-based dedup as safety net |
| Prompt caching strategy | Keep dynamic context inline, move to end | Move dynamic context to end | ~2200 static tokens become cacheable, only ~300 dynamic tokens at the end vary per user |

## How (Workflow)

- **gastos:assess-task-size** classified agent experience fixes as Medium
- **superpowers:brainstorming** with human-in-the-middle review of each design section (learned this lesson mid-session after rushing the first spec)
- **openai-specialist** agent researched SDK session behavior — confirmed D1Session drops FunctionCallItem/FunctionCallResultItem because they have `type` not `role`
- **superpowers:writing-plans** produced 9-task plan across 4 chunks
- **superpowers:using-git-worktrees** isolated work on `feature/agent-experience-fixes`
- **TDD** throughout — tests written before implementation for all 8 tasks
- **Code review + simplify agents** run in parallel after implementation
- Multiple hotfix → deploy → test → observe cycles for prompt tuning

## Metrics

- Tests: 167 passing (16 files) — up from 148 at session start
- Type check: clean
- Lines changed: +2322 / -137 across 30 files
- New files: 3 (webhook-auth.ts, webapp/_headers, agent-experience-fixes spec/plan)
- Deployments: 6 deploys in one session

## Learnings

**Technical:**
- OpenAI Agents SDK Session interface receives ALL item types (FunctionCallItem, FunctionCallResultItem, etc.) — custom Session implementations must handle them or lose tool context between turns
- `meta.changes` on D1 run results gives actual affected rows — don't use `rows_written` which includes index updates
- `reasoning.effort: "minimal"` on gpt-5-mini is a massive latency win (19s → 3s) with seemingly no quality loss for this use case
- Prompt caching requires static content at the START of the prompt — dynamic values (dates, user context) must go at the end

**Process:**
- Always check `git branch -a` and worktrees at session start — we had a fully completed security sweep branch that wasn't noticed
- Mock data in production is a trust-destroying antipattern — never use it as a fallback, even "temporarily"
- Human-in-the-middle for design decisions — got corrected mid-session for rushing from proposals to spec without checkpoints
- Deploy-and-observe cycles are essential for prompt engineering — you can't test LLM behavior in unit tests

**AI Collaboration:**
- Specialist subagents (openai-specialist) provided critical insight about SDK session internals that would have taken significant time to figure out manually
- Parallel agent dispatch (code review + simplify simultaneously) saved time
- The "100 Plus" brand name issue (user said "$100 plus $1.50" meaning the drink brand) was only caught because the user provided the real context — no amount of code analysis would have found it

## Content Angles

- "When Your AI Bot Shows Fake Data to Real Users" — the mock data fallback antipattern and why silent failures are worse than visible errors
- "The Expense ID Hallucination Problem" — how LLM agents lose context between turns and the system prompt injection pattern to fix it
- "6 Deploys in 3 Hours: Rapid Iteration on LLM Agent Behavior" — the observe → diagnose → fix → deploy cycle for prompt engineering in production
- "From 19s to 3s: One Setting That Cut Our Bot's Response Time by 85%" — reasoning.effort and prompt caching for OpenAI agents
