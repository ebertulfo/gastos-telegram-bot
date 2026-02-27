# Specification: [Feature Name]

## 1. Intent (The "What")
* **Goal**: Describe the exact business value and outcome of this feature.
* **Scope**: What is explicitly included in this milestone?
* **Out of Scope**: What is tangentially related but explicitly *not* being done in this milestone?

## 2. Architecture & Data Flow (The "How")
* **External APIs**: (e.g., Telegram, OpenAI) - list endpoints, expected inputs/outputs, and latency considerations.
* **Component Layer**: Which web components/screens will this affect?
* **Worker Layer**: Which webhook or queue consumers change?

## 3. Data Contract (The Schema)
* **Zod Schemas**: (Paste the exact proposed TypeScript interface/schema here).
* **Database Models**: (e.g., D1 table additions, modified columns, indexes).

## 4. Edge Cases & Constraints (The "What Not")
* **Failures**: How does the system degrade if external APIs fail or return 500s?
* **Invalid Input**: What happens if the payload doesn't match the Zod contract? Does it log safely without crashing?
* **Concurrency**: Are there race conditions or idempotency issues to mitigate?

## 5. Acceptance Criteria
* [ ] The bot successfully parses X.
* [ ] The UI displays Y.
* [ ] If Z fails, the user receives an explicit failure message instead of a silent crash.
