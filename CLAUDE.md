# Gastos Telegram Bot

## Commands
- `npm run test` — run full test suite (vitest, 7 files, 21 tests)
- `npm run check` — TypeScript type check only (tsc --noEmit)
- `npm run check && npm run test` — standard verification after any change
- `npm run dev` — local dev server (wrangler dev)
- `npm run deploy` — deploy to Cloudflare Workers

## Architecture
- Cloudflare Workers (Hono) + D1 + R2 + KV + Queues + Vectorize
- Webhook returns 200 immediately; all heavy AI work goes to INGEST_QUEUE
- Two queue message types: `"receipt"` (expense ingestion) and `"chat"` (semantic AI)
- `APP_ENV` is `"prod"` in wrangler.toml; use `"development"` locally via `.dev.vars`
- `queue.ts` is a router only — receipt logic lives in `handleReceiptMessage()`, chat routes to `runSemanticChat()`

## Code Patterns
- Hono middleware must be `async (c, next) => { await next(); }` — sync middleware returning `c.json()` causes a TS overload error
- `Env` type lives in `src/types.ts` — add new Cloudflare bindings/env vars there first
- All DB queries inject `user_id` from auth context — LLM tools must never accept userId from user input
- `response_format: { type: "json_object" }` used on all OpenAI extraction calls
- `db/` functions take `D1Database` directly (not `Env`) — current files: expenses, users, chat-history, quotas, source-events, parse-results
- Use `Extract<UnionType, { discriminator: "value" }>` to narrow ParseQueueMessage union for typed function args
- Use `z.infer<typeof Schema>` to type helper return values — avoids duplicating Zod schema shapes as manual types

## Testing
- Tests use `@cloudflare/vitest-pool-workers` — runs in a Miniflare Workers environment
- OpenAI, Vectorize, agent, and rate-limiter are mocked in tests — not integration tested
- Pure deletion/cleanup tasks don't need new tests; existing suite is sufficient as regression guard

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
| Revise CLAUDE.md | - | - | `claude-md-management:revise-claude-md` | `claude-md-management:revise-claude-md` |
| Commit/PR | `commit-commands:commit` | `commit-commands:commit` | `commit-commands:commit-push-pr` | `commit-commands:commit-push-pr` |
| Deploy | - | - | Prompt user | Prompt user |

### Enforcement
- **State tracker** at `/tmp/gastos-workflow-state.json` tracks completed steps
- **Block:** Commit/deploy blocked if `verify` step hasn't completed (tests must pass)
- **Warn:** Commit warns if `review`, `simplify`, or `revise-claude-md` steps are missing
- Never skip steps for the assessed size

### Specialist Subagents
- Use `cloudflare-specialist` for Workers/D1/R2/KV/Queues/Vectorize questions
- Use `telegram-specialist` for Bot API/webhook/Mini App questions
- Use `openai-specialist` for API/Agents SDK/prompt engineering questions
- Delegate proactively — don't wait to be asked

### Custom Skills
- `gastos:assess-task-size` — classify task and announce pipeline (every task)
- `gastos:d1-migration` — D1 migration checklist
- `gastos:new-db-module` — scaffold src/db/ module
- `gastos:rollback` — emergency deployment rollback
