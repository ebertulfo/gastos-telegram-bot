# Decisions

Use this file as a lightweight ADR log.

## Template

- ID: `D-XXX`
- Date: `YYYY-MM-DD`
- Status: `proposed | accepted | superseded`
- Context: short problem statement
- Decision: what was chosen
- Consequences: expected tradeoffs and follow-ups

## D-001

- ID: `D-001`
- Date: `2026-02-11`
- Status: `accepted`
- Context: Ingest must be fast and safe under webhook latency constraints.
- Decision: Split ingestion into webhook persistence + queue-based parsing.
- Consequences: Requires queue infra and retry-safe consumer logic.

## D-002

- ID: `D-002`
- Date: `2026-02-11`
- Status: `accepted`
- Context: Totals must represent user calendar periods, but storage should be consistent.
- Decision: Store all timestamps in UTC and compute query boundaries in user timezone.
- Consequences: Requires reliable timezone utilities and boundary tests.

## D-003

- ID: `D-003`
- Date: `2026-02-11`
- Status: `accepted`
- Context: Telegram updates may be retried and duplicated.
- Decision: Enforce idempotency with unique `(telegram_chat_id, telegram_message_id)` in `source_events`.
- Consequences: Duplicate path must return success-like response without reprocessing side effects.

## D-004

- ID: `D-004`
- Date: `2026-02-12`
- Status: `accepted`
- Context: The project needs a fast worker-native baseline with tests and API contracts from day zero.
- Decision: Use Workers + Hono + grammY + raw SQL migrations first, with queue-first async parsing and OpenAPI endpoint scaffolding.
- Consequences: Initial velocity is higher and runtime stays lean; ORM choice remains open for a later phase.

## D-005

- ID: `D-005`
- Date: `2026-02-12`
- Status: `accepted`
- Context: Primary users are in ASEAN, so onboarding should minimize manual currency entry.
- Decision: Expand onboarding quick-pick currencies to all ASEAN ISO 4217 currencies.
- Consequences: Faster onboarding in target markets; non-ASEAN users still use `Other`.

## D-006

- ID: `D-006`
- Date: `2026-02-12`
- Status: `accepted`
- Context: Direct IANA timezone entry is error-prone and not user-friendly for most users.
- Decision: Use city-based timezone input with IANA resolution and confirmation; allow currency-based timezone suggestion as prefill.
- Consequences: Better onboarding UX with retained timezone correctness; requires city-to-timezone resolution logic and confirmation flow tests.

## D-007

- ID: `D-007`
- Date: `2026-02-12`
- Status: `accepted`
- Context: Current priority is to ship a working Telegram bot loop end-to-end before web app linkage.
- Decision: Defer totals web deep-link output and focus on bot-only command/injest/onboarding behavior.
- Consequences: Totals replies omit web link for now; add link contract later when web route is finalized.

## D-008

- ID: `D-008`
- Date: `2026-02-12`
- Status: `accepted`
- Context: `source_events.user_id` must reference internal `users.id`, not raw Telegram IDs, for relational integrity.
- Decision: Upsert user records during ingestion and persist `source_events.user_id` using internal user IDs.
- Consequences: Queue parsing and totals remain consistent across onboarding and ingestion flows.

## D-009

- ID: `D-009`
- Date: `2026-02-12`
- Status: `accepted`
- Context: Multimodal parsing must remain asynchronous and production-safe, even when AI credentials or media objects are unavailable.
- Decision: Queue parser uses OpenAI audio transcription for voice and OpenAI vision extraction for photo when `OPENAI_API_KEY` and media are present, otherwise marks parse result as unprocessed.
- Consequences: Bot remains resilient with explicit parse states; extraction quality improves automatically when AI is configured.
