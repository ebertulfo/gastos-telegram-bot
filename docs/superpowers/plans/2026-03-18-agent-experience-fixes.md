# Agent Experience Fixes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix hallucinated expense IDs, silent update/delete failures, duplicate logging, and 4 prompt behavior issues.

**Architecture:** Two layers — (1) runtime context injection via `getRecentExpenses()` + row-count returns from DB functions, (2) system prompt additions for behavior fixes + code-level dedup guard.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers D1, OpenAI Agents SDK, Vitest

**Spec:** `docs/superpowers/specs/2026-03-18-agent-experience-fixes-design.md`

---

## Chunk 1: DB Layer — Row Counts and Recent Expenses Query

### Task 1: Make `updateExpense` return affected row count

**Files:**
- Modify: `src/db/expenses.ts:60-83`
- Modify: `tests/expenses.test.ts:11-23`

- [ ] **Step 1: Update the existing test to check return value**

In `tests/expenses.test.ts`, update the "updates with user_id guard" test:

```typescript
it("updates with user_id guard and returns changes count", async () => {
  const { db, prepare, bind } = mockDb();
  const changes = await updateExpense(db, 42, 7, { amount_minor: 1500 });
  expect(prepare).toHaveBeenCalledWith(expect.stringContaining("user_id"));
  expect(bind).toHaveBeenCalledWith(1500, 42, 7);
  expect(changes).toBe(1);
});
```

- [ ] **Step 2: Add test for zero rows affected**

```typescript
it("returns 0 when no rows matched", async () => {
  const run = vi.fn(async () => ({ meta: { changes: 0 } }));
  const bind = vi.fn(() => ({ run }));
  const prepare = vi.fn(() => ({ bind }));
  const db = { prepare } as unknown as D1Database;
  const changes = await updateExpense(db, 999, 7, { amount_minor: 100 });
  expect(changes).toBe(0);
});
```

- [ ] **Step 3: Update the empty-updates test**

```typescript
it("returns 0 on empty updates without querying", async () => {
  const { db, prepare } = mockDb();
  const changes = await updateExpense(db, 42, 7, {});
  expect(prepare).not.toHaveBeenCalled();
  expect(changes).toBe(0);
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm run test -- tests/expenses.test.ts`
Expected: FAIL — `updateExpense` currently returns `void`, not a number.

- [ ] **Step 5: Update `updateExpense` in `src/db/expenses.ts`**

Change the function signature and implementation:

```typescript
export async function updateExpense(
    db: D1Database,
    expenseId: number,
    userId: number,
    updates: Record<string, unknown>
): Promise<number> {
    const keys = Object.keys(updates);
    if (keys.length === 0) return 0;

    for (const key of keys) {
      if (!ALLOWED_UPDATE_COLUMNS.has(key)) {
        throw new Error(`Invalid update column: ${key}`);
      }
    }

    const setClauses = keys.map((k) => `${k} = ?`);
    const bindings = [...keys.map((k) => updates[k]), expenseId, userId];

    const query = `UPDATE expenses SET ${setClauses.join(", ")} WHERE id = ? AND user_id = ?`;

    const result = await db.prepare(query)
        .bind(...bindings)
        .run();

    return result.meta.changes;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -- tests/expenses.test.ts`
Expected: ALL pass

- [ ] **Step 7: Commit**

```bash
git add src/db/expenses.ts tests/expenses.test.ts
git commit -m "feat: make updateExpense return affected row count"
```

---

### Task 2: Make `deleteExpense` return affected row count

**Files:**
- Modify: `src/db/expenses.ts:119-125`
- Modify: `tests/expenses.test.ts:33-39`

- [ ] **Step 1: Update existing test and add zero-rows test**

In `tests/expenses.test.ts`:

```typescript
describe("deleteExpense", () => {
  it("deletes with user_id guard and returns changes count", async () => {
    const { db, prepare, bind } = mockDb();
    const changes = await deleteExpense(db, 42, 7);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("user_id"));
    expect(bind).toHaveBeenCalledWith(42, 7);
    expect(changes).toBe(1);
  });

  it("returns 0 when no rows matched", async () => {
    const run = vi.fn(async () => ({ meta: { changes: 0 } }));
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;
    const changes = await deleteExpense(db, 999, 7);
    expect(changes).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/expenses.test.ts`
