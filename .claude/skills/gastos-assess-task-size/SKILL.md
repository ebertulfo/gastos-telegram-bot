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
| 9. PR | `commit-commands:commit-push-pr` | `commit-commands:commit-push-pr` | `commit-commands:commit-push-pr` | `commit-commands:commit-push-pr` |
| 10. Deploy | After merge | After merge | After merge | After merge |

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
- Trivial: `["verify", "commit-pr"]`
- Small: `["tdd", "verify", "review", "commit-pr"]`
- Medium: `["plan", "worktree", "tdd", "verify", "review", "simplify", "revise-claude-md", "commit-pr"]`
- Large: `["brainstorm", "plan", "worktree", "tdd", "verify", "review", "simplify", "revise-claude-md", "commit-pr"]`

6. Wait for user confirmation before proceeding to the first pipeline step.

## Rules

- ALWAYS run this assessment before starting any work
- If the user says "this is [size]", accept their override
- If the user doesn't respond to the size announcement within their next message, proceed with your assessment
- Never skip pipeline steps for the assessed size
