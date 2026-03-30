# Mini App Polish — Execution Plan

## Batch A: Frontend-only improvements

### 1. Source type icons in transaction rows
- Add `message_type` to getExpenses SQL query (join source_events)
- Add to ExpenseWithDetails type (both backend + webapp)
- Show Lucide icons in TransactionRow: Mic (voice), Camera (photo), Type (text)

### 2. Day totals in feed headers
- TransactionList already groups by date
- Add sum of amount_minor per group, display as "Today — SGD 45.30"

### 3. Analytics: tag progress bars
- CategoryList rows: add horizontal bar (accent green, width = percentage%)

### 4. Analytics: top 3 expenses section
- Below tag breakdown, show "TOP EXPENSES" header + top 3 rows by amount

### 5. Tag suggestion chips in edit drawer
- Show user's allTags as tappable pills above the TagInput
- Tap to toggle (add/remove)

## Batch B: Backend + frontend

### 6. Media serving endpoint
- `GET /api/media/:sourceEventId` — streams R2 object to client
- Auth required (validate user owns the expense)
- Returns image with correct Content-Type

### 7. Receipt preview in edit sheet
- If r2_object_key exists, show thumbnail below source section
- Tap to open fullscreen overlay

### 8. Save voice transcription
- Add `transcript` TEXT column to source_events
- Save transcription result in queue.ts before passing to agent
- Show "Heard: ..." preview in edit sheet for voice expenses

## Execution order
A1 → A2 → A3 → A4 → A5 (all frontend, fast) → B6 → B7 → B8 (backend needed)
