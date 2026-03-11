# Tag & Date Editing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tag editing (with autosuggest from user history) and date editing (with preset buttons) to the Mini App's EditDrawer, with Vectorize re-indexing on changes.

**Architecture:** Three layers: (1) backend — new `GET /api/tags` endpoint + `occurred_at_utc` support on PUT, (2) frontend API — extend `updateExpense()` + add `fetchUserTags()`, (3) UI — new `TagInput` component + date presets in EditDrawer. No new dependencies or schema changes.

**Tech Stack:** Hono (backend), React 19, TypeScript, Tailwind CSS, vaul, D1 SQLite.

**Spec:** `docs/superpowers/specs/2026-03-11-tag-date-editing.md`

---

## File Structure

### New files to create:
| File | Purpose |
|------|---------|
| `webapp/src/components/TagInput.tsx` | Pill-based tag input with autosuggest dropdown |

### Files to modify:
| File | What changes |
|------|-------------|
| `src/db/expenses.ts` | Add `getUserTags()` function |
| `src/routes/api.ts` | Add `GET /api/tags` endpoint, add `occurred_at_utc` to PUT validation |
| `webapp/src/lib/api.ts` | Extend `updateExpense()`, add `fetchUserTags()` |
| `webapp/src/components/EditDrawer.tsx` | Add tag editing, date presets, proper form state init |
| `webapp/src/lib/mock-data.ts` | Add mock tags for dev preview |
| `tests/expenses.test.ts` | Add tests for `getUserTags()` |

### Files unchanged:
- `src/db/expenses.ts` `updateExpense()` — already accepts any column including `occurred_at_utc`
- Vectorize re-indexing in `src/routes/api.ts` — already runs on PUT, includes tags in metadata

---

## Chunk 1: Backend (tags endpoint + date support)

### Task 1: Add `getUserTags()` to expenses DB module

**Files:**
- Modify: `src/db/expenses.ts`
- Test: `tests/expenses.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/expenses.test.ts`:

```typescript
import { updateExpense, deleteExpense, getUserTags } from "../src/db/expenses";

// ... existing tests ...

describe("getUserTags", () => {
  it("extracts and deduplicates tags from all expenses", async () => {
    const all = vi.fn(async () => ({
      results: [
        { tags: '["coffee","lunch"]' },
        { tags: '["lunch","dinner"]' },
        { tags: '[]' },
      ],
    }));
    const bind = vi.fn(() => ({ all }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    const tags = await getUserTags(db, 7);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("SELECT"));
    expect(bind).toHaveBeenCalledWith(7);
    expect(tags).toEqual(["coffee", "dinner", "lunch"]);
  });

  it("returns empty array when no expenses", async () => {
    const all = vi.fn(async () => ({ results: [] }));
    const bind = vi.fn(() => ({ all }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    const tags = await getUserTags(db, 7);
    expect(tags).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/expenses.test.ts`
Expected: FAIL — `getUserTags` is not exported

- [ ] **Step 3: Implement `getUserTags`**

Add to `src/db/expenses.ts` (after `deleteExpense`):

```typescript
export async function getUserTags(db: D1Database, userId: number): Promise<string[]> {
    const { results } = await db.prepare(
        `SELECT tags FROM expenses WHERE user_id = ? AND tags != '[]'`
    )
        .bind(userId)
        .all<{ tags: string }>();

    const tagSet = new Set<string>();
    for (const row of results ?? []) {
        try {
            const parsed = JSON.parse(row.tags);
            if (Array.isArray(parsed)) {
                for (const tag of parsed) tagSet.add(tag);
            }
        } catch {
            // skip malformed JSON
        }
    }
    return Array.from(tagSet).sort();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/expenses.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/db/expenses.ts tests/expenses.test.ts
git commit -m "feat: add getUserTags() to extract unique tags from user expenses"
```

---

### Task 2: Add `GET /api/tags` endpoint and `occurred_at_utc` to PUT

**Files:**
- Modify: `src/routes/api.ts`

- [ ] **Step 1: Add tags endpoint and date support to PUT**

In `src/routes/api.ts`:

Add the import at the top (line 3):
```typescript
import { getExpenses, updateExpense, deleteExpense, getUserTags } from "../db/expenses";
```

Add the new endpoint after the `GET /expenses` route (after line 85):
```typescript
apiRouter.get("/tags", async (c) => {
    const tags = await getUserTags(c.env.DB, c.get("userId"));
    return c.json({ tags });
});
```

