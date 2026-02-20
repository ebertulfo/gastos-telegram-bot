---
name: codex-execution-discipline
description: Use this skill when handling non-trivial implementation, bug-fixing, or review tasks in this repo that need explicit planning, re-planning on failure, strong verification evidence, and lessons capture compatible with Codex workflows.
---

# Codex Execution Discipline

## Required Inputs

- Active scope and acceptance criteria from `docs/TASKS.md`
- Delivery workflow from `docs/WORKFLOW.md`
- Constraints from `docs/RULES.md`

## Execution Flow

1. Create a short, checkable plan before coding when the task is non-trivial.
2. Implement in small increments with minimal file touch.
3. If a step fails or assumptions break, stop and re-plan before adding more code.
4. Validate behavior with concrete evidence (tests/logs/repro) before marking done.
5. Record docs updates (`TASKS`, `DECISIONS`, `RULES`) whenever behavior/process changes.
6. After user correction, add a reusable lesson in `docs/LESSONS.md`.

## Codex-Compatible Adaptation Notes

- Replace "subagent" strategy with scoped execution passes (research pass, implementation pass, verification pass) to keep context clean.
- Use parallelization only when native tooling supports it; default to sequential high-signal execution.
- Do not over-engineer simple fixes; reserve design-elegance checks for non-trivial changes.

## Verification Standard

Use `.agents/skills/codex-execution-discipline/references/verification-checklist.md` before final delivery.
