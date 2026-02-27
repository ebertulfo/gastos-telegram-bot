# Specification: M4 Onboarding Flow

## 1. Intent (The "What")
* **Goal**: To retroactively specify the architecture for user initialization (`/start`), while simultaneously overhauling the UX to make onboarding as frictionless as possible.
* **Current UX Flaw**: The current onboarding is a tedious 3-step state machine: Ask Timezone -> Ask Currency -> Ask Confirmation if mismatched.
* **UX Fix Scope (One-Shot Onboarding)**: We will eliminate the Timezone prompt entirely. When a user hits `/start`, we will only ask for their Currency (showing popular options). Once they select a currency, we will *automatically infer* their default timezone using our `CURRENCY_TO_DEFAULT_TIMEZONE` map and immediately mark them as `completed`. This reduces friction from 3 clicks to 1 click.

## 2. Architecture & Data Flow (The "How")
* **State Machine Simplification**: 
    * Remove `awaiting_timezone` entirely.
    * Remove `awaiting_currency_timezone_confirmation` entirely.
    * The only transient state is `awaiting_currency`.
* **The Flow**:
    1. User sends `/start` or `hi`.
    2. Bot replies: "Welcome to Gastos! Choose your primary currency:" (shows inline keyboard of priority currencies).
    3. User clicks `PHP`.
    4. Bot maps `PHP` -> `Asia/Manila`.
    5. Bot sets `user.currency = 'PHP'`, `user.timezone = 'Asia/Manila'`, `user.onboarding_step = 'completed'`.
    6. Bot replies: "Setup complete ✅ Your timezone was set to Manila. You can now log expenses!"

## 3. Data Contract (The Schema)
* **Users Table (`schema.ts`)**:
    * `onboarding_step`: String enum transitions from `null` -> `awaiting_currency` -> `completed`.
    * `timezone`: String (IANA standard, e.g., "Asia/Manila") mapped automatically on completion.
    * `currency`: String (ISO 4217, e.g., "PHP").

## 4. Edge Cases & Constraints (The "What Not")
* **Incorrect Inference**: If the user selects `USD` but actually lives in Manila, the system will incorrectly map them to `America/New_York`. 
    * **Constraint**: For Phase 1, we accept this. Users who need a custom timezone/currency mismatch will be able to edit their settings manually via the Web App Mini-App (which is the true settings dashboard), keeping the Telegram flow lightning fast for the 99% of normal users.
* **Unknown Currencies**: If a user types a valid 3-letter currency that isn't in our `CURRENCY_TO_DEFAULT_TIMEZONE` map, the system will fallback to `UTC`.

## 5. Acceptance Criteria
* [ ] User sends `/start`.
* [ ] Bot prompts *only* for Currency.
* [ ] User clicks a currency button.
* [ ] Bot replies "Setup complete" and immediately allows expense logging, automatically saving the inferred timezone.
* [ ] The old timezone and confirmation states are completely removed from `src/onboarding.ts`.
