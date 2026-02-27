# Rules

## Product and Behavior Rules

- `/Users/edrianbertulfo/Dev/gastos-telegram-bot/tprd.md` is the source of truth.
- One Telegram message equals one expense attempt (`source_event`).
- Telegram bot is ingestion and totals only. Detailed corrections happen in web app.
- If onboarding is incomplete, totals commands must respond with a finish-onboarding message.
- Onboarding currency quick-picks must include ASEAN ISO currencies:
  `BND`, `KHR`, `IDR`, `LAK`, `MYR`, `MMK`, `PHP`, `SGD`, `THB`, `VND`.
- Currency quick-pick order must prioritize: `PHP`, `SGD`, `USD`, `EUR` first.
- Timezone onboarding UX must prioritize city-based input and resolve to IANA.
- Timezone may be prefilled from currency as a suggestion, but user confirmation is required.

## Reliability Rules

- Webhook must persist raw event before sending `Saved ✅`.
- Duplicate events must return `Already saved ✅` with no duplicate inserts.
- AI failures must never crash ingest acknowledgement.
- If amount is missing, do not create an `expenses` row.
- If parse is partial/uncertain, create `expenses` with `needs_review`.

## Performance Rules

- Webhook path must avoid blocking operations and target `<500ms`.
- AI calls are forbidden in webhook request handling.
- Totals endpoints/commands must be pure DB reads.

## Time and Calendar Rules

- Persist all timestamps in UTC.
- Store user timezone as IANA zone.
- Compute calendar periods (`/today`, `/thisweek`, `/thismonth`, `/thisyear`) in user timezone.
- Convert local boundaries to UTC before querying `occurred_at_utc`.
- Week definition is Monday start, Sunday end.

## Data Integrity Rules

- Add unique index on `(telegram_chat_id, telegram_message_id)` in `source_events`.
- Keep `source_events` immutable.
- Keep parse output in `parse_results`, separate from final/candidate `expenses`.
- Maintain traceability from `expense -> source_event`.

## Delivery Rules

- All feature implementations, schema updates, and bug fixes must strictly adhere to the Spec-Driven Development process outlined in `docs/core/WORKFLOW.md`.
- No code generation can begin without an explicitly approved `docs/specs/[feature].md` document.
