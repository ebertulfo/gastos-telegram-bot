# Phase 1: iOS Alignment — Execution Plan

**Parent PRD:** [2026-03-30-ios-alignment-prd.md](./2026-03-30-ios-alignment-prd.md)
**Scope:** Tags over categories, description editing, tag preferences, voice guide, onboarding redesign

---

## Step 1: Schema Migrations

### 1a. Add description column + backfill

```sql
-- migrations/0010_add_description.sql
ALTER TABLE expenses ADD COLUMN description TEXT;

-- Backfill from parse_results
UPDATE expenses SET description = (
  SELECT JSON_EXTRACT(pr.parsed_json, '$.description')
  FROM parse_results pr
  JOIN source_events se ON pr.source_event_id = se.id
  WHERE se.id = expenses.source_event_id
);
```

**Files changed:**
- `migrations/0010_add_description.sql` (new)
- `src/db/expenses.ts` — update `insertExpense()` to accept + store description, update `getExpenses()` and `getRecentExpenses()` to read from `e.description` instead of `JSON_EXTRACT`
- `src/db/expenses.ts` — add `description` to `ALLOWED_UPDATE_COLUMNS` in update function
- `src/routes/api.ts` — allow `description` in PUT /expenses/:id

### 1b. Create user_tag_preferences table

```sql
-- migrations/0011_user_tag_preferences.sql
CREATE TABLE user_tag_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  tag TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'onboarding',
  created_at_utc TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, tag)
);
CREATE INDEX idx_user_tag_prefs ON user_tag_preferences(user_id);
```

**Files changed:**
- `migrations/0011_user_tag_preferences.sql` (new)
- `src/db/` — new module `tag-preferences.ts` (insert, get, delete for user tags)

### 1c. Migrate category → tags + drop column

```sql
-- migrations/0012_drop_category.sql
-- Category-to-tags data migration runs via one-time endpoint BEFORE this migration
ALTER TABLE expenses DROP COLUMN category;
```

**One-time migration endpoint** (temporary, in `src/app.ts`):
- `POST /admin/migrate-categories-to-tags` (gated behind admin auth)
- Reads all expenses with non-null, non-"Other" category
- For each: parse tags JSON array, prepend lowercase category if not already present, write back
- Returns count of migrated rows
- Remove endpoint after migration completes

**Files changed:**
- `migrations/0012_drop_category.sql` (new)
- `src/app.ts` — temporary migration endpoint (removed after deploy)
- `src/db/expenses.ts` — remove all `category` references from queries and types

---

## Step 2: AI Tools Rewrite

### 2a. log_expense tool

