# Gastos Telegram Bot

## Commands
- `npm run test` — run full test suite (vitest, 19 files, 212 tests)
- `npm run check` — TypeScript type check only (tsc --noEmit)
- `npm run check && npm run test` — standard verification after any change
- `npm run dev` — local dev server (wrangler dev)
- `npm run deploy` — deploy to Cloudflare Workers

## Architecture
- Cloudflare Workers (Hono) + D1 + R2 + KV + Queues + Vectorize
- Webhook returns 200 immediately; all heavy AI work goes to INGEST_QUEUE
- Single `ParseQueueMessage` type — all messages go through the same Agents SDK `run()` pipeline
- `APP_ENV` is `"prod"` in wrangler.toml; use `"development"` locally via `.dev.vars`
- `queue.ts` processes queue messages via `processMessage()` — runs agent with streaming, handles media, sends progressive drafts via `StreamingReplyManager`

## Code Patterns
- Hono middleware must be `async (c, next) => { await next(); }` — sync middleware returning `c.json()` causes a TS overload error
- `Env` type lives in `src/types.ts` — add new Cloudflare bindings/env vars there first
- All DB queries inject `user_id` from auth context — LLM tools must never accept userId from user input
- `response_format: { type: "json_object" }` used on all OpenAI extraction calls
- `db/` functions take `D1Database` directly (not `Env`) — current files: expenses, users, chat-history, quotas, source-events, parse-results, notifications, feedback, tag-preferences, audit-log
- Use `z.infer<typeof Schema>` to type helper return values — avoids duplicating Zod schema shapes as manual types

## Testing
- Tests use `@cloudflare/vitest-pool-workers` — runs in a Miniflare Workers environment
- OpenAI, Vectorize, agent, and rate-limiter are mocked in tests — not integration tested
- Pure deletion/cleanup tasks don't need new tests; existing suite is sufficient as regression guard
- Webhook test `createMockDb` has order-sensitive `prepare()` branches — more specific query matchers (e.g. content dedup) must come before generic ones (e.g. `SELECT id FROM source_events`)
- `tools.test.ts` mocks `../src/totals` — when adding new exports from totals.ts, update the mock to use `importOriginal` pattern to preserve real implementations
- `tools.test.ts` has date-dependent tests with hardcoded dates — these fail when the dates fall outside the 30-day validation window; update the test dates if they start failing
- `npx wrangler d1 execute gastos-db --remote --command "SQL"` — query prod D1 for debugging

## Workflow

### Task Size Assessment
- Run `gastos:assess-task-size` at the start of every task
- Announce size + reasoning + pipeline steps
- Wait for user confirmation before proceeding
- User can override size at any time

### Size Heuristics
| Size | Heuristic |
|------|-----------|
| **Trivial** | No logic change — typos, renames, deleting dead code, config tweaks |
| **Small** | Logic change in 1-2 files, no new concepts — bug fixes, adding a field |
| **Medium** | 3+ files OR introduces a new concept but within existing patterns |
| **Large** | New feature spanning multiple layers, architectural changes, design decisions needed |

### Pipeline by Size
| Step | Trivial | Small | Medium | Large |
|------|---------|-------|--------|-------|
| Brainstorm | - | - | - | `superpowers:brainstorming` |
| Plan | - | - | `superpowers:writing-plans` | `superpowers:writing-plans` |
| Worktree | - | - | `superpowers:using-git-worktrees` | `superpowers:using-git-worktrees` |
| TDD | - | `superpowers:test-driven-development` | `superpowers:test-driven-development` | `superpowers:test-driven-development` |
| Verify | `npm run check && npm run test` | `npm run check && npm run test` | `superpowers:verification-before-completion` | `superpowers:verification-before-completion` |
| Review | - | `superpowers:requesting-code-review` | `superpowers:requesting-code-review` | `superpowers:requesting-code-review` |
| Simplify | - | - | `simplify` | `simplify` |
| Audit context | - | - | `gastos:audit-context` | `gastos:audit-context` |
| Revise CLAUDE.md | - | - | `claude-md-management:revise-claude-md` | `claude-md-management:revise-claude-md` |
| PR | `commit-commands:commit-push-pr` | `commit-commands:commit-push-pr` | `commit-commands:commit-push-pr` | `commit-commands:commit-push-pr` |
| Deploy | After merge | After merge | After merge | After merge |

### Enforcement
- **State tracker** at `/tmp/gastos-workflow-state.json` tracks completed steps
- **Block:** Commit/deploy blocked if `verify` step hasn't completed (tests must pass)
- **Warn:** Commit warns if `review`, `simplify`, or `revise-claude-md` steps are missing
- **No direct commits to main** — all changes go through PRs via `commit-commands:commit-push-pr`
- **Deploy after merge** — run `npm run deploy` (and webapp deploy if webapp/ changed) after PR is merged to main
- Never skip steps for the assessed size

### Specialist Subagents
Dispatch these BEFORE writing code that touches their domain. They research and advise so you make informed decisions.

| Agent | Trigger files | Trigger keywords |
|-------|--------------|-----------------|
| `cloudflare-specialist` | `wrangler.toml`, `src/db/*`, `migrations/*`, `src/queue.ts`, `src/index.ts`, `src/app.ts` | D1, R2, KV, queue, vectorize, binding, migration, deploy, cron |
| `telegram-specialist` | `src/telegram/*`, `src/routes/webhook.ts`, `src/onboarding.ts`, `webapp/*` | telegram, bot command, webhook, inline keyboard, mini app, sendMessage |
| `openai-specialist` | `src/ai/*`, `src/queue.ts`, `src/notifications.ts` | openai, agent, prompt, embedding, tool calling, transcription, model, token |

**Rules:**
- If a task touches files in the trigger column, dispatch the matching agent for research BEFORE implementing
- If multiple agents apply (e.g., queue.ts touches both Cloudflare and OpenAI), dispatch them in parallel
- Agents are advisory — they research and return findings, they don't write code
- Don't skip agents to save time — the research prevents mistakes that cost more time to fix

### Custom Skills
- `gastos:assess-task-size` — classify task and announce pipeline (every task)
- `gastos:d1-migration` — D1 migration checklist
- `gastos:new-db-module` — scaffold src/db/ module
- `gastos:audit-context` — audit all context files for stale info (end of medium/large tasks)
- `gastos:log-session` — log development session to devlog (end of every session)
- `gastos:rollback` — emergency deployment rollback
