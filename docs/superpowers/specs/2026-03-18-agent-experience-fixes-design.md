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

**B. Return affected row count from `updateExpense` and `deleteExpense`**

Change both from `Promise<void>` to `Promise<number>` (rows affected). The `edit_expense` and `delete_expense` tools check: if 0 rows affected, return "Expense not found — could not update" instead of a false success message.

### Files Changed

- `src/ai/agent.ts` — `buildSystemPrompt()` accepts recent expenses, adds `RECENT EXPENSES` section
- `src/queue.ts` — fetch recent expenses before `run()`, pass to agent factory
- `src/db/expenses.ts` — `updateExpense` and `deleteExpense` return `number`
- `src/ai/tools.ts` — `edit_expense` and `delete_expense` check row count, report failure
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
  consider whether they mean the decimal form (2.80, 1.50). If ambiguous, ask: "Did you mean SGD 2.80 or SGD 280.00?"
- Never silently assume — if the amount seems unusual for the item, ask once.
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

## Out of Scope

- Storing full tool call history in D1Session (heavier fix, not needed if we inject from DB)
- Changing the session schema
- Amount validation heuristics in code (handled by prompt for now)
