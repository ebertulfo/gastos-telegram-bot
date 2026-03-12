---
name: gastos-audit-context
description: Audit all project context files for stale or incorrect information. Use at the end of medium/large tasks, when starting a new session, or when the user asks to check for stale context. Triggers on "audit context", "stale info", "check our context", "is our memory up to date", or "refresh context".
tools: Read, Glob, Grep, Bash, Edit
---

# Context Freshness Audit

Check all project context files against the actual codebase and flag anything stale.

## What to audit

Run all checks below. For each, report a table of findings: `[OK]` or `[STALE]` with what's wrong.

### 1. CLAUDE.md — Commands & Test Counts

Read `CLAUDE.md` and verify:
- `npm run test` — run the test suite and compare actual test/file count to what CLAUDE.md claims
- `npm run check` — verify the command exists in `package.json` scripts
- Any other commands listed — verify they exist

### 2. CLAUDE.md — Architecture Claims

Read `CLAUDE.md` Architecture section and cross-reference:
- Queue message types — grep `src/types.ts` for `ParseQueueMessage` and compare
- File references (e.g., "queue.ts is a router only") — read the actual file and check
- Code patterns — spot-check 2-3 claims against actual code

### 3. MEMORY.md — Stack & Models

Read `memory/MEMORY.md` and verify:
- Model names — grep `src/ai/` and `src/queue.ts` for actual model strings, compare to what MEMORY.md lists
- Framework versions — check `package.json` for major deps (zod, hono, @openai/agents)
- File map — verify each listed file exists and the description matches its actual exports

### 4. MEMORY.md — Backlog Freshness

Read `memory/backlog.md` and check:
- "In Progress" items — are any actually done? (check git log, file state)
- "Done" items — are any listed that shouldn't be?
- "Tech Debt" items — have any been silently fixed?

### 5. Agent Descriptions

Read each `.claude/agents/*.md` and verify:
- Trigger file paths — do they still exist? (`Glob` each pattern)
- Model/tool references — do they match actual code?
- "This Project's Setup" sections — are file descriptions current?

### 6. Skill Descriptions

Read each `.claude/skills/*/skill.md` and verify:
- Trigger keywords — do they still make sense for the current codebase?
- Step instructions — do referenced commands/files still exist?

## Output Format

After all checks, produce a summary:

```
## Context Audit Results

### CLAUDE.md
- [OK] Commands and test counts
- [STALE] Architecture: "queue.ts is a router only" — it now uses SDK run() directly

### MEMORY.md
- [OK] Stack and models
- [STALE] Backlog: "Lock CORS origin" is still listed but was fixed in commit abc123

### Agents
- [OK] cloudflare-specialist
- [STALE] openai-specialist: trigger file src/ai/intent.ts no longer exists

### Skills
- [OK] All skills current

## Fixes Applied
- Updated CLAUDE.md line 15: ...
- Updated MEMORY.md: ...
```

## Rules

- **Fix stale items immediately** — don't just report, update the files
- **Be conservative** — only flag something as stale if you're confident it's wrong
- **Don't rewrite content** — make minimal targeted edits to fix inaccuracies
- **Skip cosmetic issues** — focus on factual incorrectness, not style
- **Report even if everything is OK** — the user should see that the audit ran