Expected: FAIL — `deleteExpense` currently returns `void`.

- [ ] **Step 3: Update `deleteExpense` in `src/db/expenses.ts`**

```typescript
export async function deleteExpense(db: D1Database, expenseId: number, userId: number): Promise<number> {
    const result = await db.prepare(
        `DELETE FROM expenses WHERE id = ? AND user_id = ?`
    )
        .bind(expenseId, userId)
        .run();

    return result.meta.changes;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/expenses.test.ts`
Expected: ALL pass

- [ ] **Step 5: Commit**

```bash
git add src/db/expenses.ts tests/expenses.test.ts
git commit -m "feat: make deleteExpense return affected row count"
```

---

### Task 3: Add `getRecentExpenses` function

**Files:**
- Modify: `src/db/expenses.ts`
- Modify: `tests/expenses.test.ts`

- [ ] **Step 1: Add the type and write the test**

In `tests/expenses.test.ts`:

```typescript
import { updateExpense, deleteExpense, getUserTags, getRecentExpenses } from "../src/db/expenses";

describe("getRecentExpenses", () => {
  it("returns last N expenses with descriptions", async () => {
    const results = [
      { id: 42, amount_minor: 28000, currency: "SGD", category: "Food", occurred_at_utc: "2026-03-18T01:34:35Z", description: "Coffee" },
      { id: 40, amount_minor: 2270, currency: "SGD", category: "Food", occurred_at_utc: "2026-03-17T05:04:56Z", description: "Lunch, Mr. Noodles" },
    ];
    const all = vi.fn(async () => ({ results }));
    const bind = vi.fn(() => ({ all }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    const expenses = await getRecentExpenses(db, 1, 10);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("ORDER BY"));
    expect(bind).toHaveBeenCalledWith(1, 10);
    expect(expenses).toHaveLength(2);
    expect(expenses[0].id).toBe(42);
    expect(expenses[0].description).toBe("Coffee");
  });

  it("returns empty array when no expenses", async () => {
    const all = vi.fn(async () => ({ results: [] }));
    const bind = vi.fn(() => ({ all }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    const expenses = await getRecentExpenses(db, 1, 10);
    expect(expenses).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/expenses.test.ts`
Expected: FAIL — `getRecentExpenses` doesn't exist yet.

- [ ] **Step 3: Implement `getRecentExpenses` in `src/db/expenses.ts`**

Add the type and function:

```typescript
export type RecentExpense = {
  id: number;
  amount_minor: number;
  currency: string;
  category: string;
  occurred_at_utc: string;
  description: string | null;
};

export async function getRecentExpenses(
  db: D1Database,
  userId: number,
  limit: number = 10
): Promise<RecentExpense[]> {
  const { results } = await db.prepare(
    `SELECT e.id, e.amount_minor, e.currency, e.category, e.occurred_at_utc,
            COALESCE(JSON_EXTRACT(pr.parsed_json, '$.description'), se.text_raw) as description
     FROM expenses e
     LEFT JOIN parse_results pr ON pr.source_event_id = e.source_event_id
     LEFT JOIN source_events se ON e.source_event_id = se.id
     WHERE e.user_id = ?
     ORDER BY e.created_at_utc DESC
     LIMIT ?`
  )
    .bind(userId, limit)
    .all<RecentExpense>();

  return results ?? [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/expenses.test.ts`
Expected: ALL pass

- [ ] **Step 5: Commit**

```bash
git add src/db/expenses.ts tests/expenses.test.ts
git commit -m "feat: add getRecentExpenses for agent context injection"
```

---

## Chunk 2: Tool Layer — Row Count Checks and Dedup Guard

### Task 4: Update `edit_expense` tool to check row count

**Files:**
- Modify: `src/ai/tools.ts:101-133`
- Modify: `tests/tools.test.ts:14-19,101-110,385-397`

- [ ] **Step 1: Update the mock to return numbers**

In `tests/tools.test.ts`, change the expenses mock (line 15-19):

```typescript
vi.mock("../src/db/expenses", () => ({
  insertExpense: vi.fn().mockResolvedValue(1),
  updateExpense: vi.fn().mockResolvedValue(1),
  deleteExpense: vi.fn().mockResolvedValue(1),
  getExpenses: vi.fn().mockResolvedValue([]),
}));
```

- [ ] **Step 2: Add failing test for zero rows**

