---
name: gastos-log-session
description: Log this development session to the devlog. Use at the end of every session, or when the user says "log this session", "update devlog", or "what did we do today". Creates a structured entry for content creation (articles, portfolio, blog posts).
tools: Read, Bash, Glob, Grep, Write
---

# Log Development Session

Create a devlog entry capturing this session for future content creation.

## Step 1: Gather session context

- Run `git log --oneline --since="today"` to see today's commits (adjust date if session spans days)
- Read `memory/backlog.md` to see what moved
- Review conversation context for decisions, tradeoffs, and learnings

## Step 2: Create the entry

File: `docs/devlog/YYYY-MM-DD-slug.md` (e.g., `2026-03-12-agents-sdk-test-fixes.md`)

Use this template:

```markdown
# [Session Title — compelling, not generic]

**Date:** YYYY-MM-DD
**Duration:** ~Xh (estimate from session length)
**Commits:** N commits
**PRs:** #N (if any)

## What Changed

Bullet summary of concrete deliverables. Be specific — "added gitleaks pre-commit hook" not "improved security."

## Why

The motivation, constraints, and context behind the work. What problem were we solving? What triggered this session? Include user-reported issues, production incidents, or strategic goals.

## Key Decisions

| Decision | Options Considered | Chosen | Why |
|----------|-------------------|--------|-----|
| ... | ... | ... | ... |

## How (Workflow)

Describe the AI-assisted development workflow used:
- Which skills were invoked and what they contributed
- Which specialist agents were dispatched and what they found
- Pipeline steps followed (assess → plan → TDD → verify → review → commit)
- Any interesting tool usage or automation

## Metrics

- Tests: X passing (X files)
- Type check: clean / N errors
- Lines changed: +X / -Y
- New files: N
- Deployment: yes/no

## Learnings

What worked well, what didn't, what was surprising. Include:
- Technical insights (things you'd tell a peer)
- Process insights (workflow improvements)
- AI collaboration insights (what Claude did well/poorly)

## Content Angles

Potential article/post ideas this session could feed into:
- [angle 1]
- [angle 2]
```

## Step 3: Update the devlog index

If `docs/devlog/README.md` exists, add the new entry to the top of the list.
If it doesn't exist, create it with a reverse-chronological list of all entries.

## Rules

- **Be honest** — include failures and course-corrections, not just wins
- **Be specific** — concrete details are more interesting than vague summaries
- **Write for an audience** — imagine a senior engineer or hiring manager reading this
- **Include the AI angle** — the workflow itself is interesting content
- **Don't over-polish** — raw session notes are more authentic than marketing copy
