# Workflow, Skills & Subagents Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish a structured, enforced development workflow using custom skills, specialist subagents with Context7 MCP, a state tracker, and Claude Code hooks.

**Architecture:** Custom skills define workflows (task size assessment, D1 migrations, DB module scaffolding, rollback). Three specialist subagents (cloudflare, telegram, openai) provide domain expertise with persistent memory and Context7 MCP for fresh docs. A state tracker JSON file tracks pipeline progress, and hooks enforce gates (block commit without tests, warn on missing review/simplify/CLAUDE.md revision).

**Tech Stack:** Claude Code skills (SKILL.md), Claude Code subagents (.claude/agents/*.md), Claude Code hooks (shell scripts + settings.json), Context7 MCP (@upstash/context7-mcp), bash/jq for hook scripts.

---

### Task 1: Set Up Context7 MCP Server

**Files:**
- Modify: `~/.claude.json` (via CLI)

**Step 1: Install Context7 MCP server**

Run:
```bash
claude mcp add --transport stdio context7 -- npx -y @upstash/context7-mcp
```

**Step 2: Verify MCP server is registered**

Run: `claude mcp list`
Expected: `context7` appears in the list with stdio transport.

**Step 3: Restart Claude Code session**

Run: Exit and restart `claude` to pick up the new MCP server.

**Step 4: Test Context7 is working**

In Claude Code, ask: "Use Context7 to look up Cloudflare Workers D1 API docs"
Expected: Context7 returns documentation chunks.

---

### Task 2: Create State Tracker Script

**Files:**
- Create: `scripts/workflow-state.sh`

**Step 1: Create the scripts directory**

Run: `ls scripts/ 2>/dev/null || mkdir scripts`

**Step 2: Write the state tracker script**

Create `scripts/workflow-state.sh`:

```bash
#!/bin/bash
set -euo pipefail

STATE_FILE="/tmp/gastos-workflow-state.json"
ACTION="${1:-}"

case "$ACTION" in
  init)
    # Usage: workflow-state.sh init "task description" "size" '["step1","step2"]'
    TASK="${2:-}"
    SIZE="${3:-}"
    REQUIRED="${4:-[]}"
    jq -n \
      --arg task "$TASK" \
      --arg size "$SIZE" \
      --argjson required "$REQUIRED" \
      --arg started "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      '{task: $task, size: $size, required: $required, completed: [], previous_deploy_version: null, started_at: $started}' \
      > "$STATE_FILE"
    echo "State initialized for: $TASK ($SIZE)"
    ;;
  complete)
    # Usage: workflow-state.sh complete "step-name"
    STEP="${2:-}"
    if [ ! -f "$STATE_FILE" ]; then
      echo "No active workflow state" >&2
      exit 0
    fi
    jq --arg step "$STEP" '.completed += [$step] | .completed |= unique' "$STATE_FILE" > "${STATE_FILE}.tmp"
    mv "${STATE_FILE}.tmp" "$STATE_FILE"
    echo "Completed: $STEP"
    ;;
  check)
    # Usage: workflow-state.sh check "step-name"
    # Exit 0 if step is completed or no state file, exit 1 if not completed
    STEP="${2:-}"
    if [ ! -f "$STATE_FILE" ]; then
      exit 0  # No state = no enforcement
    fi
    if jq -e --arg step "$STEP" '.completed | index($step)' "$STATE_FILE" > /dev/null 2>&1; then
      exit 0
    fi
    # Check if step is required
    if jq -e --arg step "$STEP" '.required | index($step)' "$STATE_FILE" > /dev/null 2>&1; then
      echo "$STEP has not been completed yet" >&2
      exit 1
    fi
    exit 0  # Step not required, so OK
    ;;
  check-any)
    # Usage: workflow-state.sh check-any "step1" "step2" ...
    # Exit 0 if ANY of the steps are completed or not required, exit 1 if all are required but incomplete
    shift
    if [ ! -f "$STATE_FILE" ]; then
      exit 0
    fi
    MISSING=""
    for STEP in "$@"; do
      if jq -e --arg step "$STEP" '.required | index($step)' "$STATE_FILE" > /dev/null 2>&1; then
        if ! jq -e --arg step "$STEP" '.completed | index($step)' "$STATE_FILE" > /dev/null 2>&1; then
          MISSING="${MISSING}${STEP}, "
        fi
      fi
    done
    if [ -n "$MISSING" ]; then
      echo "Missing steps: ${MISSING%, }" >&2
      exit 1
    fi
    exit 0
    ;;
  status)
    # Usage: workflow-state.sh status
    if [ ! -f "$STATE_FILE" ]; then
      echo "No active workflow state"
      exit 0
    fi
    cat "$STATE_FILE" | jq .
    ;;
  set-deploy-version)
    # Usage: workflow-state.sh set-deploy-version "version-id"
    VERSION="${2:-}"
    if [ ! -f "$STATE_FILE" ]; then
      exit 0
    fi
    jq --arg v "$VERSION" '.previous_deploy_version = $v' "$STATE_FILE" > "${STATE_FILE}.tmp"
    mv "${STATE_FILE}.tmp" "$STATE_FILE"
    ;;
  clear)
    rm -f "$STATE_FILE"
    echo "Workflow state cleared"
    ;;
  *)
    echo "Usage: workflow-state.sh {init|complete|check|check-any|status|set-deploy-version|clear}" >&2
    exit 1
    ;;
esac
```

**Step 3: Make it executable**

Run: `chmod +x scripts/workflow-state.sh`

**Step 4: Test the state tracker**

Run:
```bash
./scripts/workflow-state.sh init "Test task" "small" '["tdd","verify","review","commit"]'
./scripts/workflow-state.sh status
./scripts/workflow-state.sh complete "tdd"
./scripts/workflow-state.sh check "tdd" && echo "PASS: tdd completed"
./scripts/workflow-state.sh check "verify" || echo "PASS: verify not yet completed"
./scripts/workflow-state.sh clear
```

Expected: Each command outputs correctly, check returns appropriate exit codes.

**Step 5: Commit**

```bash
git add scripts/workflow-state.sh
git commit -m "feat: add workflow state tracker script for pipeline enforcement"
```

---

### Task 3: Create Hook Scripts

**Files:**
- Create: `scripts/hooks/pre-commit-gate.sh`
- Create: `scripts/hooks/pre-deploy-gate.sh`
- Create: `scripts/hooks/pre-commit-warn.sh`
- Create: `scripts/hooks/post-tool-track.sh`

**Step 1: Create hooks directory**

Run: `mkdir -p scripts/hooks`

**Step 2: Write the pre-commit blocking hook**

Create `scripts/hooks/pre-commit-gate.sh`:

```bash
#!/bin/bash
set -euo pipefail

# Block commit if verify step hasn't been completed
STATE_FILE="/tmp/gastos-workflow-state.json"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$STATE_FILE" ]; then
  exit 0  # No state = no enforcement
fi

if ! "$SCRIPT_DIR/workflow-state.sh" check "verify" 2>/dev/null; then
  echo '{"decision": "block", "reason": "Tests have not passed yet. Run npm run check && npm run test before committing."}' >&2
  exit 2
fi

exit 0
```

**Step 3: Write the pre-deploy blocking hook**

Create `scripts/hooks/pre-deploy-gate.sh`:

```bash
#!/bin/bash
set -euo pipefail

STATE_FILE="/tmp/gastos-workflow-state.json"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$STATE_FILE" ]; then
  exit 0
fi

if ! "$SCRIPT_DIR/workflow-state.sh" check "verify" 2>/dev/null; then
  echo '{"decision": "block", "reason": "Tests have not passed yet. Run npm run check && npm run test before deploying."}' >&2
  exit 2
fi

exit 0
```

**Step 4: Write the pre-commit warning hook**

Create `scripts/hooks/pre-commit-warn.sh`:

```bash
#!/bin/bash
set -euo pipefail

STATE_FILE="/tmp/gastos-workflow-state.json"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$STATE_FILE" ]; then
  exit 0
fi

WARNINGS=""

if ! "$SCRIPT_DIR/workflow-state.sh" check "review" 2>/dev/null; then
  WARNINGS="${WARNINGS}Code review has not been run. "
fi

if ! "$SCRIPT_DIR/workflow-state.sh" check "simplify" 2>/dev/null; then
  WARNINGS="${WARNINGS}Simplify pass has not been run. "
fi

if ! "$SCRIPT_DIR/workflow-state.sh" check "revise-claude-md" 2>/dev/null; then
  WARNINGS="${WARNINGS}CLAUDE.md has not been revised. "
fi

if [ -n "$WARNINGS" ]; then
  echo "{\"decision\": \"allow\", \"reason\": \"WARNING: ${WARNINGS}Proceeding anyway.\"}"
  exit 0
fi

exit 0
```

**Step 5: Write the post-tool tracking hook**

Create `scripts/hooks/post-tool-track.sh`:

```bash
#!/bin/bash
set -euo pipefail

# Read hook input from stdin
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
STATE_FILE="/tmp/gastos-workflow-state.json"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$STATE_FILE" ]; then
  exit 0
fi

# Map tool/skill invocations to pipeline step names
case "$TOOL_NAME" in
  *test-driven-development*) "$SCRIPT_DIR/workflow-state.sh" complete "tdd" ;;
  *verification-before-completion*) "$SCRIPT_DIR/workflow-state.sh" complete "verify" ;;
  *requesting-code-review*) "$SCRIPT_DIR/workflow-state.sh" complete "review" ;;
  *simplify*) "$SCRIPT_DIR/workflow-state.sh" complete "simplify" ;;
  *revise-claude-md*) "$SCRIPT_DIR/workflow-state.sh" complete "revise-claude-md" ;;
  *writing-plans*) "$SCRIPT_DIR/workflow-state.sh" complete "plan" ;;
  *using-git-worktrees*) "$SCRIPT_DIR/workflow-state.sh" complete "worktree" ;;
  *brainstorming*) "$SCRIPT_DIR/workflow-state.sh" complete "brainstorm" ;;
esac

exit 0
```

**Step 6: Make all hooks executable**

Run: `chmod +x scripts/hooks/*.sh`

**Step 7: Test the hooks**

Run:
```bash
# Set up a test state
./scripts/workflow-state.sh init "Test" "medium" '["verify","review","simplify","revise-claude-md","commit"]'

# Test blocking hook (should exit 2)
bash scripts/hooks/pre-commit-gate.sh < /dev/null; echo "Exit: $?"

# Complete verify step
./scripts/workflow-state.sh complete "verify"

# Test blocking hook again (should exit 0)
bash scripts/hooks/pre-commit-gate.sh < /dev/null; echo "Exit: $?"

# Test warning hook (should warn about missing review, simplify, revise-claude-md)
bash scripts/hooks/pre-commit-warn.sh < /dev/null

# Clean up
./scripts/workflow-state.sh clear
```

**Step 8: Commit**

```bash
git add scripts/hooks/
git commit -m "feat: add Claude Code hook scripts for workflow gate enforcement"
```

---

### Task 4: Configure Hooks in Settings

**Files:**
- Modify: `/Users/edrianbertulfo/Dev/gastos-telegram-bot/.claude/settings.local.json`

**Step 1: Read current settings**

Read `.claude/settings.local.json` to see current state.

**Step 2: Add hook configuration**

Update `.claude/settings.local.json` to include hooks alongside existing permissions:

```json
{
  "permissions": {
    "allow": [
      "Bash(npm run:*)",
      "Skill(claude-md-management:revise-claude-md)",
      "WebFetch(domain:openai.github.io)",
      "WebFetch(domain:www.npmjs.com)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Skill",
        "hooks": [
          {
            "type": "command",
            "command": "bash scripts/hooks/pre-commit-gate.sh",
            "timeout": 10
          },
          {
            "type": "command",
            "command": "bash scripts/hooks/pre-commit-warn.sh",
            "timeout": 10
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash scripts/hooks/pre-deploy-gate.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Skill",
        "hooks": [
          {
            "type": "command",
            "command": "bash scripts/hooks/post-tool-track.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

**Note:** The exact matchers may need refinement after testing. The Skill matcher will fire on all Skill tool calls; the hook scripts themselves determine whether to act based on the tool name in stdin JSON.

**Step 3: Commit**

```bash
git add .claude/settings.local.json
git commit -m "feat: configure Claude Code hooks for workflow enforcement"
```

---

### Task 5: Create `gastos:assess-task-size` Skill

**Files:**
- Create: `.claude/skills/gastos-assess-task-size/SKILL.md`

**Step 1: Create skill directory**

Run: `mkdir -p .claude/skills/gastos-assess-task-size`

**Step 2: Write the skill**

Create `.claude/skills/gastos-assess-task-size/SKILL.md`:

```markdown
---
name: gastos-assess-task-size
description: Assess task size and announce the development pipeline. Use at the start of EVERY task, feature request, bug fix, or code change. Must run before any implementation work begins. Triggers on any user request that involves changing code, fixing bugs, adding features, or modifying configuration.
tools: Read, Glob, Grep
---

# Task Size Assessment

Assess the task size and announce the pipeline before starting any work.

## Size Heuristics

| Size | Heuristic |
|------|-----------|
| **Trivial** | No logic change — typos, renames, deleting dead code, config tweaks |
| **Small** | Logic change in 1-2 files, no new concepts — bug fixes, adding a field |
| **Medium** | 3+ files OR introduces a new concept (new route, new db module) but within existing patterns |
| **Large** | New feature spanning multiple layers, architectural changes, new integrations, design decisions needed |

## Pipeline by Size

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
| 10. Deploy | - | - | Prompt user | Prompt user |

## Process

1. Read the user's request carefully
2. If needed, quickly scan relevant files to understand scope (use Read/Glob/Grep)
3. Classify the task size using the heuristics above
4. Announce your assessment in this format:

```
This looks **[size]** — [1-sentence reasoning]. Pipeline:

[list only the applicable steps for this size]

Say otherwise if you disagree.
```

5. Initialize the workflow state tracker:

```bash
./scripts/workflow-state.sh init "[task description]" "[size]" '[required steps as JSON array]'
```

Required steps arrays by size:
- Trivial: `["verify", "commit"]`
- Small: `["tdd", "verify", "review", "commit"]`
- Medium: `["plan", "worktree", "tdd", "verify", "review", "simplify", "revise-claude-md", "commit-pr"]`
- Large: `["brainstorm", "plan", "worktree", "tdd", "verify", "review", "simplify", "revise-claude-md", "commit-pr"]`

6. Wait for user confirmation before proceeding to the first pipeline step.

## Rules

- ALWAYS run this assessment before starting any work
- If the user says "this is [size]", accept their override
- If the user doesn't respond to the size announcement within their next message, proceed with your assessment
- Never skip pipeline steps for the assessed size
```

**Step 3: Commit**

```bash
git add .claude/skills/gastos-assess-task-size/
git commit -m "feat: add gastos:assess-task-size skill for workflow pipeline"
```

---

### Task 6: Create `gastos:d1-migration` Skill

**Files:**
- Create: `.claude/skills/gastos-d1-migration/SKILL.md`

**Step 1: Create skill directory**

Run: `mkdir -p .claude/skills/gastos-d1-migration`

**Step 2: Write the skill**

Create `.claude/skills/gastos-d1-migration/SKILL.md`:

```markdown
---
name: gastos-d1-migration
description: Create and apply D1 database migrations. Use when adding tables, columns, indexes, or modifying the database schema. Triggers on mentions of migrations, schema changes, new tables, new columns, ALTER TABLE, or database changes.
tools: Read, Glob, Grep, Bash, Write, Edit
---

# D1 Migration Checklist

Follow this checklist when creating a new D1 migration.

## Step 1: Determine the next migration number

Run:
```bash
ls migrations/ | sort -n | tail -1
```

The next migration should be the next sequential number (e.g., if last is `0005_`, next is `0006_`).

## Step 2: Create the migration file

File naming convention: `migrations/NNNN_description.sql`

Examples:
- `migrations/0006_add_categories_table.sql`
- `migrations/0007_add_index_on_expenses_date.sql`

Write the SQL migration. Use `IF NOT EXISTS` for CREATE TABLE. Include comments explaining the change.

## Step 3: Update `src/types.ts` if needed

If the migration adds new bindings or changes the Env type, update `src/types.ts`.

## Step 4: Update or create `src/db/*.ts` module if needed

If the migration adds a new table, create a corresponding db module following project conventions:
- Function takes `D1Database` directly (not `Env`)
- Inject `user_id` from auth context
- Use `z.infer<typeof Schema>` for return types

## Step 5: Apply the migration locally

Run:
```bash
npx wrangler d1 migrations apply gastos-db --local
```

## Step 6: Run tests to verify

Run: `npm run check && npm run test`

## Step 7: Apply to remote (production)

Only after tests pass and the change is committed:
```bash
npx wrangler d1 migrations apply gastos-db --remote
```

## Rules

- Never modify existing migration files — always create new ones
- Always use `IF NOT EXISTS` for safety
- Keep migrations small and focused — one concern per file
```

**Step 3: Commit**

```bash
git add .claude/skills/gastos-d1-migration/
git commit -m "feat: add gastos:d1-migration skill for database migration workflow"
```

---

### Task 7: Create `gastos:new-db-module` Skill

**Files:**
- Create: `.claude/skills/gastos-new-db-module/SKILL.md`

**Step 1: Create skill directory**

Run: `mkdir -p .claude/skills/gastos-new-db-module`

**Step 2: Write the skill**

Create `.claude/skills/gastos-new-db-module/SKILL.md`:

```markdown
---
name: gastos-new-db-module
description: Scaffold a new src/db/ module following project conventions. Use when creating a new database query module for a new table or domain entity.
tools: Read, Glob, Grep, Write, Edit
---

# New DB Module Scaffold

Follow this pattern when creating a new `src/db/*.ts` module.

## Step 1: Check existing modules for reference

Run: `ls src/db/` to see current modules. Read one (e.g., `src/db/expenses.ts`) to confirm the current pattern.

## Step 2: Create the new module

Follow these conventions:
- File goes in `src/db/` with a descriptive name (e.g., `src/db/categories.ts`)
- Functions take `D1Database` as first parameter (NOT `Env`)
- Always include `userId: number` parameter for user-scoped queries
- Use Zod schemas for validation and `z.infer<typeof Schema>` for return types
- Export all query functions

## Template

```typescript
import { z } from "zod";

const EntitySchema = z.object({
  id: z.number(),
  user_id: z.number(),
  // ... fields matching the table columns
  created_at: z.string(),
});

type Entity = z.infer<typeof EntitySchema>;

export async function getEntities(
  db: D1Database,
  userId: number
): Promise<Entity[]> {
  const result = await db
    .prepare("SELECT * FROM entities WHERE user_id = ?")
    .bind(userId)
    .all();
  return result.results as Entity[];
}

export async function createEntity(
  db: D1Database,
  userId: number,
  data: Omit<Entity, "id" | "user_id" | "created_at">
): Promise<Entity> {
  // ... implementation
}
```

## Step 3: Update CLAUDE.md if needed

Add the new module to the `db/` functions list in CLAUDE.md's Code Patterns section.

## Rules

- Never accept userId from user/LLM input — always from auth context
- Use `response_format: { type: "json_object" }` if the module involves OpenAI calls
- Keep queries simple — one function per operation
```

**Step 3: Commit**

```bash
git add .claude/skills/gastos-new-db-module/
git commit -m "feat: add gastos:new-db-module skill for db module scaffolding"
```

---

### Task 8: Create `gastos:rollback` Skill

**Files:**
- Create: `.claude/skills/gastos-rollback/SKILL.md`

**Step 1: Create skill directory**

Run: `mkdir -p .claude/skills/gastos-rollback`

**Step 2: Write the skill**

Create `.claude/skills/gastos-rollback/SKILL.md`:

```markdown
---
name: gastos-rollback
description: Roll back a Cloudflare Workers deployment. Use when production is broken, deployment caused issues, need to revert, or user says something like "roll back", "revert deploy", or "shit's broken".
tools: Bash
disable-model-invocation: true
---

# Deployment Rollback

Emergency rollback procedure for Cloudflare Workers deployments.

## Step 1: Show recent deployments

Run:
```bash
npx wrangler deployments list
```

Show the user the list and identify the current vs. previous deployment.

## Step 2: Confirm rollback target

Ask the user which version to roll back to. Default to the immediately previous version if they don't specify.

## Step 3: Execute rollback

Run:
```bash
npx wrangler rollback <version-id> -m "<reason>" -y
```

Where:
- `<version-id>` is the deployment version ID from step 1
- `<reason>` is a brief description of why (e.g., "broken expense logging after deploy")

## Step 4: Verify rollback

Run:
```bash
npx wrangler deployments status
```

Confirm the active deployment is now the rolled-back version.

## Step 5: Report

Tell the user:
- Which version is now active
- What the rolled-back version was
- Suggest investigating the issue before redeploying
```

**Step 3: Commit**

```bash
git add .claude/skills/gastos-rollback/
git commit -m "feat: add gastos:rollback skill for emergency deployment rollback"
```

---

### Task 9: Create `cloudflare-specialist` Subagent

**Files:**
- Create: `.claude/agents/cloudflare-specialist.md`

**Step 1: Create agents directory**

Run: `mkdir -p .claude/agents`

**Step 2: Write the subagent definition**

Create `.claude/agents/cloudflare-specialist.md`:

```markdown
---
name: cloudflare-specialist
description: |
  Cloudflare Workers, D1, R2, KV, Queues, and Vectorize specialist. Use when working with Cloudflare infrastructure, wrangler configuration, bindings, worker APIs, or Hono framework on Workers. Use proactively when the task involves any Cloudflare service.

  <example>
  Context: User needs to add a new D1 query with specific SQL patterns.
  user: "I need to add a full-text search query for expenses"
  assistant: "I'll use the cloudflare-specialist to research D1 full-text search capabilities."
  <commentary>D1-specific SQL features need specialist knowledge.</commentary>
  </example>

  <example>
  Context: User is debugging a Workers issue.
  user: "The queue consumer keeps timing out"
  assistant: "I'll delegate to the cloudflare-specialist to investigate queue consumer limits and configuration."
  <commentary>Queue behavior is CF-specific domain knowledge.</commentary>
  </example>
model: inherit
memory: project
tools:
  - Read
  - Grep
  - Glob
  - WebFetch
mcpServers:
  - context7
---

You are a Cloudflare Workers specialist with deep knowledge of Workers, D1, R2, KV, Queues, Vectorize, and the Hono framework running on Workers.

## Context Management

1. **Check your persistent memory first** before fetching any documentation
2. **Query Context7 only for the specific API or pattern you need** — never bulk-fetch
3. **After using documentation**, save key findings to your memory for next session

## This Project's Setup

Read `wrangler.toml` at the start of each session to understand the current bindings. Key bindings:
- DB (D1): gastos-db
- RATE_LIMITER (KV)
- INGEST_QUEUE (Queue): gastos-parse-queue
- MEDIA_BUCKET (R2): gastos-media
- VECTORIZE: gastos-vectors

## Your Role

- Research Cloudflare APIs and capabilities
- Advise on Workers patterns and best practices
- Debug Workers-specific issues (timeouts, limits, binding errors)
- Help with wrangler configuration
- Advise on D1 SQL patterns and limitations
- Help with R2 storage operations
- Advise on Queue consumer patterns

## What You Don't Do

- Don't make code changes (you're advisory)
- Don't run deployment commands
- Don't modify wrangler.toml directly
```

**Step 3: Commit**

```bash
git add .claude/agents/cloudflare-specialist.md
git commit -m "feat: add cloudflare-specialist subagent with Context7 MCP"
```

---

### Task 10: Create `telegram-specialist` Subagent

**Files:**
- Create: `.claude/agents/telegram-specialist.md`

**Step 1: Write the subagent definition**

Create `.claude/agents/telegram-specialist.md`:

```markdown
---
name: telegram-specialist
description: |
  Telegram Bot API, webhooks, and Mini Apps specialist. Use when working with Telegram message handling, bot commands, inline keyboards, media processing, webhook configuration, or the Telegram Mini App (webapp/).

  <example>
  Context: User needs to add a new bot command.
  user: "I want to add a /settings command to the bot"
  assistant: "I'll use the telegram-specialist to research the best approach for implementing bot commands."
  <commentary>Bot command registration and handling needs Telegram API knowledge.</commentary>
  </example>

  <example>
  Context: User is working on the Mini App.
  user: "The Mini App auth validation is failing"
  assistant: "I'll delegate to the telegram-specialist to debug the Telegram Mini App auth flow."
  <commentary>Mini App auth uses Telegram-specific HMAC validation.</commentary>
  </example>
model: inherit
memory: project
tools:
  - Read
  - Grep
  - Glob
  - WebFetch
mcpServers:
  - context7
---

You are a Telegram Bot API specialist with deep knowledge of the Bot API, webhooks, Mini Apps, and media handling.

## Context Management

1. **Check your persistent memory first** before fetching any documentation
2. **Query Context7 only for the specific API or pattern you need** — never bulk-fetch
3. **After using documentation**, save key findings to your memory for next session
4. **Fallback**: If Context7 doesn't have Telegram docs, use WebFetch on `https://core.telegram.org/bots/api`

## This Project's Setup

Read `src/telegram/` at the start of each session:
- `src/telegram/auth.ts` — Telegram auth validation
- `src/telegram/messages.ts` — Message sending helpers
- `src/telegram/media.ts` — Media download/upload

The Mini App lives in `webapp/` (React 19 + Vite + Tailwind + Radix UI).

## Your Role

- Research Telegram Bot API capabilities
- Advise on message formatting (MarkdownV2, HTML)
- Debug webhook and auth issues
- Help with Mini App integration (initData validation, theme params)
- Advise on media handling (photos, voice messages, documents)
- Help with inline keyboards and callback queries

## What You Don't Do

- Don't make code changes (you're advisory)
- Don't send messages to Telegram directly
- Don't modify bot settings via BotFather
```

**Step 2: Commit**

```bash
git add .claude/agents/telegram-specialist.md
git commit -m "feat: add telegram-specialist subagent with Context7 MCP"
```

---

### Task 11: Create `openai-specialist` Subagent

**Files:**
- Create: `.claude/agents/openai-specialist.md`

**Step 1: Write the subagent definition**

Create `.claude/agents/openai-specialist.md`:

```markdown
---
name: openai-specialist
description: |
  OpenAI APIs, Agents SDK, tool calling, embeddings, and vision specialist. Use when working with OpenAI API calls, the Agents SDK migration, prompt engineering, tool definitions, or embedding/vector operations.

  <example>
  Context: User is working on the Agents SDK migration.
  user: "How do I define tools in the OpenAI Agents SDK?"
  assistant: "I'll use the openai-specialist to research Agents SDK tool definitions."
  <commentary>Agents SDK has specific patterns for tool definition.</commentary>
  </example>

  <example>
  Context: User is debugging extraction prompts.
  user: "The expense extraction is returning bad JSON"
  assistant: "I'll delegate to the openai-specialist to review the extraction prompt and response_format usage."
  <commentary>OpenAI JSON mode and prompt engineering needs specialist knowledge.</commentary>
  </example>
model: inherit
memory: project
tools:
  - Read
  - Grep
  - Glob
  - WebFetch
mcpServers:
  - context7
---

You are an OpenAI API specialist with deep knowledge of Chat Completions, Responses API, Agents SDK, tool calling, vision, Whisper, and embeddings.

## Context Management

1. **Check your persistent memory first** before fetching any documentation
2. **Query Context7 only for the specific API or pattern you need** — never bulk-fetch
3. **After using documentation**, save key findings to your memory for next session

## This Project's Setup

Read these files at the start of each session:
- `src/ai/openai.ts` — OpenAI API calls (text/vision/transcription/embeddings)
- `src/ai/agent.ts` — Intent classification and semantic chat
- `src/ai/tools.ts` — Tool definitions (get_financial_report)

Current models used:
- gpt-4o-mini: intent classification, expense extraction, vision
- gpt-4o: semantic chat
- whisper-1: voice transcription
- text-embedding-3-small: embeddings for Vectorize

## Your Role

- Research OpenAI API capabilities and best practices
- Advise on prompt engineering for extraction and classification
- Help with Agents SDK migration (see memory/agents-sdk-migration.md)
- Debug API call issues (JSON mode, tool calling, vision)
- Advise on embedding strategies and vector search
- Help with token usage optimization

## What You Don't Do

- Don't make code changes (you're advisory)
- Don't make API calls directly
- Don't modify API keys or secrets
```

**Step 2: Commit**

```bash
git add .claude/agents/openai-specialist.md
git commit -m "feat: add openai-specialist subagent with Context7 MCP"
```

---

### Task 12: Update CLAUDE.md Workflow Section

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Read current CLAUDE.md**

Read `CLAUDE.md` to see the current Workflow section.

**Step 2: Replace the Workflow section**

Replace the existing `## Workflow` section with:

```markdown
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
```

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with full workflow pipeline and enforcement rules"
```

---

### Task 13: Run Skill-Creator Evals for `gastos:assess-task-size`

**Files:**
- Modify: `.claude/skills/gastos-assess-task-size/` (evals added by skill-creator)

**Step 1: Invoke skill-creator**

Use the `skill-creator` skill to create evals for `gastos:assess-task-size`.

**Step 2: Define eval test cases**

| Test prompt | Expected behavior |
|-------------|------------------|
| "Fix the typo in onboarding.ts" | Classifies as **trivial** |
| "Rename the variable in totals.ts" | Classifies as **trivial** |
| "The currency regex doesn't match EUR" | Classifies as **small** |
| "Add a created_at field to the users table" | Classifies as **small** |
| "Add a new API endpoint for expense categories" | Classifies as **medium** |
| "Create a new db module for user preferences" | Classifies as **medium** |
| "Migrate from OpenAI Chat Completions to Agents SDK" | Classifies as **large** |
| "Add a staging environment with preview deploys" | Classifies as **large** |
| "Delete the unused helper function" | Classifies as **trivial** |
| "Fix the bug where voice messages aren't transcribed" | Classifies as **small** |

**Step 3: Run evals and iterate**

Run the evals via skill-creator. If any fail, refine the skill's description or heuristics and re-run.

**Step 4: Optimize the skill description**

Use skill-creator's description optimization to ensure the skill triggers reliably.

**Step 5: Commit**

```bash
git add .claude/skills/gastos-assess-task-size/
git commit -m "feat: add evals for gastos:assess-task-size skill"
```

---

### Task 14: Final Verification

**Step 1: Verify all files are in place**

Run:
```bash
ls -la scripts/workflow-state.sh
ls -la scripts/hooks/
ls -la .claude/skills/
ls -la .claude/agents/
cat .claude/settings.local.json | jq .
```

**Step 2: End-to-end test**

Restart Claude Code session and test the full flow:
1. Ask for a trivial change — verify `gastos:assess-task-size` triggers and classifies correctly
2. Ask for a small change — verify TDD → Verify → Review pipeline is announced
3. Try to commit without running tests — verify the hook blocks it
4. Run tests, then commit — verify the hook allows it

**Step 3: Commit any final adjustments**

```bash
git add -A
git commit -m "chore: final adjustments to workflow configuration"
```
