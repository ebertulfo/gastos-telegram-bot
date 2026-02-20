# Tasks

Status legend: `todo | in-progress | blocked | done`

## Milestones

1. M1 - Webhook + idempotent raw persistence (`in-progress`)
- Cloudflare Worker webhook endpoint
- Persist `source_events` immediately
- Media upload to R2
- Ack/re-ack behavior (`Saved ✅` / `Already saved ✅`)
- Queue enqueue with `source_event_id`
- Tests: idempotency and ack semantics
- Scaffold baseline completed: `/health`, `/webhook/telegram`, `/openapi.json`, `/docs` routes.
- Scaffold baseline completed: idempotent `source_events` persistence helper.
- Scaffold baseline completed: Telegram media fetch + R2 upload with persisted `r2_object_key` update.
- Scaffold baseline completed: queue consumer skeleton with ack/retry behavior.
- Scaffold baseline completed: baseline tests for webhook idempotency, classification, queue ack/retry, and openapi contract.

2. M2 - D1 schema + migrations (`in-progress`)
- Create `users`, `source_events`, `parse_results`, `expenses`, `corrections`
- Add required keys and unique indexes
- Migration and rollback strategy
- Tests: schema integrity and constraints
- Scaffold baseline completed: `migrations/0001_init.sql` created from TPRD schema.

3. M3 - Queue parse worker (`in-progress`)
- Consumer for text/photo/voice normalization
- OpenAI transcription/vision/extraction in async path
- Parse result persistence
- Expense creation logic for `final` vs `needs_review`
- Tests: parse outcomes and failure handling
- Baseline implemented:
- Queue worker now loads `source_events` + user currency context
- Text parser extracts amount/currency and writes `parse_results`
- `expenses` rows are created for extracted amount+currency with status `final` or `needs_review`
- Voice parser now calls OpenAI transcription when media + API key are available, then extracts amount/currency from transcript
- Photo parser now calls OpenAI vision extraction when media + API key are available
- Photo/voice fall back to `unprocessed` when media or OpenAI key is unavailable
- Queue parser tests expanded for extraction and unprocessed outcomes

4. M4 - `/start` onboarding flow (`in-progress`)
- Minimal onboarding state machine via `users.onboarding_step`
- Timezone and currency selection/validation
- Timezone UX: city-based input -> IANA resolution -> user confirmation
- Timezone UX: currency-based timezone prefill suggestion with confirmation
- Command gating when onboarding incomplete
- Tests: onboarding transitions and gating behavior
- Baseline implemented:
- `/start` bootstraps onboarding to `awaiting_timezone`
- City and IANA timezone input supported
- Currency prompt prioritizes `PHP`, `SGD`, `USD`, `EUR`
- Currency-based timezone suggestion confirmation step implemented
- Totals commands gated when onboarding is incomplete
- Onboarding tests added and passing

5. M5 - Totals commands (`in-progress`)
- Implement `/today`, `/thisweek`, `/thismonth`, `/thisyear`
- Compute boundaries in user timezone then convert to UTC
- Include counts and needs-review totals
- Tests: timezone edge cases and period boundaries
- Baseline implemented:
- Totals command parsing for `/today`, `/thisweek`, `/thismonth`, `/thisyear`
- Timezone-aware period boundary conversion to UTC
- DB aggregate query includes `final` and `needs_review` statuses
- Totals response format includes total, count, needs review, and web placeholder
- Totals tests and completed-user command tests added and passing

6. M6 - Web review queue integration (`todo`)
- Expose unprocessed and needs-review items for web app
- Ensure source-event traceability and correction hooks
- Tests: web queue visibility and correction linkage

## Operating Backlog

- Adopt Codex-aligned execution discipline (plan/re-plan/verification/lessons loop) in docs + skills (`done`)
- Define Cloudflare environment contract (`todo`)
- Define parser versioning approach (`todo`)
- Add observability and error telemetry (`todo`)
- Add production runbook for retries/incidents (`todo`)
