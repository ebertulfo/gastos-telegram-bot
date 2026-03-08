# Workflow, Skills & Subagents Design

**Date:** 2026-03-08
**Status:** Approved

## Goal

Establish a structured, enforced development workflow using Claude Code skills, subagents, hooks, and a state tracker. The workflow scales by task size and integrates domain-specialist subagents with persistent memory.

---

## 1. Workflow Pipeline

Four task sizes, each with a defined skill sequence:

| Step | Trivial | Small | Medium | Large |
|------|---------|-------|--------|-------|
| 1. Brainstorm | - | - | - | `superpowers:brainstorming` |
| 2. Write plan | - | - | `superpowers:writing-plans` | `superpowers:writing-plans` |
| 3. Worktree | - | - | `superpowers:using-git-worktrees` | `superpowers:using-git-worktrees` |
| 4. TDD | - | `superpowers:test-driven-development` | `superpowers:test-driven-development` | `superpowers:test-driven-development` |
| 5. Verify | `npm run check && npm run test` | `npm run check && npm run test` | `superpowers:verification-before-completion` | `superpowers:verification-before-completion` |
| 6. Code review | - | `superpowers:requesting-code-review` | `superpowers:requesting-code-review` | `superpowers:requesting-code-review` |
| 7. Simplify | - | - | `simplify` | `simplify` |
| 8. Revise CLAUDE.md | - | - | `claude-md-management:revise-claude-md` | `claude-md-management:revise-claude-md` |
| 9. Commit/PR | `commit-commands:commit` | `commit-commands:commit` | `commit-commands:commit-push-pr` | `commit-commands:commit-push-pr` |
| 10. Deploy (optional) | - | - | Prompt user | Prompt user |

### Task Size Heuristics

| Size | Heuristic |
|------|-----------|
| **Trivial** | No logic change — typos, renames, deleting dead code, config tweaks |
| **Small** | Logic change in 1-2 files, no new concepts — bug fixes, adding a field |
| **Medium** | 3+ files OR introduces a new concept (new route, new db module) but within existing patterns |
| **Large** | New feature spanning multiple layers, architectural changes, new integrations, design decisions needed |

Claude assesses the size, announces it with reasoning and the corresponding pipeline steps, and waits for user confirmation. User can override at any time.

---

## 2. Custom Skills

### `gastos:assess-task-size`

Runs at the start of every task. Classifies as trivial/small/medium/large, announces the pipeline, waits for user confirmation.

**Eval examples (via skill-creator):**

| Test prompt | Expected size |
|-------------|--------------|
| "Fix the typo in onboarding.ts" | Trivial |
| "The currency regex doesn't match EUR" | Small |
| "Add a new API endpoint for expense categories" | Medium |
| "Migrate from OpenAI Chat Completions to Agents SDK" | Large |

### `gastos:d1-migration`

Checklist skill for D1 migrations:
- Generate migration SQL file with correct naming convention
- Update `src/types.ts` bindings if new tables/columns
- Run `wrangler d1 migrations apply`
- Update relevant db/ module

### `gastos:new-db-module`

Scaffolding skill for new `src/db/*.ts` modules:
- Create file following project conventions (takes `D1Database` directly, injects `user_id`)
- Export typed query functions
- Use `z.infer<typeof Schema>` pattern for return types

### `gastos:rollback`

Emergency rollback skill:
1. Run `wrangler deployments list` to show recent versions
2. User picks a version (or defaults to previous)
3. Run `wrangler rollback <version-id> -m "reason" -y`
4. Confirm with `wrangler deployments status`

All custom skills will be tested and refined using **skill-creator** (evals, description optimization, benchmarking).

---

## 3. State Tracker

A JSON file at `/tmp/gastos-workflow-state.json` tracks pipeline progress per task.

### Schema

```json
{
  "task": "Add API endpoint for expense categories",
  "size": "medium",
  "required": ["plan", "worktree", "tdd", "verify", "review", "simplify", "revise-claude-md", "commit-pr"],
  "completed": ["plan", "worktree", "tdd", "verify"],
  "previous_deploy_version": null,
  "started_at": "2026-03-08T10:00:00Z"
}
```

### Lifecycle

