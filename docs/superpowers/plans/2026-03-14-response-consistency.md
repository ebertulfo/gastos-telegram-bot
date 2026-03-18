# Response Consistency & Tone Guide Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bot's responses consistent, predictable, and professional by adding formatting templates to the system prompt, cleaning up tool return strings, and standardizing all user-facing copy.

**Architecture:** All changes are to existing files — no new files. The system prompt gets response templates and a tone guide so the LLM produces consistent output. Tool return strings and code-generated messages (totals, notifications, onboarding, errors) are standardized to match the same voice.

**Tech Stack:** TypeScript, Vitest, OpenAI Agents SDK

---

## File Map

| File | Role | Change |
|------|------|--------|
| `src/ai/agent.ts` | System prompt | Add RESPONSE FORMAT templates + TONE rules |
| `src/ai/tools.ts` | Tool return strings + financial report | Standardize return formats, human-readable periods/dates |
| `src/totals.ts` | `/today` `/thismonth` formatter | Fix `formatTotalsMessage` output |
| `src/onboarding.ts` | Welcome/setup messages | Remove jargon, improve copy |
| `src/notifications.ts` | Scheduled notification copy | Minor tone standardization |
| `src/telegram/streaming.ts` | Tool status text + fallback | Minor tone standardization |
| `src/queue.ts` | Error messages to user | Minor tone standardization |
| `tests/agent.test.ts` | System prompt tests | Add tests for new prompt sections |
| `tests/tools.test.ts` | Tool output tests | Update assertions for new formats |
| `tests/totals.test.ts` | Totals formatter tests | Update assertions for new format |
| `tests/streaming.test.ts` | Streaming/fallback tests | Update FALLBACK_TEXT assertion |

---

## Chunk 1: System Prompt & Tone Guide

### Task 1: System prompt — add response templates and tone guide

**Files:**
- Modify: `src/ai/agent.ts:17-52` (the `buildSystemPrompt` function body)
- Test: `tests/agent.test.ts`

The system prompt currently says "Be CONCISE. 2-5 lines max" but never specifies HOW to format responses. This is why the LLM free-forms every reply differently.

- [ ] **Step 1: Write failing tests for new prompt sections**

Add tests to `tests/agent.test.ts` in the `buildSystemPrompt` describe block:

```typescript
it("includes response format templates", () => {
    const prompt = buildSystemPrompt("UTC", "USD");
    expect(prompt).toContain("RESPONSE FORMAT");
    expect(prompt).toContain("Logged");
    expect(prompt).toContain("Updated");
    expect(prompt).toContain("Deleted");
});

it("includes tone rules", () => {
    const prompt = buildSystemPrompt("UTC", "USD");
    expect(prompt).toContain("TONE");
    expect(prompt).toContain("em dash");
});

it("includes rule against showing expense IDs", () => {
    const prompt = buildSystemPrompt("UTC", "USD");
    expect(prompt).toContain("Never show expense IDs");
});

it("includes rule against internal terminology", () => {
    const prompt = buildSystemPrompt("UTC", "USD");
    expect(prompt).toContain("Never say");
    expect(prompt).toContain("from your report");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/agent.test.ts`
