# Workflow

## Operating Defaults (Codex-Aligned)

- Enter explicit plan mode for any non-trivial task (3+ meaningful steps, cross-layer changes, or architectural decisions).
- Stop and re-plan immediately if an implementation path fails or diverges from acceptance criteria.
- Use plan mode for verification work too, not only coding.
- Prefer the smallest high-confidence change set that satisfies acceptance criteria.

## 1. Intake

- Product Owner adds or updates work items in `/Users/edrianbertulfo/Dev/gastos-telegram-bot/docs/TASKS.md`.
- Agent selects one task slice that can be delivered end-to-end.
- Agent confirms acceptance criteria before implementation.

## 2. Plan

- Validate scope against `/Users/edrianbertulfo/Dev/gastos-telegram-bot/tprd.md`.
- Identify impacted layers: webhook worker, queue consumer, D1 schema/migrations, bot command handlers, tests, docs.
- Define test cases before coding.
- For non-trivial work, write a checkable implementation checklist in task notes before coding.

## 3. Implement

- Keep webhook path minimal and non-blocking.
- Persist first, acknowledge second, enqueue third.
- Keep parsing and AI work in queue consumer only.
- Use explicit UTC conversion and timezone boundary helpers.
- Keep data model aligned with TPRD tables.

## 4. Verify

- Run typecheck, lint, and tests.
- Verify idempotency behavior.
- Verify timezone boundary totals for day/week/month/year.
- Verify onboarding gate for totals commands.
- Diff expected behavior vs current behavior where relevant (tests, command output, logs).
- Do not mark work done until evidence is captured.

## 5. Document

- Update `/Users/edrianbertulfo/Dev/gastos-telegram-bot/docs/DECISIONS.md` for any architecture change.
- Update `/Users/edrianbertulfo/Dev/gastos-telegram-bot/docs/TASKS.md` status.
- If rules changed, update `/Users/edrianbertulfo/Dev/gastos-telegram-bot/docs/RULES.md`.
- After user corrections, capture reusable mistakes and prevention rules in `/Users/edrianbertulfo/Dev/gastos-telegram-bot/docs/LESSONS.md`.

## 6. Deliver

- Summarize what changed, why, and risk areas.
- List test evidence and any known gaps.
- Call out required follow-up tasks explicitly.

## PR Checklist

- Webhook ack happens only after raw persistence.
- No AI calls in webhook path.
- Queue flow handles text/photo/voice.
- Duplicate update handling is safe and deterministic.
- Totals are DB-only reads.
- Timezone boundary conversion is tested.
- Docs and task status updated.
