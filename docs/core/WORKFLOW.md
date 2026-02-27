# Workflow

## 1. Intake

- Product Owner adds or updates work items in `/Users/edrianbertulfo/Dev/gastos-telegram-bot/docs/TASKS.md`.
- Agent selects one task slice that can be delivered end-to-end.
- Agent confirms acceptance criteria before implementation.

## 2. Plan (The Pre-Flight Checklist)

- Validate scope against `/Users/edrianbertulfo/Dev/gastos-telegram-bot/tprd.md`.
- Identify impacted layers: webhook worker, queue consumer, D1 schema/migrations, bot command handlers, tests, docs.
- **Data Contract Validation (Gap Analysis)**: Explicitly map the end-to-end data flow. What exact JSON does the external API (e.g. Telegram) send? What MIME types? Does it perfectly match the Zod schemas and D1 table columns? Do not guess; document the exact shape and identify edge cases.
- **Error Handling Design**: How will the system fail gracefully? (e.g. logging raw payloads on Zod failure, sending "Unrecognized format" to the user instead of silent crashes).
- Define test cases before coding.

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