Expected: 4 new tests FAIL (prompt doesn't contain RESPONSE FORMAT, TONE, etc.)

- [ ] **Step 3: Add RESPONSE FORMAT and TONE sections to system prompt**

In `src/ai/agent.ts`, add these sections to the `buildSystemPrompt` return string, after the existing CATEGORIES section:

```typescript
RESPONSE FORMAT:
Follow these templates for consistent output. Do not deviate from these patterns.

Logging an expense:
  Logged [CUR] [amount] — [description] ([category])
  Example: Logged SGD 12.50 — Lunch (Food)

Logging multiple expenses:
  Logged SGD 5.60 — Coffee (Food)
  Logged SGD 1.20 — Bread (Food)

Confirming an edit:
  Updated [description] — [what changed]
  Example: Updated Wingstop — amount now SGD 37.80

Confirming a delete:
  Deleted [description]

Spending total (simple):
  You spent [CUR] [amount] [period]
  [count] transactions
  Top category: [category] ([CUR] [amount])

Spending total (with breakdown):
  [Period label] — [CUR] [total]
  [Category] — [CUR] [amount]
  [Category] — [CUR] [amount]

Transaction list:
  [Context label] — [CUR] [total] ([count] transactions)
  - [description] — [CUR] [amount]
  - [description] — [CUR] [amount]

TONE:
- Use — (em dash) to separate items, not colons or pipes
- Never put quotes around expense descriptions
- Never show expense IDs to the user unless they explicitly ask to see them. You have the IDs from tool results — use them internally for edits/deletes
- Never say "from your report", "based on the data", or other internal terminology
- Never add "today" when confirming a just-logged expense — it is obvious
- Format currency as: CUR amount (e.g. SGD 12.50). Always include the currency code
- Use consistent dash bullets (—) for lists, not mixed bullets
- Do not end short confirmations with periods — feels more natural in chat
- Keep follow-up answers anchored to the previous context. If the user asks "how about yesterday?", carry over the previous filter
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/agent.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Strengthen the no-clarification rule**

The LLM asked what "past 3 days" means despite the existing rule. Move the rule to be more prominent. In the existing RULES section, change:

Old: `- For comparisons ("this week vs last week"), call get_financial_report twice with different periods.`

After this line, add:
```
- NEVER ask for clarification on clear time expressions. "Past 3 days", "this week", "last month" are unambiguous — just answer. This is critical: do not ask the user to confirm what a simple time expression means.
```

This reinforces the existing rule in QUERY SCOPE by repeating it in RULES where it's more visible to the model.

- [ ] **Step 6: Run full test suite**

Run: `npm run check && npm run test`
Expected: All 133+ tests PASS, no type errors

- [ ] **Step 7: Commit**

```bash
git add src/ai/agent.ts tests/agent.test.ts
git commit -m "feat: add response format templates and tone guide to system prompt"
```

---

## Chunk 2: Tool Return Strings & Financial Report

### Task 2: Financial report — human-readable period labels and dates

**Files:**
- Modify: `src/ai/tools.ts:265-323` (the `executeGetFinancialReportInternal` function)
- Test: `tests/tools.test.ts`

The financial report currently uses internal period names like `thismonth` and raw ISO timestamps. These leak into LLM responses.

- [ ] **Step 1: Write failing test for human-readable period label**

Add to `tests/tools.test.ts`:

```typescript
it("get_financial_report uses human-readable period labels", async () => {
    const { getExpenses } = await import("../src/db/expenses");
    vi.mocked(getExpenses).mockResolvedValueOnce([
        {
            id: 80,
            source_event_id: 101,
            amount_minor: 500,
            currency: "SGD",
            occurred_at_utc: "2026-03-14T04:00:00Z",
            status: "final",
            category: "Food",
            tags: "[]",
            text_raw: null,
            r2_object_key: null,
            needs_review_reason: false,
            parsed_description: "Coffee",
        },
    ]);

    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const reportTool = tools[3] as any;
    const result = await reportTool.execute({
        period: "thismonth",
        category: null,
        tag_query: null,
    });
    // Should say "This Month" not "thismonth"
    expect(result).toContain("This Month");
    expect(result).not.toContain("thismonth");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/tools.test.ts`
Expected: FAIL — result contains "thismonth" not "This Month"

- [ ] **Step 3: Write failing test for formatted dates in recent transactions**

Add to `tests/tools.test.ts`:

```typescript
it("get_financial_report formats dates as readable strings", async () => {
    const { getExpenses } = await import("../src/db/expenses");
    vi.mocked(getExpenses).mockResolvedValueOnce([
        {
            id: 81,
            source_event_id: 102,
            amount_minor: 1800,
            currency: "SGD",
            occurred_at_utc: "2026-03-14T04:00:00Z",
            status: "final",
            category: "Food",
            tags: "[]",
            text_raw: null,
            r2_object_key: null,
            needs_review_reason: false,
            parsed_description: "Lunch",
        },
    ]);

    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const reportTool = tools[3] as any;
    const result = await reportTool.execute({
        period: "today",
        category: null,
        tag_query: null,
    });
    // Should NOT contain raw ISO timestamp
    expect(result).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // Should contain a readable date like "Mar 14"
    expect(result).toMatch(/[A-Z][a-z]{2} \d{1,2}/);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test -- tests/tools.test.ts`
Expected: FAIL — result contains raw ISO timestamps

- [ ] **Step 5: Implement human-readable formatting in financial report**

In `src/ai/tools.ts`, add a period label map and a date formatter at the top of `executeGetFinancialReportInternal`, then use them in the output assembly:

1. Add period label map (same as totals.ts):
```typescript
const PERIOD_LABELS: Record<string, string> = {
    today: "Today",
    yesterday: "Yesterday",
    thisweek: "This Week",
    lastweek: "Last Week",
    thismonth: "This Month",
    lastmonth: "Last Month",
    thisyear: "This Year",
    lastyear: "Last Year",
};
```

2. Add short date formatter:
```typescript
function formatShortDate(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
```

3. In the period label output (line ~312-313), replace raw period with:
```typescript
const displayPeriod = PERIOD_LABELS[expandedToPrevious ? previousPeriodLabel : period] ?? period;
```

4. In the "Recent Transactions" section (line ~304), replace `e.occurred_at_utc` with `formatShortDate(e.occurred_at_utc)`.

5. In the total line, use `Intl.NumberFormat` for the total (it already does for some paths):
```typescript
const totalFormatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
}).format(totalMinor / 100);
```

6. Use `displayPeriod` in all output lines where period is referenced, including the `periodNote` auto-expand message (lines 308-309). Change:
```typescript
const periodNote = expandedToPrevious
    ? `NOTE: No data existed for "${period}" ...`
```
to use `PERIOD_LABELS[period]` and `PERIOD_LABELS[previousPeriodLabel]` instead of raw period strings.

7. **Do NOT import `periodLabel` from totals.ts** — the `PERIOD_LABELS` map is intentionally duplicated here because tools.ts should not depend on totals.ts for display logic (they have different responsibilities). The map is 8 lines and stable.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -- tests/tools.test.ts`
Expected: All tests PASS including the 2 new ones

- [ ] **Step 7: Commit**

```bash
git add src/ai/tools.ts tests/tools.test.ts
git commit -m "feat: use human-readable period labels and dates in financial report"
```

### Task 3: Tool return strings for log/edit/delete

**Files:**
- Modify: `src/ai/tools.ts:92,125-126,139`
- Test: `tests/tools.test.ts`

Standardize the tool return strings that the LLM reads. These should match the tone of the system prompt templates so the LLM echoes them naturally.

- [ ] **Step 1: Write failing tests for updated tool return formats**

Add to `tests/tools.test.ts`:

```typescript
it("log_expense returns em-dash separated confirmation", async () => {
    const { insertExpense } = await import("../src/db/expenses");
    vi.mocked(insertExpense).mockResolvedValueOnce(99);

    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const logTool = tools[0] as any;
    const result = await logTool.execute({
        amount: 12.5,
        currency: "PHP",
        description: "Lunch",
        category: "Food",
        tags: [],
    });
    // Should use em dash format: "Logged PHP 12.50 — Lunch (Food). ID #99"
    expect(result).toContain("—");
    expect(result).not.toContain("for \"");
    expect(result).not.toContain("under");
});

it("edit_expense returns descriptive change confirmation", async () => {
    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const editTool = tools[1] as any;
    const result = await editTool.execute({
        expense_id: 7,
        amount: 37.8,
        category: null,
        description: null,
        occurred_at: null,
    });
    expect(result).toContain("#7");
    expect(result).toContain("amount");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/tools.test.ts`
Expected: FAIL — log_expense still uses `for "` and `under`

- [ ] **Step 3: Update tool return strings**

In `src/ai/tools.ts`:

1. `log_expense` return (line ~92):
```typescript
return `Logged ${input.currency} ${input.amount.toFixed(2)} — ${input.description} (${input.category}). ID #${expenseId}`;
```

2. `edit_expense` return (line ~125-126):
```typescript
const changes = Object.keys(updates).map(k => k.replace("_minor", "").replace("_utc", "")).join(", ");
return `Updated expense #${input.expense_id} — changed: ${changes || "nothing"}`;
```

3. `delete_expense` return (line ~139):
```typescript
return `Deleted expense #${input.expense_id}`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/tools.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full suite to check nothing broke**

Run: `npm run check && npm run test`
Expected: All tests PASS, no type errors

- [ ] **Step 6: Commit**

```bash
git add src/ai/tools.ts tests/tools.test.ts
git commit -m "feat: standardize tool return strings with em-dash format"
```

---

## Chunk 3: Code-Generated Messages

### Task 4: Fix totals formatter

**Files:**
- Modify: `src/totals.ts:62-75` (`formatTotalsMessage` function)
- Test: `tests/totals.test.ts`

Current output:
```
Today
Total: SGD 1,234.56
Count: (18 expenses)
Needs review: 3 need confirmation
```

Problems: "Count:" label with redundant parentheses, "Needs review: X need confirmation" is redundant.

Target output:
```
Today — SGD 1,234.56
18 expenses
3 need review
```

- [ ] **Step 1: Update the test assertion for new format**

In `tests/totals.test.ts`, update the `formatTotalsMessage` test:

```typescript
describe("formatTotalsMessage", () => {
    it("formats output contract", () => {
        const text = formatTotalsMessage({
            currency: "SGD",
            period: "today",
            totals: {
                totalMinor: 123456,
                count: 18,
                needsReviewCount: 3,
            },
        });

        expect(text).toContain("Today");
        expect(text).toContain("SGD 1,234.56");
        expect(text).toContain("18 expenses");
        expect(text).toContain("3 need review");
        // Should NOT contain redundant labels
        expect(text).not.toContain("Count:");
        expect(text).not.toContain("Total:");
    });

    it("omits review line when count is zero", () => {
        const text = formatTotalsMessage({
            currency: "SGD",
            period: "thisweek",
            totals: {
                totalMinor: 5000,
                count: 2,
                needsReviewCount: 0,
            },
        });

        expect(text).toContain("This Week");
        expect(text).toContain("SGD 50.00");
        expect(text).toContain("2 expenses");
        expect(text).not.toContain("review");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/totals.test.ts`
Expected: FAIL — output still contains "Count:" and "Total:"

- [ ] **Step 3: Update formatTotalsMessage**

In `src/totals.ts`, replace the `formatTotalsMessage` function:

```typescript
export function formatTotalsMessage(input: {
    currency: string;
    totals: TotalsResult;
    period: TotalsPeriod;
}): string {
    const formattedTotal = formatMinorAsMoney(input.totals.totalMinor);
    const label = periodLabel(input.period);
    const lines = [
        `${label} — ${input.currency} ${formattedTotal}`,
        `${input.totals.count} expenses`,
    ];
    if (input.totals.needsReviewCount > 0) {
        lines.push(`${input.totals.needsReviewCount} need review`);
    }
    return lines.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/totals.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/totals.ts tests/totals.test.ts
git commit -m "feat: clean up totals formatter — remove redundant labels"
```

### Task 5: Onboarding copy — remove jargon

**Files:**
- Modify: `src/onboarding.ts:130-172`

No users know what "ISO 4217" means. The welcome and setup-complete messages should be friendly and clear.

- [ ] **Step 1: Update welcome message**

In `src/onboarding.ts`, update `sendCurrencyPrompt` (line ~131-148):

```typescript
async function sendCurrencyPrompt(env: Env, chatId: number) {
    await sendTelegramChatMessage(
        env,
        chatId,
        [
            "Welcome to Gastos — your expense tracker",
            "Send expenses as text, photo, or voice",
            "",
            "First, pick your currency:",
        ].join("\n"),
        {
            inline_keyboard: [
                PRIORITY_CURRENCIES.map((c) => ({ text: c, callback_data: `cur:${c}` })),
                ["BND", "KHR", "IDR"].map((c) => ({ text: c, callback_data: `cur:${c}` })),
                ["LAK", "MYR", "MMK"].map((c) => ({ text: c, callback_data: `cur:${c}` })),
                ["THB", "VND"].map((c) => ({ text: c, callback_data: `cur:${c}` })),
            ],
        }
    );
}
```

- [ ] **Step 2: Update currency retry message**

In `src/onboarding.ts`, update `sendCurrencyRetry` (line ~151-161):

```typescript
async function sendCurrencyRetry(env: Env, chatId: number) {
    await sendTelegramChatMessage(
        env,
        chatId,
        "Type a 3-letter currency code (e.g. PHP, SGD, USD, EUR) or pick one below:",
        {
            inline_keyboard: [
                PRIORITY_CURRENCIES.map((c) => ({ text: c, callback_data: `cur:${c}` })),
            ],
        }
    );
}
```

- [ ] **Step 3: Update setup complete message**

In `src/onboarding.ts`, update `sendOnboardingComplete` (line ~166-172):

```typescript
async function sendOnboardingComplete(env: Env, chatId: number, timezone: string, currency: string) {
    await sendTelegramChatMessage(
        env,
        chatId,
        [
            `All set — ${currency}, ${timezone}`,
            "",
            "Send me an expense to get started",
            "Or use /today, /thisweek, /thismonth to check totals",
        ].join("\n")
    );
}
```

- [ ] **Step 4: Update "finish onboarding" message**

In `src/onboarding.ts`, update the two places that say "Finish /start to enable totals." (lines ~54, 59):

Change to: `"Set up first — send /start"`

- [ ] **Step 5: Run full test suite**

Run: `npm run check && npm run test`
Expected: All tests PASS (onboarding tests check behavior, not exact copy)

- [ ] **Step 6: Commit**

```bash
git add src/onboarding.ts
git commit -m "feat: improve onboarding copy — remove jargon, friendlier tone"
```

### Task 6: Notification and error message tone

**Files:**
- Modify: `src/notifications.ts:195-211` (empty state message)
- Modify: `src/telegram/streaming.ts:6,8-13` (fallback text, tool status)
- Modify: `src/queue.ts:63-68,89,100,157` (error messages)

Minor copy consistency across error and notification messages.

- [ ] **Step 1: Update notification empty state message**

In `src/notifications.ts`, update `buildEmptyStateMessage` (line ~195-211):

```typescript
function buildEmptyStateMessage(type: NotificationType, now: Date): string {
    const fact = getFactForDay(now);
    const greeting =
        type === "morning" || type === "monthly" || type === "yearly"
            ? "Good morning — nothing logged yet"
            : "No expenses logged today";

    return [
        greeting,
        "",
        `"${fact.text}"`,
        `— ${fact.source}`,
    ].join("\n");
}
```

Changes: removed the pushy "Don't forget to log — just send me anything!" line, cleaner fact attribution with em dash, removed redundant prefix variable.

- [ ] **Step 2: Standardize error messages in queue.ts**

In `src/queue.ts`, update the user-facing error messages:

Line ~64-66 (quota exceeded):
```typescript
"You've hit your daily limit — try again tomorrow"
```

Line ~89 (transcription failed):
```typescript
"Couldn't transcribe that voice message — try sending it again"
```

Line ~100 (image retrieval failed):
```typescript
"Couldn't load that image — try sending it again"
```

Line ~157 (general error):
```typescript
"Something went wrong — try again"
```

- [ ] **Step 3: Update streaming fallback and tool status text**

In `src/telegram/streaming.ts`:

Line 6 (FALLBACK_TEXT):
```typescript
const FALLBACK_TEXT = "Something went wrong — try again";
```

Tool status map (lines 8-13) — these are fine as-is, just verify consistency:
```typescript
const TOOL_STATUS_MAP: Record<string, string> = {
    log_expense: "Logging your expense...",
    edit_expense: "Updating your expense...",
    delete_expense: "Deleting your expense...",
    get_financial_report: "Looking up your expenses...",
};
```

These are already consistent — no change needed.

- [ ] **Step 4: Update streaming test for new FALLBACK_TEXT**

In `tests/streaming.test.ts`, line 126, update the assertion:

```typescript
// Old: "I couldn't process that. Please try again."
"Something went wrong — try again",
```

- [ ] **Step 5: Run full test suite**

Run: `npm run check && npm run test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/notifications.ts src/queue.ts src/telegram/streaming.ts tests/streaming.test.ts
git commit -m "feat: standardize error and notification copy — consistent tone"
```

---

## Final Verification

- [ ] **Run full verification**

```bash
npm run check && npm run test
```

Expected: All tests PASS, no type errors, no regressions.
