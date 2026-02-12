Gastos Telegram Bot v2 — Technical + Product Specification

Objective

Build a minimal, production-safe Telegram bot that:
	1.	Ingests expense inputs (text / photo / voice).
	2.	Persists raw data immediately and confirms receipt.
	3.	Extracts amount + currency asynchronously.
	4.	Returns fast calendar-based totals via commands.

Detailed review and corrections are handled exclusively on the Gastos web app.

⸻

1. System Architecture

Stack
	•	Language: TypeScript
	•	Runtime: Cloudflare Workers
	•	Async Jobs: Cloudflare Queues
	•	Database: Cloudflare D1 (SQL)
	•	Blob Storage: Cloudflare R2 (photos / voice)
	•	Telegram Integration: Webhook → Worker
	•	AI Processing: OpenAI API (text, audio transcription, vision)

⸻

2. Core Design Principles
	1.	UTC storage everywhere.
	2.	Calendar boundaries computed in user timezone.
	3.	One message = one expense.
	4.	Ack means raw persistence succeeded.
	5.	Totals must be instant (pure DB query).

Parsing must never block command execution.

⸻

3. User Onboarding (/start)

Minimal state machine stored in users.onboarding_step.

Flow
	1.	Welcome message (value prop + commands).
	2.	Ask for timezone using city-based input (preferred UX):
	•	User can type city/country (example: Manila, Singapore, Bangkok)
	•	Bot resolves city to IANA timezone and asks for confirmation
	•	Keep quick buttons for Asia/Singapore and Asia/Manila
	•	Fallback: user can type IANA timezone directly
	3.	Ask for primary currency (ISO 4217):
	•	Priority quick picks: PHP, SGD, USD, EUR
	•	Additional ASEAN quick picks:
	•	Brunei Darussalam: BND
	•	Cambodia: KHR
	•	Indonesia: IDR
	•	Laos: LAK
	•	Malaysia: MYR
	•	Myanmar: MMK
	•	Philippines: PHP
	•	Singapore: SGD
	•	Thailand: THB
	•	Vietnam: VND
	•	Other (user types ISO code)
	•	Timezone default suggestion:
	•	Bot may prefill timezone guess from selected currency (for example PHP → Asia/Manila, SGD → Asia/Singapore)
	•	User must confirm before onboarding completes
	4.	Confirm settings.

If onboarding incomplete:
	•	Commands reply: “Finish /start to enable totals.”

⸻

4. Ingestion Pipeline

Step 1: Telegram Webhook (Worker)
	1.	Receive update.
	2.	Ensure idempotency:
	•	Unique constraint on (telegram_chat_id, telegram_message_id).
	•	Also store file_unique_id for media.
	3.	Persist source_event.
	4.	Upload media (if any) to R2.
	5.	Reply: Saved ✅.
	6.	Enqueue parse job with source_event_id.

Step 2: Parse Worker (Queue Consumer)
	1.	Load source_event.
	2.	Normalize input:
	•	Text → parse
	•	Voice → transcribe → parse
	•	Photo → vision extraction
	3.	Extract:
	•	amount_minor
	•	currency
	4.	Write parse_result.
	5.	If amount + currency present → create expense row.
	6.	If extraction uncertain → mark status = needs_review.
	7.	If amount missing → DO NOT create expense row (web shows unprocessed item).

⸻

5. Totals Commands

Supported commands:
	•	/today
	•	/thisweek
	•	/thismonth
	•	/thisyear

Calendar Definitions (User Timezone)
	•	Day: 00:00 → 23:59
	•	Week: Monday 00:00 → Sunday 23:59
	•	Month: 1st 00:00 → end of month
	•	Year: Jan 1 00:00 → Dec 31 23:59

Query Strategy
	1.	Compute local boundary.
	2.	Convert to UTC.
	3.	Query expenses where:
	•	occurred_at_utc BETWEEN start AND end
	4.	Include both final and needs_review.

Response Format
	•	Total: SGD 1,234.56
	•	Count: (18 expenses)
	•	Needs review: 3 need confirmation
	•	Web deep link

⸻

6. Data Model (D1 Schema)

users
	•	id (pk)
	•	telegram_user_id (unique)
	•	telegram_chat_id
	•	timezone
	•	currency
	•	onboarding_step
	•	created_at_utc

source_events (immutable)
	•	id (pk)
	•	user_id (fk)
	•	telegram_chat_id
	•	telegram_message_id
	•	file_unique_id (nullable)
	•	message_type (text|photo|voice)
	•	text_raw (nullable)
	•	r2_object_key (nullable)
	•	received_at_utc
	•	created_at_utc

Unique index: (telegram_chat_id, telegram_message_id)

parse_results
	•	id (pk)
	•	source_event_id (fk)
	•	parser_version
	•	parsed_json
	•	confidence
	•	needs_review
	•	created_at_utc

expenses
	•	id (pk)
	•	user_id (fk)
	•	source_event_id (unique fk)
	•	amount_minor (integer)
	•	currency (ISO)
	•	occurred_at_utc
	•	status (final|needs_review)
	•	created_at_utc

corrections
	•	id (pk)
	•	expense_id (fk)
	•	field
	•	from_value
	•	to_value
	•	corrected_at_utc

⸻

7. Multimodal Strategy

Text
	•	Attempt lightweight parse first.
	•	Fallback to OpenAI extraction.

Voice
	•	OpenAI transcription → parse transcript.

Photo
	•	OpenAI vision extraction.
	•	Only extract total + currency.

All modalities normalize into a single extraction schema.

⸻

8. Failure Handling

Duplicate message

Reply: “Already saved ✅”.

Parse fails

No expense row created.
Web displays as “Unprocessed”.

Partial parse (amount uncertain)

Create expense with needs_review.
Included in totals.

⸻

9. Performance Guarantees
	•	Ingest path must respond < 500ms (no blocking AI calls).
	•	Totals commands must be pure DB reads.
	•	AI calls only occur in queue consumer.

⸻

10. Minimal Build Order
	1.	Implement webhook + idempotent persistence.
	2.	Implement D1 schema.
	3.	Implement queue + parse worker.
	4.	Implement /start flow.
	5.	Implement totals commands.
	6.	Implement web review queue.

⸻

This version prioritizes speed, determinism, and cost control while keeping the bot’s scope intentionally narrow.
