# Agent Experience Fixes — Design Spec

**Goal:** Fix hallucinated expense IDs on edit/delete, silent update failures, and 5 prompt/behavior issues identified from production conversations.

**Architecture:** Two layers of changes — (1) runtime context injection + DB return values to eliminate ID hallucination, (2) system prompt improvements to fix behavior issues.

---

## Problem 1: Hallucinated Expense IDs

### Root Cause

The `D1Session` only stores plain text for `user` and `assistant` messages. The SDK sends `FunctionCallItem` and `FunctionCallResultItem` to `session.addItems()`, but these have `type` instead of `role`, so `extractRole()` returns `undefined` and they are silently dropped.

When the user says "change that to 2.80", the agent's reconstructed context is:

```
user: "Coffee 280"
assistant: "Logged SGD 280.00 — Coffee (Food)"   ← no ID
user: "It's 2.80 bruh dafuq"
```

The agent has no grounded ID and hallucinates one (e.g. #1001). The `updateExpense` function returns `void`, so the tool reports success even when 0 rows are affected.

### Solution

**A. Inject recent expenses into system prompt**

Before each agent `run()`, query the user's last 10 expenses from D1 and append a `RECENT EXPENSES` section to the system prompt:

```
RECENT EXPENSES (reference these IDs for edit/delete — never show IDs to user):
#42 Mar 18 — SGD 280.00 — Coffee (Food)
#40 Mar 17 — SGD 22.70 — Lunch, Mr. Noodles (Food)
#39 Mar 17 — SGD 5.80 — Coffee and breakfast (Food)
```

This gives the agent ground-truth IDs from the database on every run. No session history gap matters. One extra indexed D1 query per run (cheap).

**New function: `getRecentExpenses()`** in `src/db/expenses.ts`:

```sql
SELECT e.id, e.amount_minor, e.currency, e.category, e.occurred_at_utc,
       COALESCE(JSON_EXTRACT(pr.parsed_json, '$.description'), se.text_raw) as description
FROM expenses e
LEFT JOIN parse_results pr ON pr.source_event_id = e.source_event_id
LEFT JOIN source_events se ON e.source_event_id = se.id
WHERE e.user_id = ?
ORDER BY e.created_at_utc DESC
LIMIT 10
```

Separate from the existing `getExpenses()` which does period-based filtering with heavier JOINs.

**Signature changes:**
- `buildSystemPrompt(timezone, currency, recentExpensesContext?: string)` — optional param, defaults to empty string. Existing callers and tests don't break.
- `createGastosAgent(env, userId, telegramId, timezone, currency, recentExpensesContext?: string)` — forwards to `buildSystemPrompt`.
- `queue.ts` calls `getRecentExpenses()` and formats the string before passing to `createGastosAgent`.

**B. Return affected row count from `updateExpense` and `deleteExpense`**

Change both from `Promise<void>` to `Promise<number>` using D1's `result.meta.changes` (not `rows_written` which includes index updates). The early return in `updateExpense` when `keys.length === 0` returns `0`.

**Tool-level logic in `edit_expense`:**
1. If no fields to update (all inputs null) — return "Nothing to update"
2. Call `updateExpense`, check return value
3. If 0 rows affected — return "Expense #X not found or doesn't belong to you"
4. If > 0 — return success message

Same pattern for `delete_expense`.

**Note:** `edit_expense` accepts a `description` parameter but silently ignores it (description lives in `parse_results.parsed_json`, not `expenses`). This is a known limitation. With the new zero-rows check, the tool must check if updates is empty BEFORE calling `updateExpense` to avoid a false "not found" when only description was changed. For now, if only description is provided, return "Description editing is not yet supported" rather than a misleading error.

### Files Changed

- `src/ai/agent.ts` — `buildSystemPrompt()` accepts optional recent expenses context; `createGastosAgent()` forwards it
- `src/queue.ts` — fetch recent expenses before `run()`, format and pass to agent factory
- `src/db/expenses.ts` — add `getRecentExpenses()`; `updateExpense` and `deleteExpense` return `number` via `meta.changes`
- `src/ai/tools.ts` — `edit_expense` and `delete_expense` check row count, handle empty updates and description-only edge case
- Tests for all of the above

---

## Problem 2: "Coffee 280" Logged as SGD 280.00

### Root Cause

The agent interpreted "Coffee 280" literally as 280.00. For common low-cost items (coffee, bread, snacks), amounts like 280 are almost certainly 2.80 in decimal notation.

### Solution

Add a prompt rule for amount disambiguation:

```
AMOUNT HANDLING:
- When the user gives a whole number for a clearly low-cost item (e.g. "coffee 280", "bread 150"),
  consider whether they mean the decimal form (2.80, 1.50). Factor in the user's default currency —
  PHP 280 for coffee is reasonable, but SGD 280 is not.
- If ambiguous, ask: "Did you mean [CUR] 2.80 or [CUR] 280.00?"
- Never silently assume — if the amount seems unusual for the item and currency, ask once.
```

### Files Changed

- `src/ai/agent.ts` — add AMOUNT HANDLING section to system prompt

---

## Problem 3: Duplicate Expense Logged ("Lunch, Mr. Noodles")

### Root Cause

The agent called `log_expense` twice in a single turn for one expense. The chat history shows:

```
assistant: "Logged SGD 22.70 — Lunch, Mr. Noodles (Food)\nLogged SGD 22.70 — Lunch, Mr. Noodles (Food)"
```

This is a model behavior issue — the agent invoked the tool twice for a single item.

### Solution

Add a prompt rule:

```
DUPLICATE PREVENTION:
- NEVER call log_expense twice for the same item in one message. If the user says "22.70, lunch, Mr. Noodles", that is ONE expense — call log_expense exactly once.
- Only call log_expense multiple times when the user explicitly lists multiple distinct items (e.g. "coffee 5 and lunch 12").
```

### Files Changed

- `src/ai/agent.ts` — add DUPLICATE PREVENTION section to system prompt

---

## Problem 4: "$100 plus $1.50" Logged Without Descriptions

### Root Cause

The agent logged both as "Expense (Other)" — it didn't ask for descriptions when the user provided amounts without context.

### Solution

Add a prompt rule:

```
MISSING DESCRIPTION:
- If the user gives amounts without any description (e.g. "$100 plus $1.50"), ask what they were for before logging.
  Example: "What were the $100 and $1.50 for?"
- Only log immediately when both amount AND description are clear.
```

### Files Changed

- `src/ai/agent.ts` — add MISSING DESCRIPTION section to system prompt

---

## Problem 5: "What are my latest transactions" Asked for Period

### Root Cause

The agent asked "Which period — this week, this month, this year, or all time?" instead of defaulting. The system prompt says "NEVER ask for clarification on clear time expressions" but "latest transactions" isn't a time expression — it's an intent to see recent items.

### Solution

Add a prompt rule:

```
LATEST/RECENT QUERIES:
- When the user asks for "latest", "recent", or "last" transactions without specifying a period, default to "thisweek".
  If this week is empty, auto-expand to last week. Do NOT ask which period.
```

### Files Changed

- `src/ai/agent.ts` — add LATEST/RECENT QUERIES section to system prompt

---

## Problem 6: Bot Randomly Spoke Korean

### Root Cause

The user previously sent a message in Korean (or context from a Korean restaurant name like "Ju Shin Jung"), and the agent switched language. The system prompt doesn't enforce language.

### Solution

Add a prompt rule:

```
LANGUAGE:
- ALWAYS respond in English regardless of what language the user writes in or what foreign words appear in expense descriptions.
```

Note: This is hardcoded for now. TODO: make language configurable per user (a `language` field on the users table) when we support non-English speakers.

### Files Changed

- `src/ai/agent.ts` — add LANGUAGE section to system prompt

---

## Summary of All Changes

| File | Changes |
|------|---------|
| `src/ai/agent.ts` | `buildSystemPrompt()` takes recent expenses param; add 6 new prompt sections |
| `src/queue.ts` | Fetch recent expenses before agent run, pass to agent factory |
| `src/db/expenses.ts` | `updateExpense` and `deleteExpense` return `Promise<number>` |
| `src/ai/tools.ts` | `edit_expense` and `delete_expense` check row count, report failure on 0 |
| `tests/tools.test.ts` | Test edit/delete with 0 rows affected |
| `tests/expenses.test.ts` | Test return values from update/delete |
| `tests/agent.test.ts` | Test that system prompt includes recent expenses section |

## Test Cases

- `edit_expense` returns failure message when `updateExpense` returns 0
- `edit_expense` returns "nothing to update" when all inputs are null
- `edit_expense` returns "description editing not yet supported" when only description is provided
- `delete_expense` returns failure message when `deleteExpense` returns 0
- `getRecentExpenses` returns last 10 expenses with descriptions
- `buildSystemPrompt` includes RECENT EXPENSES section when context provided
- `buildSystemPrompt` omits RECENT EXPENSES section when no context (backward compatible)
- Each new prompt section is present in system prompt output

## Out of Scope

- Storing full tool call history in D1Session (heavier fix, not needed if we inject from DB)
- Changing the session schema
- Amount validation heuristics in code (handled by prompt for now)
- Description editing via `parse_results.parsed_json` (noted as TODO in edit_expense)
- Per-user language configuration (noted as TODO)