| Event | What happens |
|-------|-------------|
| `gastos:assess-task-size` runs | Creates the file with `size`, `required` steps, empty `completed` |
| Each pipeline skill completes | `PostToolUse` hook appends the step to `completed` |
| Deploy succeeds | Saves previous version ID for rollback |
| Commit succeeds | Deletes the file (clean slate) |
| New task starts | Overwrites any stale file |

### Edge Cases

- If the file doesn't exist (e.g., user commits outside the workflow), hooks **warn** rather than block — no false lockouts
- Trivial tasks create a tracker with only `["verify", "commit"]` as required steps

---

## 4. Hooks

Hooks enforce gates by reading the state tracker.

### Blocking Hooks

| Hook | Event | Check | Behavior |
|------|-------|-------|----------|
| Tests must pass before commit | `PreToolUse` on commit skills | `"verify"` in `completed` | **Block** |
| Tests must pass before deploy | `PreToolUse` on `npm run deploy` | `"verify"` in `completed` | **Block** |

### Warning Hooks

| Hook | Event | Check | Behavior |
|------|-------|-------|----------|
| Code review before PR | `PreToolUse` on PR skill | `"review"` in `completed` | **Warn** |
| Simplify before commit | `PreToolUse` on commit skills | `"simplify"` in `completed` | **Warn** |
| CLAUDE.md revised | `PreToolUse` on commit skills | `"revise-claude-md"` in `completed` | **Warn** |

### Tracking Hooks

| Hook | Event | Action |
|------|-------|--------|
| Track step completion | `PostToolUse` on each pipeline skill | Append step to `completed` in state tracker |
| Clear state | `PostToolUse` on successful commit | Delete state tracker file |

---

## 5. Specialist Subagents

Three domain-specialist subagents with Context7 MCP for documentation and persistent project memory.

### Context Management Strategy

1. **Memory-first** — check persistent memory before any doc fetch
2. **Targeted queries** — never bulk-fetch; query only the specific API needed
3. **Save after use** — write key findings to memory for next session
4. **`maxTurns` cap** — prevents runaway context consumption

### `cloudflare-specialist`

| Field | Value |
|-------|-------|
| **Description** | Cloudflare Workers, D1, R2, KV, Queues, Vectorize, Hono specialist |
| **Tools** | Read, Grep, Glob, WebFetch |
| **MCP** | Context7 |
| **Memory** | `project` |
| **Model** | `inherit` |

### `telegram-specialist`

| Field | Value |
|-------|-------|
| **Description** | Telegram Bot API, webhooks, Mini Apps specialist |
| **Tools** | Read, Grep, Glob, WebFetch |
| **MCP** | Context7 |
| **Memory** | `project` |
| **Model** | `inherit` |

### `openai-specialist`

| Field | Value |
|-------|-------|
| **Description** | OpenAI APIs, Agents SDK, tool calling, embeddings specialist |
| **Tools** | Read, Grep, Glob, WebFetch |
| **MCP** | Context7 |
| **Memory** | `project` |
| **Model** | `inherit` |

---

## 6. Deploy & Rollback

### Deploy Pipeline Step

| Task size | Deploy behavior |
|-----------|----------------|
| Trivial | No deploy — manual if needed |
| Small | No deploy — manual if needed |
| Medium | Prompt: "Ready to deploy? (y/n)" after commit |
| Large | Prompt: "Ready to deploy? (y/n)" after PR merge |

### Deploy Flow

1. `wrangler deployments list` — show current state
2. `npm run deploy` — deploy to Cloudflare Workers
3. `wrangler deployments status` — confirm deployment
4. Save previous version ID to state tracker

### Rollback Flow

Handled by `gastos:rollback` skill (see Section 2).

---

## 7. CLAUDE.md Changes

Replace the existing Workflow section with:

- Task size assessment instructions (run `gastos:assess-task-size` at start of every task)
- Pipeline by size (the table from Section 1)
- Rules: never skip steps for assessed size, user can override, hooks enforce gates
- Deploy step: optional for medium/large, blocked if verify hasn't passed

---

## 8. What We're NOT Building

- No custom orchestrator skill — CLAUDE.md + hooks is enough
- No hooks on brainstorm/plan/TDD invocation — these are soft steps guided by CLAUDE.md
- No staging environment — revisit during production readiness (see memory/production-readiness.md)
- No automated smoke tests post-deploy — can add later
- No new plugins — everything uses the 14 already-installed plugins
