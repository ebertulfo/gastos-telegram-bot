# Engineering the Engineering Process

**Date:** 2026-03-08
**Commits:** 12 commits

## What Changed
- Designed a 4-tier task sizing system (trivial/small/medium/large) with scaled development pipelines for each size
- Built `scripts/workflow-state.sh` — a bash-based state tracker persisting to `/tmp/gastos-workflow-state.json` that tracks completed pipeline steps per task
- Created 4 Claude Code hook scripts for automated enforcement: `pre-commit-gate.sh` (blocks commit if verify not done), `pre-deploy-gate.sh` (blocks deploy if tests not passed), `pre-commit-warn.sh` (warns if review/simplify missing), `post-tool-track.sh` (tracks step completion)
- Built 4 custom Claude Code skills: `gastos:assess-task-size` (classify and announce pipeline), `gastos:d1-migration` (D1 migration checklist), `gastos:new-db-module` (scaffold db/ modules), `gastos:rollback` (emergency deployment rollback)
- Built 3 specialist subagents with Context7 MCP: `cloudflare-specialist` (Workers/D1/R2/KV/Queues/Vectorize), `telegram-specialist` (Bot API/webhook/Mini App), `openai-specialist` (API/Agents SDK/prompts)
- Updated CLAUDE.md with full workflow pipeline, enforcement rules, and skill/subagent documentation
- Full design doc (~230 lines) and implementation plan (~1,163 lines)

## Why
After several sessions of building features, I noticed a pattern: I'd forget steps, skip code review on "small" changes that weren't actually small, or deploy without running the full test suite. The workflow wasn't scaling with the project's complexity. Meanwhile, Claude Code's skills and hooks features had matured enough to automate the discipline I was failing to maintain manually.

The deeper motivation: I wanted to see what happens when you use AI tools to build the process that governs AI-assisted development. It's meta — using Claude Code to build skills and hooks that enforce how I use Claude Code. The hypothesis was that codifying workflow into executable artifacts (scripts, hooks, skills) would be more reliable than writing it in a README and hoping I follow it.

## Key Decisions
| Decision | Options Considered | Chosen | Why |
|----------|-------------------|--------|-----|
| Task sizing | Single pipeline for all tasks, 2 tiers (small/large), 4 tiers | 4 tiers (trivial/small/medium/large) | A typo fix shouldn't require the same ceremony as an architectural migration. 2 tiers felt too coarse — a 3-file bug fix is meaningfully different from a feature spanning multiple layers. 4 tiers map well to real work patterns. |
| Enforcement mechanism | README guidelines only, CI checks, Claude Code hooks | Claude Code hooks (block + warn) | Guidelines get ignored under pressure. CI checks only run on push. Hooks intercept at the moment of action — you literally cannot commit without passing verify. The warn hooks are softer (for review/simplify) because blocking would be too aggressive for non-critical steps. |
| Subagent architecture | Single monolithic agent with all domain knowledge, specialist subagents per domain | 3 specialist subagents (cloudflare, telegram, openai) | Separation of concerns. Each specialist gets a focused system prompt with Context7 MCP for live documentation lookups. A monolithic agent would have a massive prompt and conflate different API patterns. Specialists can be invoked in parallel for cross-cutting research. |
| State tracking | In-memory (ephemeral per conversation), file-based (/tmp), database | File-based in /tmp | State needs to persist across tool calls within a session but not across sessions (each task is independent). /tmp is the right scope — survives the conversation, dies on reboot. Database is overkill. In-memory doesn't survive across hook invocations. |
| Skill design | General-purpose skills, project-specific skills | Project-specific with codified domain knowledge | Skills like `gastos:d1-migration` encode project-specific patterns (migration numbering, binding registration, CLAUDE.md updates). Generic "create a migration" skills can't capture that institutional knowledge. The tradeoff is these skills aren't reusable across projects, but that's fine — the *pattern* of creating project-specific skills is what's reusable. |

## How (Workflow)
This was a meta-engineering session — the entire output is developer tooling for the developer (me). Started with the design doc to define the task sizing heuristics and pipeline matrix. The plan broke it into 14 tasks.

Built from the inside out: state tracker script first (everything depends on it), then hooks (enforce the state tracker), then skills (provide the repeatable workflows), then subagents (provide domain expertise). Each layer builds on the previous one.

The Context7 MCP integration for subagents was the most interesting technical piece. Each specialist can query live documentation for Cloudflare Workers, Telegram Bot API, or OpenAI APIs, which means they give answers grounded in current docs rather than training data that might be stale.

Testing was manual — invoked each skill, triggered each hook, verified the state file was being written correctly. These are developer tools, not production code, so the verification standard is different.

## Metrics
- 14 files created/changed, ~1,906 lines added
- 4 custom skills (`.claude/skills/`)
- 3 specialist subagents
- 4 hook scripts (`scripts/hooks/`)
- 1 state tracker script (`scripts/workflow-state.sh`, ~175 lines)
- 2 docs (design + plan, ~1,393 lines combined)
- 0 tests added (developer tooling, verified manually)

## Learnings
- **Hooks beat discipline every time.** I already knew this from pre-commit linters, but applying it to the AI-assisted development workflow was a lightbulb moment. The pre-commit gate has already caught me twice trying to commit without running the test suite.
- **4 task sizes feels right.** In practice, most changes are trivial or small. The medium/large pipelines only kick in a few times per week. But when they do, the forced design doc and code review steps have caught issues I would have shipped otherwise.
- **Specialist subagents are worth the setup cost.** Asking the cloudflare-specialist about D1 batch operations returns a more focused, docs-grounded answer than asking a general agent. The Context7 MCP integration is the key — without live docs, the specialists would just be filtered views of the same training data.
- **Skills encode institutional knowledge.** The `gastos:d1-migration` skill knows that migrations use 4-digit numbering, that bindings go in wrangler.toml, and that CLAUDE.md needs updating. That's not general knowledge — it's project-specific tribal knowledge that would otherwise live in my head or a forgotten wiki page.
- **Meta-engineering is underexplored.** Most developers configure their tools (linters, formatters, CI). Fewer design their development workflow as a system. With AI tools, the workflow itself becomes programmable — skills, hooks, subagents are all code. This feels like a new category of engineering work.

## Content Angles
- "Engineering the Engineering Process: Building a Self-Enforcing AI Development Workflow" — the full story of using Claude Code to build the system that governs how you use Claude Code
- "4 Task Sizes, 4 Pipelines: A Practical Framework for AI-Assisted Development" — the sizing heuristics and why one-size-fits-all workflows fail
- "Specialist Subagents vs. One Big Agent: When to Split" — separation of concerns applied to AI assistants, with Context7 MCP for live docs
- "Claude Code Skills as Institutional Knowledge" — encoding project-specific patterns into reusable, executable artifacts
