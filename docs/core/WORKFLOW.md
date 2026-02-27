# Workflow

## 1. Intake

- Product Owner adds or updates work items in `/Users/edrianbertulfo/Dev/gastos-telegram-bot/docs/TASKS.md`.
- Agent selects one task slice that can be delivered end-to-end.
- Agent confirms acceptance criteria before implementation.

## 2. Spec-Driven Design (SDD)

- **Stop and Write Specs**: Before writing any code, duplicate `docs/core/SPEC_TEMPLATE.md` into `docs/specs/[feature-name].md`.
- **The Intent**: Document exactly what business value this feature provides and what is implicitly Out of Scope.
- **The Contract**: Explicitly map the end-to-end data flow (e.g. JSON payloads, Zod schemas, exact D1 column names). Do not guess; document the exact shape.
- **The Constraints**: Document edge cases. How will the system fail gracefully? (e.g. logging raw payloads on Zod failure, sending "Unrecognized format" to the user).
- **Approval Gate**: The Agent cannot proceed to Implementation until the Product Owner explicitly approves the Spec document.

## 3. Handling Changes & Bug Fixes (Living Documents)

- **Do Not Start From Scratch**: If modifying an existing feature or fixing a systemic bug, do not write a new Spec.
- **Update the Blueprint**: Open the original Spec in `docs/specs/[feature-name].md`. Update the "Intent", "Contract", or add a new "Constraint" that precisely addresses the bug/change.
- **Approval Gate**: The Product Owner must approve the modified Spec before the Agent patches the codebase. The Spec must always perfectly reflect the current state of the source code.

## 4. Implement

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

## 5. Document

- Update `/Users/edrianbertulfo/Dev/gastos-telegram-bot/docs/DECISIONS.md` for any architecture change.
- Update `/Users/edrianbertulfo/Dev/gastos-telegram-bot/docs/TASKS.md` status.
- If rules changed, update `/Users/edrianbertulfo/Dev/gastos-telegram-bot/docs/RULES.md`.

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
