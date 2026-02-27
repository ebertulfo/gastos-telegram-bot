# Specification: M5 Totals Commands

## 1. Intent (The "What")
* **Goal**: To retroactively outline the architecture for the Telegram aggregation commands (`/today`, `/thisweek`, `/thismonth`, `/thisyear`), ensuring that users receive accurate totals based on their specific, previously-configured Timezone.
* **Problem**: Storing expenses natively in UTC means querying for a "day" requires shifting the DB boundaries to match the user's local timezone. A naive query (e.g. `date(occurred_at_utc) = date('now')`) would cause totals to reset at the wrong time of day.
* **UX Fix Scope**: There are no functional code changes required for this spec generation. The audit confirms `src/totals.ts` already calculates period boundaries correctly using native `Intl.DateTimeFormat` without requiring heavy external dependencies.

## 2. Architecture & Data Flow (The "How")
* **Input**: User sends exactly `/today`, `/thisweek`, `/thismonth`, or `/thisyear`.
* **Validation**:
    * If the user has not completed the M4 Onboarding (missing currency or timezone), the bot rejects the request: "Finish /start to enable totals."
* **Timezone Shifting Strategy**:
    1. Read the user's `timezone` string (e.g. `Asia/Manila`) from the DB.
    2. Read `new Date()` indicating the exact server time.
    3. Use `Intl.DateTimeFormat` to extrapolate what Wall-Clock Year, Month, Date, Hour, Minute, and Second it currently is in Manila.
    4. Truncate those Wall-Clock values to the start of the requested period (e.g., if `/today`, set to `00:00:00` Wall-Clock time).
    5. Convert that Wall-Clock boundary *back* into a strict UTC Date.
    6. Run the SQLite aggregate: `SELECT SUM(amount_minor) FROM expenses WHERE occurred_at_utc >= start_boundary_utc AND occurred_at_utc < end_boundary_utc`.

## 3. Data Contract (The Schema)
* **Response Payload (`TotalsResult`)**:
    * `totalMinor`: Integer representing the sum in the smallest currency unit.
    * `count`: Integer representing total expenses logged that period.
    * `needsReviewCount`: Integer indicating how many of those expenses are pending manual review in the Web App.

## 4. Edge Cases & Constraints (The "What Not")
* **No `moment.js`**: We strictly use native Node/V8 `Intl` apis to parse timezone offsets to keep the Cloudflare Worker bundle tiny and cold-starts fast.
* **Missing Timezone Edge Case**: If a user somehow bypassed M4 onboarding and is missing a `timezone` in the database, the `/today` command halts. It does *not* fallback to `UTC` to prevent mathematical confusion.
* **Complex NLP Boundaries**: This milestone does *not* support natural language temporal queries like "How much did I spend last Tuesday?". It strictly supports four static slash-commands. Semantic RAG queries are deferred to M9 (Vectorize Setup).

## 5. Acceptance Criteria
* [x] Audit confirms `Intl.DateTimeFormat` boundary logic is functional.
* [x] Spec documents the architectural requirement to shift UTC -> WallClock -> UTC.
* [x] No UX/Code changes required for this phase.