```typescript
it("edit_expense returns failure when expense not found", async () => {
  const { updateExpense } = await import("../src/db/expenses");
  vi.mocked(updateExpense).mockResolvedValueOnce(0);

  const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
  const editTool = tools[1] as any;
  const result = await editTool.execute({
    expense_id: 999,
    amount: 5,
    category: null,
    description: null,
    occurred_at: null,
  });
  expect(result).toContain("not found");
});
```

- [ ] **Step 3: Add test for description-only edit**

```typescript
it("edit_expense returns not-supported when only description provided", async () => {
  const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
  const editTool = tools[1] as any;
  const result = await editTool.execute({
    expense_id: 42,
    amount: null,
    category: null,
    description: "Updated name",
    occurred_at: null,
  });
  expect(result).toContain("not yet supported");
});
```

- [ ] **Step 4: Add test for all-null inputs**

```typescript
it("edit_expense returns nothing-to-update when all inputs null", async () => {
  const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
  const editTool = tools[1] as any;
  const result = await editTool.execute({
    expense_id: 42,
    amount: null,
    category: null,
    description: null,
    occurred_at: null,
  });
  expect(result).toContain("Nothing to update");
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npm run test -- tests/tools.test.ts`
Expected: FAIL — current `edit_expense` doesn't check row count or handle description-only.

- [ ] **Step 6: Update `edit_expense` in `src/ai/tools.ts`**

Replace the execute function (lines 111-132):

