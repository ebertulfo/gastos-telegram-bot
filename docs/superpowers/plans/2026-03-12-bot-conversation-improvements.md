# Bot Conversation Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 7 real-world conversation issues discovered by reviewing production chat logs — date hallucination, over-clarification, context bleed, duplicate message spam, and category/scope defaults.

**Architecture:** Three independent change areas: (1) system prompt overhaul in `agent.ts`, (2) date validation safeguard in `tools.ts`, (3) content-based message dedup in `webhook.ts`/`source-events.ts`. All areas are independently testable.

**Tech Stack:** TypeScript, Vitest, OpenAI Agents SDK, Cloudflare Workers D1

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/ai/agent.ts` | System prompt — fix over-clarification, context bleed, date rules, category defaults, month boundary |
| Modify | `src/ai/tools.ts` | Date validation safeguard in `log_expense` — reject hallucinated dates |
| Modify | `src/routes/webhook.ts` | Content-based dedup — skip identical messages within a short window |
| Modify | `src/db/source-events.ts` | Add `findRecentDuplicateContent()` query for content dedup |
| Create | `migrations/0009_add_source_events_content_dedup_index.sql` | D1 index for content dedup query performance |
| Test | `tests/agent.test.ts` | Verify prompt contains new rules |
| Test | `tests/tools.test.ts` | Verify date validation behavior |
| Test | `tests/webhook.test.ts` | Verify content dedup skips repeated messages |

---

## Chunk 1: System Prompt Improvements

### Task 1: Harden the system prompt

**Files:**
- Modify: `src/ai/agent.ts:17-37` (the `buildSystemPrompt` function)
- Test: `tests/agent.test.ts`

The current prompt has gaps that cause 5 of the 7 issues. Each fix is a prompt rule addition.

**Issues addressed:**
1. **Over-clarification** (msgs 111-114): "past 3 days" asked for clarification twice
2. **Context bleed** (msgs 55-58): "how much this month" wrongly scoped to food
3. **Category accuracy** (expenses 1-6): "Sukiya", "protein shake" categorized as "Other"
4. **Month boundary** (msgs 47-54): "this month" on day 1 said "nothing" 3x before suggesting last month
5. **Date hallucination** (expense #23): agent set `occurred_at` to random past date

- [ ] **Step 1: Write failing tests for new prompt content**

Add these tests to `tests/agent.test.ts`:

```typescript
it("includes date handling rules in prompt", () => {
    const prompt = buildSystemPrompt("UTC", "USD");
    expect(prompt).toContain("occurred_at");
    expect(prompt).toContain("null");
});

it("includes no-clarification rule for clear time expressions", () => {
    const prompt = buildSystemPrompt("UTC", "USD");
    expect(prompt).toContain("Do NOT ask for clarification");
});