**Remove:** `category` parameter
**Update:** `tags` — increase max from 3 to 5, make it the primary grouping
**Add:** `merchant` — defer to Phase 3 (don't add yet, keep scope tight)
**Keep:** amount, currency, description, occurred_at

**Changes in `src/ai/tools.ts`:**
- Remove `CATEGORIES` constant
- Remove `category` from log_expense parameter schema
- Remove category from `insertExpense()` call
- Store `description` in expenses table (new column from Step 1a)
- Update return format: `"Logged SGD 12.50 — Lunch (food, coffee)"` (tags in parens, not category)

### 2b. edit_expense tool

**Remove:** `category` parameter
**Add:** `tags` parameter (array, nullable)
**Enable:** `description` parameter (was blocked, now stored on expenses table)

**Changes:**
- Remove category from parameter schema
- Add tags to parameter schema and update logic
- Remove "Description editing is not yet supported" guard
- Update description in expenses table directly

### 2c. get_financial_report tool

**Replace category grouping with tag grouping:**

```typescript
// Group by tag (an expense appears in every tag group it has)
const tagGroups: Record<string, { totalMinor: number; count: number; items: string[] }> = {};
for (const e of expenses) {
  const tags: string[] = JSON.parse(e.tags || "[]");
  if (tags.length === 0) tags.push("untagged");
  for (const tag of tags) {
    if (!tagGroups[tag]) tagGroups[tag] = { totalMinor: 0, count: 0, items: [] };
    tagGroups[tag].totalMinor += e.amount_minor;
    tagGroups[tag].count++;
    // ... items
  }
}
```

**Replace category filter with tag filter:**
```typescript
if (tag_query) {
  expenses = expenses.filter(e => {
    const tags: string[] = JSON.parse(e.tags || "[]");
    return tags.some(t => t.toLowerCase().includes(tag_query.toLowerCase()));
  });
}
```

**Remove:** `category` parameter from tool schema
**Rename:** `category` filter → `tag` filter (single tag string)

---

## Step 3: System Prompt Rewrite

**File:** `src/ai/agent.ts` — `buildSystemPrompt()`

### 3a. Voice guide personality

Add at the top:
```
You are Gastos — an expense tracker that's fast, honest, and doesn't waste your time.
Personality: Direct, calm, occasionally cheeky. You're a friend who's good with money.

Rules:
- Never say "comprehensive", "robust", or "game-changing"
- Use "expenses" not "transactions", "tags" not "categories"
- Use "log" or "track", not "record" or "enter"
```

### 3b. Tag extraction (replaces category mapping)

Remove the entire CATEGORY MAPPING section. Replace with:
```
TAGS:
- Extract 1-3 relevant tags from the description. Use lowercase.
- Common tags: food, transport, groceries, shopping, coffee, entertainment, health, bills, travel, subscriptions
- Prefer the user's established tags when they fit: {userTopTags}
- Tags are freeform — use whatever fits the expense
- Examples: "starbucks latte" → tags: ["coffee", "food"]. "grab to office" → tags: ["transport"]
```

### 3c. Response format updates

```
Logging: Logged SGD 12.50 — Lunch (food, coffee)
Multiple: Logged SGD 5.60 — Coffee (coffee, food)
          Logged SGD 1.20 — Bread (groceries)
Edit: Updated Lunch — amount now SGD 2.80
Delete: Deleted Lunch
Report: You spent SGD 150.00 this week (5 expenses)
        By tag: food SGD 89.23, transport SGD 35.00, coffee SGD 25.77
```

### 3d. Dynamic context

Add to `buildSystemPrompt()` signature: `userTopTags: string[]`

Query at call site (queue.ts):
```sql
SELECT LOWER(value) as tag, COUNT(*) as cnt
FROM expenses, json_each(expenses.tags)
WHERE user_id = ? AND tags != '[]'
GROUP BY LOWER(value)
ORDER BY cnt DESC
LIMIT 10
```

---

## Step 4: Onboarding Redesign

**File:** `src/onboarding.ts`

### 4a. New state: `awaiting_tags`

After currency selection, instead of completing:
- Set `onboarding_step = "awaiting_tags"`
- Send tag selection message with inline keyboard

### 4b. Tag selection message

```
Pick the tags you use most — or skip and Gastos will learn as you go.
```

Inline keyboard (2 rows of 5):
```
[food] [transport] [groceries] [shopping] [coffee]
[entertainment] [health] [bills] [travel] [subscriptions]
[Skip →]
```

Tags are toggleable (callback: `tag:food`, `tag:transport`, etc.). Selecting a tag toggles it on/off. A "Done" button appears after at least 1 tag is selected.

### 4c. Tag confirmation + completion

When user taps "Done" or "Skip":
- Insert selected tags into `user_tag_preferences` (source: "onboarding")
- Set `onboarding_step = "completed"`
- Send completion message

### 4d. Updated messages

```
Message 1 (on /start):
"You can't improve what you don't track.

Gastos helps you log expenses in seconds — type, snap a receipt, or send a voice message. Let's get you set up.

What currency do you use most?"
[PHP] [SGD] [USD] [EUR]
[More currencies...]

Message 2 (after currency):
"Pick the tags you use most — or skip and Gastos will learn as you go."
[food] [transport] [groceries] ...
[Skip →]

Message 3 (completion):
"You're all set. Now make yourself proud.

Send me an expense — or use /today, /thisweek, /thismonth to check totals."
```

---

## Step 5: Bot Response Format Updates

**Files:** `src/queue.ts`, `src/onboarding.ts`

### 5a. Recent expenses context (queue.ts)

Change format from:
```
#123 Mon — SGD 12.50 — Lunch (Food)
```
To:
```
#123 Mon — SGD 12.50 — Lunch (food, coffee)
```

### 5b. Totals messages (onboarding.ts)

Keep current format — totals don't reference categories:
```
This Week — SGD 234.56
5 expenses
2 need review
```

No change needed.

---

## Step 6: Test Updates

### Tests to modify:
- `tools.test.ts` — Remove category from log_expense calls, add tags, update expected outputs
- `tools.test.ts` — Update get_financial_report expectations (tag grouping instead of category)
- `tools.test.ts` — Add test for description editing via edit_expense
- `webhook.test.ts` — Update mock DB prepare branches (remove category references)
- `onboarding.test.ts` — Add test for `awaiting_tags` state + tag selection flow
- `queue.test.ts` — Update recent expenses format expectation

### New tests:
- `tag-preferences.test.ts` — CRUD for user_tag_preferences
- Tag grouping logic (double-counting behavior)
- Description backfill verification

---

## Step 7: Mini App API Updates

**Files:** `src/routes/api.ts`, `webapp/src/lib/types.ts`

### 7a. API response changes

- Remove `category` from expense response type
- Ensure `tags` is returned as parsed array (not JSON string)
- Ensure `description` is returned from expenses table
- Allow `description` and `tags` in PUT /expenses/:id

### 7b. Mini App type changes

- Remove `category` from `ExpenseWithDetails` type
- Add `description` field
- Update `tags` type from `string` (JSON) to `string[]`

**Note:** Mini App component redesign (tag pills, analytics) is Phase 2. Phase 1 just ensures the API contract is correct.

---

## Execution Order

```
1. Schema migrations (1a → 1b → 1c)     — branch: feature/phase1-ios-alignment
   ├── 1a: description column + backfill
   ├── 1b: user_tag_preferences table
   └── 1c: category migration endpoint + drop column
2. AI tools rewrite (2a, 2b, 2c)         — depends on 1
3. System prompt rewrite (3a-3d)          — depends on 2
4. Onboarding redesign (4a-4d)           — depends on 1b
5. Response format updates (5a-5b)        — depends on 2
6. Test updates (all)                     — alongside each step
7. Mini App API updates (7a-7b)           — depends on 1
```

Steps 2+3+4+5 can be developed in parallel after Step 1 is done.

---

## Out of Scope (deferred to later phases)

- Mini App component redesign (Phase 2)
- Merchant field (Phase 3)
- Travel Mode (Phase 3)
- Export (Phase 3)
- Smart tag learning / tag_associations table (Phase 3)
- Motion/animation (Phase 4)