```typescript
execute: async (input) => {
    const updates: Record<string, unknown> = {};
    if (input.amount !== null) {
        updates.amount_minor = Math.round(input.amount * 100);
    }
    if (input.category !== null) {
        updates.category = input.category;
    }
    if (input.occurred_at !== null) {
        const validatedDate = validateOccurredAt(input.occurred_at, "edit_expense");
        if (validatedDate) {
            updates.occurred_at_utc = validatedDate;
        }
    }

    // Description is not stored on the expenses table (lives in parse_results.parsed_json)
    if (Object.keys(updates).length === 0) {
        if (input.description !== null) {
            return "Description editing is not yet supported";
        }
        return "Nothing to update";
    }

    const changes = await updateExpense(env.DB, input.expense_id, userId, updates);
    if (changes === 0) {
        return `Expense #${input.expense_id} not found or doesn't belong to you`;
    }

    const changedFields = Object.keys(updates).map(k => k.replace("_minor", "").replace("_utc", "")).join(", ");
    return `Updated expense #${input.expense_id} \u2014 changed: ${changedFields}`;
},
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test -- tests/tools.test.ts`
Expected: ALL pass

- [ ] **Step 8: Commit**

```bash
git add src/ai/tools.ts tests/tools.test.ts
git commit -m "feat: edit_expense checks row count, handles description-only and all-null"
```

---

### Task 5: Update `delete_expense` tool to check row count

**Files:**
- Modify: `src/ai/tools.ts:135-145`
- Modify: `tests/tools.test.ts`

- [ ] **Step 1: Add failing test**

```typescript
it("delete_expense returns failure when expense not found", async () => {
  const { deleteExpense } = await import("../src/db/expenses");
  vi.mocked(deleteExpense).mockResolvedValueOnce(0);

  const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
  const deleteTool = tools[2] as any;
  const result = await deleteTool.execute({ expense_id: 999 });
  expect(result).toContain("not found");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/tools.test.ts`
Expected: FAIL

- [ ] **Step 3: Update `delete_expense` in `src/ai/tools.ts`**

```typescript
execute: async (input) => {
    const changes = await deleteExpense(env.DB, input.expense_id, userId);
    if (changes === 0) {
        return `Expense #${input.expense_id} not found or doesn't belong to you`;
    }
    return `Deleted expense #${input.expense_id}`;
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/tools.test.ts`
Expected: ALL pass

- [ ] **Step 5: Commit**

```bash
git add src/ai/tools.ts tests/tools.test.ts
git commit -m "feat: delete_expense checks row count and reports failure"
```

---

### Task 6: Add log_expense dedup guard

**Files:**
- Modify: `src/ai/tools.ts:48,60-61`
- Modify: `tests/tools.test.ts`

- [ ] **Step 1: Add failing test**

```typescript
it("log_expense skips duplicate in same run", async () => {
  const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
  const logTool = tools[0] as any;

  const input = {
    amount: 12.5,
    currency: "PHP",
    description: "Lunch",
    category: "Food",
    tags: [],
  };

  const first = await logTool.execute(input);
  const second = await logTool.execute(input);

  expect(first).toContain("Logged");
  expect(second).toContain("Already logged");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/tools.test.ts`
Expected: FAIL — second call currently logs again.

- [ ] **Step 3: Add dedup Set in `createAgentTools` and check in `log_expense`**

In `src/ai/tools.ts`, inside `createAgentTools()` (after line 48), add:

```typescript
const loggedThisRun = new Set<string>();
```

Then at the top of `log_expense`'s `execute` (after line 60), add:

```typescript
const dedupeKey = `${input.description}|${input.amount}|${input.currency}`;
if (loggedThisRun.has(dedupeKey)) {
    return "Already logged this expense \u2014 skipping duplicate";
}
loggedThisRun.add(dedupeKey);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/tools.test.ts`
Expected: ALL pass

- [ ] **Step 5: Commit**

```bash
git add src/ai/tools.ts tests/tools.test.ts
git commit -m "feat: add log_expense dedup guard within single agent run"
```

---

## Chunk 3: Agent Layer — Context Injection and Prompt Fixes

### Task 7: Inject recent expenses into system prompt

**Files:**
- Modify: `src/ai/agent.ts:8,104`
- Modify: `src/queue.ts:4,123`
- Modify: `tests/agent.test.ts`

- [ ] **Step 1: Add test for recent expenses in prompt**

In `tests/agent.test.ts`:

```typescript
it("includes recent expenses context when provided", () => {
    const context = "#42 Mar 18 — SGD 280.00 — Coffee (Food)";
    const prompt = buildSystemPrompt("UTC", "USD", context);
    expect(prompt).toContain("RECENT EXPENSES");
    expect(prompt).toContain("#42");
    expect(prompt).toContain("Coffee");
});

it("omits recent expenses section when no context", () => {
    const prompt = buildSystemPrompt("UTC", "USD");
    expect(prompt).not.toContain("RECENT EXPENSES");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/agent.test.ts`
Expected: FAIL — `buildSystemPrompt` doesn't accept 3rd param yet.

- [ ] **Step 3: Update `buildSystemPrompt` in `src/ai/agent.ts`**

Change the signature (line 8):

```typescript
export function buildSystemPrompt(timezone: string, currency: string, recentExpensesContext?: string): string {
```

At the end of the template literal, before the closing backtick (after line 97), add:

```typescript
${recentExpensesContext ? `\n\nRECENT EXPENSES (reference these IDs for edit/delete — never show IDs to user):\n${recentExpensesContext}` : ""}
```

- [ ] **Step 4: Update `createGastosAgent` signature**

```typescript
export function createGastosAgent(env: Env, userId: number, telegramId: number, timezone: string, currency: string, recentExpensesContext?: string) {
    const tools = createAgentTools(env, userId, telegramId, timezone, currency);

    return new Agent({
        name: "gastos",
        model: "gpt-5-mini",
        instructions: buildSystemPrompt(timezone, currency, recentExpensesContext),
        tools,
    });
}
```

- [ ] **Step 5: Update `queue.ts` to fetch and format recent expenses**

In `src/queue.ts`, add import (line 4 area):

```typescript
import { getRecentExpenses } from "./db/expenses";
```

Before the `createGastosAgent` call (line 123), add:

```typescript
// Fetch recent expenses for agent context (prevents hallucinated IDs on edit/delete)
const recentExpenses = await getRecentExpenses(env.DB, userId, 10);
const recentExpensesContext = recentExpenses.length > 0
    ? recentExpenses.map(e => {
        const date = new Date(e.occurred_at_utc).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const amount = (e.amount_minor / 100).toFixed(2);
        return `#${e.id} ${date} — ${e.currency} ${amount} — ${e.description ?? "Unknown"} (${e.category})`;
      }).join("\n")
    : "";
```

Update the `createGastosAgent` call:

```typescript
const agent = createGastosAgent(env, userId, telegramId, timezone, currency, recentExpensesContext);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -- tests/agent.test.ts`
Expected: ALL pass

- [ ] **Step 7: Run full suite**

Run: `npm run check && npm run test`
Expected: All pass (148+ tests)

- [ ] **Step 8: Commit**

```bash
git add src/ai/agent.ts src/queue.ts tests/agent.test.ts
git commit -m "feat: inject recent expenses into agent context to prevent ID hallucination"
```

---

### Task 8: Add all prompt behavior fixes

**Files:**
- Modify: `src/ai/agent.ts:17-97`
- Modify: `tests/agent.test.ts`

- [ ] **Step 1: Add tests for each new prompt section**

In `tests/agent.test.ts`:

```typescript
it("includes amount handling rules", () => {
    const prompt = buildSystemPrompt("UTC", "USD");
    expect(prompt).toContain("AMOUNT HANDLING");
});

it("includes duplicate prevention rules", () => {
    const prompt = buildSystemPrompt("UTC", "USD");
    expect(prompt).toContain("DUPLICATE PREVENTION");
});

it("includes ambiguous amounts rules", () => {
    const prompt = buildSystemPrompt("UTC", "USD");
    expect(prompt).toContain("AMBIGUOUS AMOUNTS");
});

it("includes latest/recent query default", () => {
    const prompt = buildSystemPrompt("UTC", "USD");
    expect(prompt).toContain("LATEST/RECENT");
});

it("includes language rule", () => {
    const prompt = buildSystemPrompt("UTC", "USD");
    expect(prompt).toContain("LANGUAGE");
    expect(prompt).toContain("English");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/agent.test.ts`
Expected: FAIL — prompt doesn't have these sections yet.

- [ ] **Step 3: Add all 5 new sections to the system prompt**

In `src/ai/agent.ts`, add these sections inside the template literal in `buildSystemPrompt()`. Insert them after the CATEGORIES section (after line 53) and before RESPONSE FORMAT (line 55):

```typescript
AMOUNT HANDLING:
- When the user gives a whole number for a clearly low-cost item (e.g. "coffee 280", "bread 150"), consider whether they mean the decimal form (2.80, 1.50). Factor in the user's default currency — PHP 280 for coffee is reasonable, but SGD 280 is not.
- If ambiguous, ask: "Did you mean ${currency} 2.80 or ${currency} 280.00?"
- Never silently assume — if the amount seems unusual for the item and currency, ask once.

DUPLICATE PREVENTION:
- NEVER call log_expense twice for the same item in one message. If the user says "22.70, lunch, Mr. Noodles", that is ONE expense — call log_expense exactly once.
- Only call log_expense multiple times when the user explicitly lists multiple distinct items (e.g. "coffee 5 and lunch 12").

AMBIGUOUS AMOUNTS:
- When a message contains multiple numbers and it's unclear which are amounts vs part of a name, ASK before logging.
  Example: "100 plus 1.50" — ask: "Is '100 Plus' the item name with a price of 1.50, or are you logging two expenses?"
- Only log multiple expenses when they are clearly distinct items (e.g. "coffee 5 and lunch 12").
- If a message has amounts but no clear description of what was purchased, ask what it was for before logging.

LATEST/RECENT QUERIES:
- When the user asks for "latest", "recent", or "last" transactions without specifying a period, default to "thisweek". If this week is empty, auto-expand to last week. Do NOT ask which period.

LANGUAGE:
- ALWAYS respond in English regardless of what language the user writes in or what foreign words appear in expense descriptions.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/agent.test.ts`
Expected: ALL pass

- [ ] **Step 5: Run full suite**

Run: `npm run check && npm run test`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/ai/agent.ts tests/agent.test.ts
git commit -m "feat: add 5 prompt behavior fixes (amounts, dedup, ambiguity, recent, language)"
```

---

## Chunk 4: Final Verification

### Task 9: Full verification and type check

- [ ] **Step 1: Run full type check and test suite**

Run: `npm run check && npm run test`
Expected: All pass

- [ ] **Step 2: Verify no regressions in existing behavior**

Check that all existing tests still pass — especially:
- `tests/webhook.test.ts` (9 tests)
- `tests/queue.test.ts` (5 tests)
- `tests/tools.test.ts` (20+ tests)
- `tests/agent.test.ts` (16+ tests)
- `tests/expenses.test.ts` (6+ tests)

- [ ] **Step 3: Verify the import chain**

Ensure `queue.ts` → `db/expenses.ts` → `getRecentExpenses` import resolves correctly. Ensure `tools.ts` uses the `number` return from `updateExpense`/`deleteExpense`.
