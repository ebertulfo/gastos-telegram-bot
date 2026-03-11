# Tag & Date Editing Spec

## Goal

Add tag editing (with autosuggest from user history) and date editing (with preset buttons) to the Mini App's EditDrawer. Ensure Vectorize re-indexes on changes for RAG consistency.

## Design Decisions

- **Tag suggestions** — from user's own tag history (dedicated endpoint), cached client-side
- **Tag input UX** — pill input with inline filtered dropdown suggestions
- **Date picker UX** — preset buttons (Today, Yesterday, 2 days ago) + native date input fallback
- **Re-indexing** — always re-index on update (backend already does this)
- **No new dependencies** — native HTML inputs, no date/tag picker libraries

## Backend Changes

### New endpoint: `GET /api/tags`

Returns all unique tags for the authenticated user.

- Query: `SELECT DISTINCT tags FROM expenses WHERE user_id = ?` then parse JSON arrays and deduplicate across all expenses
- Response: `{ "tags": ["coffee", "lunch", "rent", ...] }`
- Sorted alphabetically

### Extend: `PUT /api/expenses/:id`

Add `occurred_at_utc` parameter:

- Accept ISO date string (YYYY-MM-DD format)
- Validate it's a real date
- Convert to UTC ISO: `new Date("${date}T12:00:00Z").toISOString()`
- Already handles `tags` (array of strings) — no change needed there

Re-indexing already happens on this endpoint for Vectorize. Tags are included in the embedding text (`description + category + tags.join(" ")`).

### New DB query module function

Add `getUserTags(db, userId)` to `src/db/expenses.ts` — extracts and deduplicates tags from all user expenses.

## Frontend Changes

### New component: `TagInput`

File: `webapp/src/components/TagInput.tsx`

Props:
- `tags: string[]` — current tags
- `allTags: string[]` — all user tags for autosuggest
- `onChange: (tags: string[]) => void`

Behavior:
- Existing tags rendered as pills with ✕ to remove
- "+ Add" button at end of pill row
- Tapping "+ Add" reveals text input below pills
- As user types, dropdown shows filtered matches from `allTags` (excluding selected)
- Tap suggestion or press Enter to add tag (lowercased, trimmed)
- Input auto-focuses on reveal, hides when empty and unfocused
- Constraints: max 30 chars, alphanumeric + hyphens + spaces only

### EditDrawer changes

File: `webapp/src/components/EditDrawer.tsx`

**Date section** (replaces read-only div):
- Current date displayed as tappable text (e.g., "Tue, Mar 11")
- Tapping reveals native `<input type="date">` with current value pre-filled
- Below date: row of preset pill buttons (Today, Yesterday, 2 days ago)
- Presets only shown if they differ from current expense date
- Selecting preset or picker updates local state immediately

**Tags section** (replaces read-only pills):
- Replace static pills with `TagInput` component
- Pass all user tags from cache as `allTags` prop

**Form state changes:**
- Add `tags: string[]` and `date: string` to form state
- Initialize from expense via `useEffect` keyed on `expense?.id`
- Save sends all fields: amount, currency, category, tags, occurred_at_utc

### API client changes

File: `webapp/src/lib/api.ts`

- Extend `updateExpense()` to accept `tags?: string[]` and `occurred_at_utc?: string`
- Add `fetchUserTags(): Promise<string[]>` function
- Tag cache: fetched once on app load, refreshed after any save

## Data Flow

### Tag suggestions
1. App loads → `fetchUserTags()` → cached in state
2. User taps "+ Add" → type → client-side filter against cache → dropdown
3. Select or Enter → pill added
4. New tags (not in history) allowed — just type and enter

### Date editing
1. Drawer opens → show current date + preset buttons
2. Tap preset → immediate state update
3. Tap date text → native picker → select → state update

### Save
1. User edits any fields → Save
2. `PUT /expenses/:id` with `{ amount_minor, currency, category, tags, occurred_at_utc }`
3. Backend validates, updates DB, re-indexes Vectorize
4. Drawer closes, expense list + tag cache refresh

## Files Changed

| File | Change |
|------|--------|
| `src/routes/api.ts` | Add GET /api/tags, add occurred_at_utc to PUT /expenses/:id |
| `src/db/expenses.ts` | Add getUserTags() function |
| `webapp/src/components/TagInput.tsx` | New component |
| `webapp/src/components/EditDrawer.tsx` | Add tag editing, date editing, form state |
| `webapp/src/lib/api.ts` | Extend updateExpense(), add fetchUserTags() |
| `webapp/src/lib/mock-data.ts` | Add mock tags for dev preview |