In the `PUT /expenses/:id` handler, add `occurred_at_utc` support. After the `tags` validation (after line 110):
```typescript
    const occurred_at_utc = body.occurred_at_utc;
    if (occurred_at_utc !== undefined && typeof occurred_at_utc !== "string") {
        return c.json({ error: "occurred_at_utc must be a date string (YYYY-MM-DD)" }, 400);
    }
```

And in the updateData building section (after line 116):
```typescript
    if (occurred_at_utc !== undefined) {
        updateData.occurred_at_utc = new Date(`${occurred_at_utc}T12:00:00Z`).toISOString();
    }
```

- [ ] **Step 2: Verify types**

Run: `npm run check`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `npm run test`
Expected: All existing tests pass (no test for the new endpoint since API routes are tested via integration)

- [ ] **Step 4: Commit**

```bash
git add src/routes/api.ts
git commit -m "feat: add GET /api/tags endpoint and occurred_at_utc to PUT /expenses/:id"
```

---

## Chunk 2: Frontend API + TagInput component

### Task 3: Extend frontend API client

**Files:**
- Modify: `webapp/src/lib/api.ts`
- Modify: `webapp/src/lib/mock-data.ts`

- [ ] **Step 1: Extend `updateExpense` and add `fetchUserTags`**

Replace the `updateExpense` function in `webapp/src/lib/api.ts`:

```typescript
export async function updateExpense(
    id: number,
    data: {
        amount_minor: number;
        currency: string;
        category?: string;
        tags?: string[];
        occurred_at_utc?: string;
    }
) {
    const res = await fetch(`${API_BASE_URL}/expenses/${id}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

