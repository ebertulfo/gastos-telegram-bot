# Fixing the Tools That Fix the Code

**Date:** 2026-03-12
**Commits:** 4 commits

## What Changed
- Fixed EditDrawer overflow issues and simplified TagInput UX (fewer states, cleaner interaction)
- Cleaned up TransactionRow (removed dead code from the redesign)
- Fixed 4 failing tests caused by the Agents SDK migration: stale model name in mock (`gpt-4o-mini` -> `gpt-5-mini`), missing `setDefaultModelProvider` and `OpenAIProvider` mocks
- Improved all 3 specialist subagents (cloudflare, telegram, openai) with explicit TRIGGER/DO NOT TRIGGER rules and file-path-based activation
- Created `gastos:audit-context` skill for detecting stale information across CLAUDE.md, MEMORY.md, and skill files
- Added historical plan documents for earlier sessions (bug fixes, Agents SDK migration) that were missing from the repo
- Set up gitleaks pre-commit hook after a `.dev.vars` secret leak scare the previous day

## Why
This was a cleanup session — the kind that doesn't produce features but keeps the project from slowly rotting. Three things forced it:

1. **Tests were broken.** The Agents SDK migration changed the model from `gpt-4o-mini` to `gpt-5-mini`, but the test mocks still referenced the old name. The tests also needed mocks for `setDefaultModelProvider` and `OpenAIProvider` that didn't exist. Four red tests meant I couldn't trust the suite as a regression guard.

2. **The specialist agents were misfiring.** Without explicit trigger rules, they'd activate on vaguely related topics or stay silent when they should have engaged. Adding file-path triggers ("activate when editing `src/queue.ts`") and keyword triggers made them predictable.

3. **Context files were drifting.** MEMORY.md still described the pre-migration architecture. CLAUDE.md had outdated model references. The skill files referenced patterns that no longer existed. Rather than fixing each one manually, I built a skill that audits all context files for staleness — so the next drift gets caught systematically.

## Key Decisions
| Decision | Options Considered | Chosen | Why |
|----------|-------------------|--------|-----|
| Secret leak prevention | Custom regex in pre-commit hook, gitleaks, git-secrets (AWS-focused) | gitleaks | Mature tool with 800+ leak patterns covering API keys, tokens, and credentials across dozens of services. Custom regex would miss edge cases. git-secrets is AWS-oriented. gitleaks is the industry standard for a reason. |
| Agent trigger rules | Vague descriptions ("use for Cloudflare questions"), keyword matching, file-path triggers | File-path triggers + keyword triggers combined | File paths are unambiguous — if someone edits `wrangler.toml`, the Cloudflare specialist should activate. Keywords catch conversational triggers ("how does D1 handle..."). Both together minimize false positives and false negatives. |
| Context staleness detection | Manual periodic review, pre-commit lint, dedicated audit skill | Dedicated skill (`gastos:audit-context`) | Staleness detection requires semantic understanding — "is this architecture description still accurate given the current code?" That's not something a regex linter can do. A skill invoked on-demand is the right abstraction. |
| Historical plan docs | Leave undocumented, retroactive plan docs, just reference in commit messages | Committed retroactive plan docs | The plan documents for bug fixes and the Agents SDK migration existed as working notes but were never committed. Having them in `docs/plans/` maintains a complete decision trail. Future-me (or a collaborator) can understand *why* those changes were made. |

## How (Workflow)
This was an opportunistic session — no single feature, just addressing accumulated friction. Started with the failing tests because they were blocking the verify step in the workflow pipeline. The test fixes were mechanical: update the mocked model name, add the missing provider mocks.

Then moved to the UI polish from the previous session's tag-date editing work. The EditDrawer had overflow issues on smaller screens (content pushed below the fold), and the TagInput had unnecessary intermediate states that made the interaction feel sluggish. Simplified both.

The agent and skill improvements came from observing the workflow over the past few sessions. The specialists were either too eager or too quiet, and there was no systematic way to check if context files had drifted. Built the trigger rules by listing the actual files and keywords each specialist should care about, then tested with sample prompts.

## Metrics
- 16 files changed, ~2,644 lines added, ~113 lines removed
- 4 test failures fixed (0 new tests — these were existing tests that broke)
- 3 specialist agents updated with trigger rules
- 1 new skill created (`gastos:audit-context`)
- 4 historical plan documents committed (~2,400 lines of design and implementation records)
- 1 pre-commit hook added (gitleaks)

## Learnings
- **Test mocks are a maintenance surface.** When you mock an external SDK, every breaking change in that SDK becomes a test fix. The Agents SDK migration changed model names and added new provider abstractions — the production code was updated but the mocks weren't. This is the hidden cost of mocking: you're maintaining a parallel reality that can drift from the actual one.
- **Agent trigger rules need to be as specific as function signatures.** "Use this agent for Cloudflare questions" is too vague. "Activate when the user edits `wrangler.toml`, `src/queue.ts`, or mentions D1/KV/R2/Queues" is actionable. The more precise the trigger, the fewer false activations.
- **Context drift is inevitable in AI-assisted workflows.** CLAUDE.md, MEMORY.md, agent descriptions, skill files — these are all context that the AI reads to understand the project. When the code changes but the context doesn't, the AI gives stale advice. Automating staleness detection is a hygiene practice, like linting.
- **Cleanup sessions are undervalued.** No new features shipped. No user-visible changes. But the test suite is green, the agents are more accurate, the context is current, and secrets can't leak. This is the kind of work that makes the next feature session faster.
- **The meta-work compounds.** Improving the agents that help write code, building skills that audit the context that guides the agents — it sounds circular but each layer of improvement makes the next session more productive. The workflow is becoming self-reinforcing.

## Content Angles
- "The Hidden Cost of Mocking: When Your Tests Drift From Reality" — how SDK migrations break test suites and what to do about it
- "Building Self-Improving AI Development Workflows" — trigger rules, context auditing, and the feedback loop of AI-assisted tooling
- "Why Cleanup Sessions Are the Most Important Sessions" — the case for dedicating time to developer experience and project hygiene
- "Preventing Secret Leaks in Side Projects: A gitleaks Setup Guide" — practical pre-commit hook setup for solo developers