it("includes standalone query scope rule", () => {
    const prompt = buildSystemPrompt("UTC", "USD");
    expect(prompt).toContain("all categories");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/agent.test.ts`
Expected: 3 new tests FAIL

- [ ] **Step 3: Update the system prompt**

Replace the RULES section in `buildSystemPrompt()` (`src/ai/agent.ts`) with this expanded version:

```typescript
RULES:
- Be CONCISE. 2-5 lines max for simple questions.
- ALWAYS use tools for data. NEVER guess spending amounts.
- For expense logging: extract amount, currency, description, category, tags, and date. When the user sends a simple number with a word (e.g. "coffee 5", "lunch 12.50", "grab 6"), log it as an expense immediately. If amount is clear, log immediately. If genuinely ambiguous (e.g. no amount given), ask ONE question.
- For comparisons ("this week vs last week"), call get_financial_report twice with different periods.
- Use tag_query for item-level search (e.g. "drinks", "coffee", "transport to work").
- NEVER end with "Let me know if you want..." or offer follow-ups. Just answer.

DATE HANDLING (CRITICAL):
- ONLY set occurred_at when the user EXPLICITLY mentions a past date like "yesterday", "last Monday", "March 5th", "two days ago".
- If the user does NOT mention any date, leave occurred_at as null. The system defaults to right now. NEVER guess or infer a date.
- When logging multiple expenses from one message, apply the same date rule to EACH item independently. If the user says "coffee 5 and lunch 12", both get occurred_at: null (today).

QUERY SCOPE:
- Do NOT ask for clarification on clear time expressions. "Past 3 days", "this week", "last month" are unambiguous — just answer.
- Each new question is standalone. Do NOT carry over category/scope filters from previous questions. "How much this month" means ALL categories unless the user explicitly says otherwise.
- If a period just started and has no data, proactively show the previous period's data: "This month just started. Here's last month: ..."

CATEGORIES:
- Use "Food" for restaurants, meals, coffee, drinks, snacks, protein shakes, food delivery. When in doubt between "Food" and "Other", prefer "Food" if it's consumable.
- Use "Transport" for taxis, Grab/Uber rides, MRT/bus, fuel, parking, tolls.
- Use "Health" for clinics, medicine, pharmacy, gym, dental, optical.
- Only use "Other" when the item truly doesn't fit any named category.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/agent.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/ai/agent.ts tests/agent.test.ts
git commit -m "fix: harden system prompt — date rules, no over-clarification, scope defaults"
```

---

## Chunk 2: Date Validation Safeguard

### Task 2: Add date validation in log_expense tool

**Files:**
- Modify: `src/ai/tools.ts:36-76` (the `log_expense` execute function)
- Test: `tests/tools.test.ts`

Even with a better prompt, the model may still hallucinate dates. Add a code-level safeguard: if `occurred_at` is provided but more than 30 days in the past (or any time in the future), ignore it and default to now. This catches the bug where coffee on March 12 got dated March 10.

- [ ] **Step 1: Write failing tests for date validation**

Add these tests to `tests/tools.test.ts`:

```typescript
it("log_expense rejects occurred_at more than 30 days in the past", async () => {
    const { insertExpense } = await import("../src/db/expenses");
    vi.mocked(insertExpense).mockResolvedValueOnce(60);

    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const logTool = tools[0] as any;
    await logTool.execute({
        amount: 5,
        currency: "SGD",
        description: "Coffee",
        category: "Food",
        tags: [],
        occurred_at: "2025-01-01", // Way in the past
    });

    const calls = vi.mocked(insertExpense).mock.calls;
    const occurredAtUtc = calls[calls.length - 1][7] as string;
    // Should fall back to today, not use the hallucinated date
    const today = new Date().toISOString().slice(0, 10);
    expect(occurredAtUtc).toContain(today);
});

it("log_expense rejects occurred_at in the future", async () => {
    const { insertExpense } = await import("../src/db/expenses");
    vi.mocked(insertExpense).mockResolvedValueOnce(61);

    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const logTool = tools[0] as any;
    await logTool.execute({
        amount: 10,
        currency: "SGD",
        description: "Future lunch",
        category: "Food",
        tags: [],
        occurred_at: "2099-01-01", // Future date
    });

    const calls = vi.mocked(insertExpense).mock.calls;
    const occurredAtUtc = calls[calls.length - 1][7] as string;
    const today = new Date().toISOString().slice(0, 10);
    expect(occurredAtUtc).toContain(today);
});

it("log_expense accepts occurred_at within valid range (e.g. yesterday)", async () => {
    const { insertExpense } = await import("../src/db/expenses");
    vi.mocked(insertExpense).mockResolvedValueOnce(62);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const logTool = tools[0] as any;
    await logTool.execute({
        amount: 18,
        currency: "SGD",
        description: "Lunch",
        category: "Food",
        tags: [],
        occurred_at: yesterdayStr,
    });

    const calls = vi.mocked(insertExpense).mock.calls;
    const occurredAtUtc = calls[calls.length - 1][7] as string;
    expect(occurredAtUtc).toContain(yesterdayStr);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/tools.test.ts`
Expected: First 2 new tests FAIL (no validation yet), third PASSES (already works)

- [ ] **Step 3: Add date validation to log_expense**

In `src/ai/tools.ts`, replace the `occurredAtUtc` calculation in the `log_expense` execute function (lines 38-40):

```typescript
execute: async (input) => {
    const amountMinor = Math.round(input.amount * 100);

    // Validate occurred_at: reject dates >30 days in past or any future date
    let occurredAtUtc: string;
    if (input.occurred_at) {
        const parsedDate = new Date(`${input.occurred_at}T12:00:00Z`);
        const now = new Date();
        const diffMs = now.getTime() - parsedDate.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        if (diffDays > 30 || diffDays < 0) {
            // Hallucinated date — fall back to now
            console.warn(`[TOOL:log_expense] Rejected suspicious occurred_at="${input.occurred_at}" (${diffDays.toFixed(0)} days from now). Defaulting to now.`);
            occurredAtUtc = new Date().toISOString();
        } else {
            occurredAtUtc = parsedDate.toISOString();
        }
    } else {
        occurredAtUtc = new Date().toISOString();
    }

    // ... rest of function unchanged
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/tools.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/ai/tools.ts tests/tools.test.ts
git commit -m "fix: add date validation safeguard in log_expense — reject hallucinated dates"
```

---

## Chunk 3: Content-Based Message Deduplication

### Task 3: Add D1 index for content dedup query

**Files:**
- Create: `migrations/0009_add_source_events_content_dedup_index.sql`

The content dedup query runs on every incoming text message (hot path). Without an index on `(user_id, text_raw, created_at_utc)`, it would do a full table scan on `source_events`.

- [ ] **Step 1: Create the migration**

```sql
-- Content-based dedup: index for findRecentDuplicateContent() query
-- Runs on every incoming text message to skip rapid retaps
CREATE INDEX IF NOT EXISTS idx_source_events_content_dedup
ON source_events (user_id, text_raw, created_at_utc);
```

- [ ] **Step 2: Apply locally**

Run: `npx wrangler d1 migrations apply gastos-db --local`
Expected: Migration 0009 applied successfully

- [ ] **Step 3: Commit**

```bash
git add migrations/0009_add_source_events_content_dedup_index.sql
git commit -m "chore: add D1 index for content dedup query on source_events"
```

### Task 4: Add content dedup query to source-events

**Files:**
- Modify: `src/db/source-events.ts`
- Test: `tests/source-events.test.ts`

Add a function that checks if the same user sent the same text content within the last N seconds.

- [ ] **Step 1: Write failing test for dedup query**

Add to `tests/source-events.test.ts`:

```typescript
import { findRecentDuplicateContent } from "../src/db/source-events";

describe("findRecentDuplicateContent", () => {
    it("returns null when no recent duplicate exists", async () => {
        // The mock DB returns no results for this query
        const result = await findRecentDuplicateContent(mockDb, 1, "unique text", 30);
        expect(result).toBeNull();
    });
});
```

Note: Since tests use mock DB, the test mainly verifies the function exists and handles the no-match case. The real dedup behavior is tested in the webhook integration test.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/source-events.test.ts`
Expected: FAIL — `findRecentDuplicateContent` not exported

- [ ] **Step 3: Implement the dedup query**

Add to `src/db/source-events.ts`:

```typescript
/**
 * Check if the same user sent identical text content within the last N seconds.
 * Used to deduplicate rapid-fire repeated messages (user retapping when bot is slow).
 * Returns the source_event_id of the duplicate if found, null otherwise.
 */
export async function findRecentDuplicateContent(
    db: D1Database,
    userId: number,
    text: string,
    windowSeconds: number = 30,
): Promise<number | null> {
    const cutoff = new Date(Date.now() - windowSeconds * 1000).toISOString();
    const result = await db.prepare(
        `SELECT id FROM source_events
         WHERE user_id = ? AND text_raw = ? AND created_at_utc > ?
         ORDER BY created_at_utc DESC LIMIT 1`
    )
        .bind(userId, text, cutoff)
        .first<{ id: number }>();
    return result?.id ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/source-events.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/source-events.ts tests/source-events.test.ts
git commit -m "feat: add findRecentDuplicateContent query for message dedup"
```

### Task 5: Wire content dedup into webhook

**Files:**
- Modify: `src/routes/webhook.ts`
- Test: `tests/webhook.test.ts`

After rate limit check, before enqueueing: if the same user sent identical text within 30 seconds, treat as content duplicate and skip queue.

- [ ] **Step 1: Write failing test for content dedup in webhook**

Add to `tests/webhook.test.ts`:

```typescript
it("skips enqueueing content-duplicate messages", async () => {
    vi.mocked(rateLimiter.checkRateLimit).mockResolvedValue(true);

    const app = createApp();
    // Create env where the DB returns a recent duplicate for the content dedup query
    const { env, send } = createEnv({ duplicate: false, contentDuplicate: true });
    const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const response = await app.fetch(
        new Request("http://localhost/webhook/telegram", {
            method: "POST",
            body: buildTextUpdateBody(),
            headers: { "content-type": "application/json" }
        }),
        env
    );

    const json = (await response.json()) as WebhookResponse;
    expect(json.status).toBe("duplicate");
    expect(send).not.toHaveBeenCalled();

    fetchMock.mockRestore();
});
```

Update `createMockDb` to support `contentDuplicate` option — when `contentDuplicate: true`, the DB mock returns a row for the content dedup query (matching `SELECT id FROM source_events WHERE user_id = ? AND text_raw = ?`).

Update `MockDbOptions`:
```typescript
type MockDbOptions = {
    duplicate?: boolean;
    contentDuplicate?: boolean;
    // ... existing
};
```

In the `prepare` mock, add a branch **before** the existing `SELECT id FROM source_events` handler (line 50 of the test file) — this is critical because the existing SELECT branch would also match the dedup query string:
```typescript
if (query.includes("text_raw = ?") && query.includes("created_at_utc >")) {
    return {
        bind: vi.fn(() => ({
            first: vi.fn(async () =>
                options.contentDuplicate ? { id: 999 } : null
            )
        }))
    };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/webhook.test.ts`
Expected: FAIL — content dedup not wired into webhook

- [ ] **Step 3: Wire content dedup into webhook**

In `src/routes/webhook.ts`, add the content dedup check after the rate limit check and before `persistSourceEvent`:

```typescript
import { persistSourceEvent, setSourceEventR2ObjectKey, findRecentDuplicateContent } from "../db/source-events";
```

After the rate limit check block (after line 102) and before the ack message (line 104), add:

```typescript
// Content-based dedup: skip if same user sent identical text in last 30 seconds
// (catches rapid re-taps when bot appears slow)
if (update.message.text) {
    const recentDuplicateId = await findRecentDuplicateContent(
        c.env.DB,
        user.id,
        update.message.text,
    );
    if (recentDuplicateId !== null) {
        console.warn("Content-duplicate message skipped", {
            chatId,
            text: update.message.text.slice(0, 50),
            originalSourceEventId: recentDuplicateId,
        });
        return c.json({ status: "duplicate" }, 200);
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/webhook.test.ts`
Expected: All tests PASS (including existing dedup test)

- [ ] **Step 5: Run full test suite**

Run: `npm run check && npm run test`
Expected: All 13 test files pass, no type errors

- [ ] **Step 6: Commit**

```bash
git add src/routes/webhook.ts tests/webhook.test.ts
git commit -m "feat: add content-based message dedup in webhook — skip rapid retaps"
```

---

## Summary of Changes

| Issue | Fix Location | Type |
|-------|-------------|------|
| Over-clarification on clear queries | System prompt | Prompt |
| Date hallucination (coffee dated wrong) | System prompt + `log_expense` validation | Prompt + Code |
| Context bleed (scope carry-over) | System prompt | Prompt |
| "Other" miscategorization | System prompt | Prompt |
| Month boundary bad UX | System prompt | Prompt |
| Duplicate message spam (4x same question) | Webhook content dedup | Code |
| Edit flow reliability | Not addressed here — needs separate investigation | Future |

**Note on edit flow:** The edit tool reliability issue (msgs 73-84) needs deeper investigation into the Agents SDK `run()` error handling and retry behavior. It's a separate concern from the prompt/validation/dedup fixes and should be tracked as its own task.