export async function fetchUserTags(): Promise<string[]> {
    const res = await fetch(`${API_BASE_URL}/tags`, {
        headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json();
    return json.tags;
}
```

- [ ] **Step 2: Add mock tags to mock-data.ts**

Add to `webapp/src/lib/mock-data.ts`:

```typescript
export const MOCK_TAGS = [
    "breakfast", "clothing", "coffee", "commute", "delivery",
    "dinner", "groceries", "lunch", "medical", "monthly",
    "movies", "rent", "social", "work",
];
```

- [ ] **Step 3: Commit**

```bash
cd webapp && git add src/lib/api.ts src/lib/mock-data.ts
git commit -m "feat: extend updateExpense with tags/date, add fetchUserTags"
```

---

### Task 4: Create TagInput component

**Files:**
- Create: `webapp/src/components/TagInput.tsx`

- [ ] **Step 1: Create TagInput**

```tsx
import { useState, useRef, useEffect } from "react";

type TagInputProps = {
  tags: string[];
  allTags: string[];
  onChange: (tags: string[]) => void;
};

const TAG_REGEX = /^[a-zA-Z0-9\- ]+$/;
const MAX_TAG_LENGTH = 30;

export function TagInput({ tags, allTags, onChange }: TagInputProps) {
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState("");
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding && inputRef.current) inputRef.current.focus();
  }, [adding]);

  const suggestions = input.trim()
    ? allTags
        .filter((t) => t.toLowerCase().includes(input.toLowerCase()) && !tags.includes(t))
        .slice(0, 5)
    : [];

  const addTag = (tag: string) => {
    const cleaned = tag.toLowerCase().trim();
    if (!cleaned || cleaned.length > MAX_TAG_LENGTH || !TAG_REGEX.test(cleaned)) return;
    if (tags.includes(cleaned)) return;
    onChange([...tags, cleaned]);
    setInput("");
    setFocusedIdx(-1);
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (focusedIdx >= 0 && focusedIdx < suggestions.length) {
        addTag(suggestions[focusedIdx]);
      } else if (input.trim()) {
        addTag(input);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Escape") {
      setAdding(false);
      setInput("");
      setFocusedIdx(-1);
    }
  };

  const handleBlur = () => {
    // Delay to allow click on suggestion
    setTimeout(() => {
      if (!input.trim()) {
        setAdding(false);
        setFocusedIdx(-1);
      }
    }, 150);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
            style={{ background: "var(--surface)", color: "var(--text-secondary)" }}
          >
            #{tag}
            <button
              onClick={() => removeTag(tag)}
              className="ml-0.5 text-[10px] opacity-60 hover:opacity-100"
              style={{ color: "var(--text-secondary)" }}
            >
              ✕
            </button>
          </span>
        ))}
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-full border border-dashed px-2.5 py-1 text-xs"
            style={{ borderColor: "var(--text-secondary)", color: "var(--text-secondary)" }}
          >
            + Add
          </button>
        )}
      </div>

      {adding && (
        <div className="relative mt-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setFocusedIdx(-1);
            }}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            placeholder="Type a tag..."
            maxLength={MAX_TAG_LENGTH}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{
              background: "var(--surface-hover)",
              borderColor: "var(--border)",
              color: "var(--foreground)",
            }}
          />
          {suggestions.length > 0 && (
            <div
              className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border shadow-lg"
              style={{ background: "var(--background)", borderColor: "var(--border)" }}
            >
              {suggestions.map((s, i) => (
                <button
                  key={s}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addTag(s);
                  }}
                  className="block w-full px-3 py-2 text-left text-sm"
                  style={{
                    color: "var(--foreground)",
                    background: i === focusedIdx ? "var(--surface)" : "transparent",
                  }}
                >
                  #{s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `cd webapp && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd webapp && git add src/components/TagInput.tsx
git commit -m "feat: add TagInput component with pill editing and autosuggest dropdown"
```

---

## Chunk 3: EditDrawer integration

### Task 5: Rewrite EditDrawer with tag and date editing

**Files:**
- Modify: `webapp/src/components/EditDrawer.tsx`

- [ ] **Step 1: Rewrite EditDrawer**

Replace the entire content of `webapp/src/components/EditDrawer.tsx`:

```tsx
import { useState, useEffect } from "react";
import { Drawer } from "vaul";
import type { ExpenseWithDetails } from "../lib/types";
import { getCategoryConfig, getAllKnownCategories } from "../lib/categories";
import { formatAmountShort, parseTags } from "../lib/format";
import { updateExpense, deleteExpense } from "../lib/api";
import { TagInput } from "./TagInput";

type EditDrawerProps = {
  expense: ExpenseWithDetails | null;
  allTags: string[];
  onClose: () => void;
  onSaved: () => void;
};

function toDateString(isoDate: string): string {
  return isoDate.slice(0, 10);
}

function getPresets(): { label: string; value: string }[] {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const twoDaysAgo = new Date(now.getTime() - 2 * 86400000).toISOString().slice(0, 10);
  return [
    { label: "Today", value: today },
    { label: "Yesterday", value: yesterday },
    { label: "2 days ago", value: twoDaysAgo },
  ];
}

function formatDateDisplay(dateStr: string): string {
  return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function EditDrawer({ expense, allTags, onClose, onSaved }: EditDrawerProps) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const open = expense !== null;

  // Initialize form state when expense changes
  useEffect(() => {
    if (expense) {
      setAmount(formatAmountShort(expense.amount_minor));
      setCategory(expense.category);
      setTags(parseTags(expense.tags));
      setDate(toDateString(expense.occurred_at_utc));
      setShowDatePicker(false);
    }
  }, [expense?.id]);

  const handleOpen = (isOpen: boolean) => {
    if (!isOpen) {
      onClose();
    }
  };

  const handleSave = async () => {
    if (!expense) return;
    setSaving(true);
    try {
      const amountMinor = Math.round(parseFloat(amount) * 100);
      await updateExpense(expense.id, {
        amount_minor: amountMinor,
        currency: expense.currency,
        category,
        tags,
        occurred_at_utc: date,
      });
      onSaved();
      onClose();
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!expense || !confirm("Delete this expense?")) return;
    try {
      await deleteExpense(expense.id);
      onSaved();
      onClose();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const description = expense?.parsed_description || expense?.text_raw || "Unknown";
  const sourceType = expense?.r2_object_key
    ? "photo"
    : expense?.text_raw
      ? "text"
      : "unknown";
  const loggedTime = expense
    ? new Date(expense.occurred_at_utc).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  const presets = getPresets().filter((p) => p.value !== date);

  return (
    <Drawer.Root open={open} onOpenChange={handleOpen}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 flex flex-col rounded-t-xl"
          style={{ background: "var(--background)", maxHeight: "85vh" }}
        >
          <div className="overflow-y-auto px-4 pb-6 pt-3">
            {/* Drag handle */}
            <div className="mx-auto mb-4 h-1 w-9 rounded-full" style={{ background: "var(--border)" }} />

            {expense && (
              <>
                {/* Header */}
                <div className="mb-5 flex items-start justify-between">
                  <div>
                    <div className="text-xl font-bold" style={{ color: "var(--foreground)" }}>
                      {description}
                    </div>
                    <div className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                      Expense #{expense.id}
                    </div>
                  </div>
                  <div className="text-2xl font-bold" style={{ color: "var(--foreground)" }}>
                    {expense.currency} {amount}
                  </div>
                </div>

                {/* Editable fields */}
                <div className="flex flex-col gap-3.5">
                  {/* Category */}
                  <div>
                    <label className="mb-1 block text-[11px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                      Category
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full rounded-lg border px-3 py-2.5 text-sm"
                      style={{
                        background: "var(--surface-hover)",
                        borderColor: "var(--border)",
                        color: "var(--foreground)",
                      }}
                    >
                      {getAllKnownCategories().map((c) => {
                        const cfg = getCategoryConfig(c);
                        return (
                          <option key={c} value={c}>
                            {cfg.emoji} {c}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {/* Date */}
                  <div>
                    <label className="mb-1 block text-[11px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                      Date
                    </label>
                    <button
                      onClick={() => setShowDatePicker(!showDatePicker)}
                      className="w-full rounded-lg border px-3 py-2.5 text-left text-sm"
                      style={{
                        background: "var(--surface-hover)",
                        borderColor: "var(--border)",
                        color: "var(--foreground)",
                      }}
                    >
                      {date ? formatDateDisplay(date) : "Unknown"}
                    </button>
                    {showDatePicker && (
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => {
                          setDate(e.target.value);
                          setShowDatePicker(false);
                        }}
                        className="mt-1.5 w-full rounded-lg border px-3 py-2.5 text-sm"
                        style={{
                          background: "var(--surface-hover)",
                          borderColor: "var(--border)",
                          color: "var(--foreground)",
                        }}
                      />
                    )}
                    {presets.length > 0 && (
                      <div className="mt-1.5 flex gap-1.5">
                        {presets.map((p) => (
                          <button
                            key={p.value}
                            onClick={() => {
                              setDate(p.value);
                              setShowDatePicker(false);
                            }}
                            className="rounded-full px-2.5 py-1 text-[11px]"
                            style={{
                              background: "var(--surface)",
                              color: "var(--text-secondary)",
                            }}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Tags */}
                  <div>
                    <label className="mb-1 block text-[11px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                      Tags
                    </label>
                    <TagInput tags={tags} allTags={allTags} onChange={setTags} />
                  </div>

                  {/* Amount */}
                  <div>
                    <label className="mb-1 block text-[11px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                      Amount
                    </label>
                    <div className="flex gap-2">
                      <div
                        className="flex w-16 items-center justify-center rounded-lg border text-sm"
                        style={{
                          background: "var(--surface-hover)",
                          borderColor: "var(--border)",
                          color: "var(--foreground)",
                        }}
                      >
                        {expense.currency}
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="flex-1 rounded-lg border px-3 py-2.5 text-sm"
                        style={{
                          background: "var(--surface-hover)",
                          borderColor: "var(--border)",
                          color: "var(--foreground)",
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Source section */}
                <div className="mt-5 border-t pt-3.5" style={{ borderColor: "var(--border)" }}>
                  <div className="mb-1.5 text-[11px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                    Source
                  </div>
                  <div className="mb-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                    Logged via {sourceType} · {loggedTime}
                  </div>
                  {expense.text_raw && (
                    <div
                      className="rounded-md border-l-2 px-2.5 py-2 text-xs italic"
                      style={{
                        background: "var(--surface-hover)",
                        borderColor: "var(--border)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      "{expense.text_raw}"
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="mt-5">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="w-full rounded-lg py-3 text-sm font-semibold transition-opacity disabled:opacity-50"
                    style={{
                      background: "var(--primary)",
                      color: "var(--primary-foreground)",
                    }}
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={handleDelete}
                    className="mt-2 w-full py-2.5 text-sm"
                    style={{ color: "var(--destructive)" }}
                  >
                    Delete Expense
                  </button>
                </div>
              </>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
```

**Key changes from previous version:**
- `EditDrawerProps` now includes `allTags: string[]`
- Form state initialized via `useEffect` keyed on `expense?.id` (fixes the NaN bug permanently)
- Tags use `TagInput` component instead of static pills
- Date uses tappable display + preset buttons + native date picker
- `handleSave` sends all fields including tags and occurred_at_utc
- `updateExpense` call uses new object-based API signature

- [ ] **Step 2: Verify TypeScript**

Run: `cd webapp && npx tsc --noEmit`
Expected: FAIL — `EditDrawer` callers need to pass `allTags` prop. Fix in next task.

- [ ] **Step 3: Commit**

```bash
cd webapp && git add src/components/EditDrawer.tsx
git commit -m "feat: rewrite EditDrawer with tag editing, date presets, and proper form state"
```

---

### Task 6: Update screens to pass `allTags` and fetch tags

**Files:**
- Modify: `webapp/src/screens/DashboardScreen.tsx`
- Modify: `webapp/src/screens/AnalyticsScreen.tsx`

- [ ] **Step 1: Update DashboardScreen**

In `webapp/src/screens/DashboardScreen.tsx`, add tag fetching and pass `allTags` to `EditDrawer`.

Add import:
```typescript
import { fetchExpenses, fetchUserProfile, fetchUserTags } from "../lib/api";
import { MOCK_EXPENSES, MOCK_TAGS } from "../lib/mock-data";
```

Add state:
```typescript
const [allTags, setAllTags] = useState<string[]>([]);
```

Add tag fetching in the existing `useEffect` for profile, or add a new one:
```typescript
useEffect(() => {
  fetchUserTags().then(setAllTags).catch(() => {
    if (import.meta.env.DEV) setAllTags(MOCK_TAGS);
  });
}, []);
```

Refresh tags after save — change the `onSaved` callback:
```typescript
const handleSaved = useCallback(() => {
  loadExpenses();
  fetchUserTags().then(setAllTags).catch(() => {});
}, [loadExpenses]);
```

Update `EditDrawer` usage:
```tsx
<EditDrawer
  expense={selectedExpense}
  allTags={allTags}
  onClose={() => setSelectedExpense(null)}
  onSaved={handleSaved}
/>
```

Also update the `updateExpense` call — since we changed its signature, update the existing callers. But `EditDrawer` is the only caller via `handleSave`, so only the drawer needs updating (already done in Task 5).

- [ ] **Step 2: Update AnalyticsScreen**

Same pattern. In `webapp/src/screens/AnalyticsScreen.tsx`:

Add import:
```typescript
import { fetchExpenses, fetchUserProfile, fetchUserTags } from "../lib/api";
import { MOCK_EXPENSES, MOCK_TAGS } from "../lib/mock-data";
```

Add state:
```typescript
const [allTags, setAllTags] = useState<string[]>([]);
```

Add tag fetching:
```typescript
useEffect(() => {
  fetchUserTags().then(setAllTags).catch(() => {
    if (import.meta.env.DEV) setAllTags(MOCK_TAGS);
  });
}, []);
```

Add handleSaved:
```typescript
const handleSaved = useCallback(() => {
  loadExpenses();
  fetchUserTags().then(setAllTags).catch(() => {});
}, [loadExpenses]);
```

Update both `EditDrawer` usages (overview and drill-down) to pass `allTags` and use `handleSaved`:
```tsx
<EditDrawer
  expense={selectedExpense}
  allTags={allTags}
  onClose={() => setSelectedExpense(null)}
  onSaved={handleSaved}
/>
```

- [ ] **Step 3: Verify TypeScript**

Run: `cd webapp && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Build**

Run: `cd webapp && npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd webapp && git add src/screens/DashboardScreen.tsx src/screens/AnalyticsScreen.tsx
git commit -m "feat: wire tag fetching and pass allTags to EditDrawer in both screens"
```

---

## Chunk 4: Verification

### Task 7: Full verification

- [ ] **Step 1: Run backend type check and tests**

```bash
npm run check && npm run test
```

Expected: All pass (81+ passing, 4 pre-existing Agents SDK failures are OK)

- [ ] **Step 2: Run webapp build**

```bash
cd webapp && npm run build
```

Expected: Build succeeds

- [ ] **Step 3: Dev preview**

```bash
cd webapp && npm run dev
```

Open http://localhost:5173. Verify:
- Dashboard loads with mock data
- Tap a transaction → EditDrawer opens
- Tags section shows pills with ✕ buttons
- Tapping "+ Add" shows input with autosuggest dropdown
- Typing filters suggestions, Enter/tap adds tag
- Date shows preset buttons (Today, Yesterday, 2 days ago)
- Tapping preset updates the date
- Tapping date text shows native date picker
- Save button works without errors in console

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A && git commit -m "fix: resolve any build/lint issues from tag-date editing"
```
