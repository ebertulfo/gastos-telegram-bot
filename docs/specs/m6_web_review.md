# Specification: M6 Web Review Queue

## 1. Intent (The "What")
* **Goal**: To fix the unfinished "Review Queue" feature in the React Mini-App. 
* **Problem**: When the AI pipeline flags an expense because it's unsure of the extracted amount (e.g. `needs_review: true`), the React `DashboardScreen` correctly visually tags it with a red "Review" badge. However, there is no UX mechanism for the user to actually fix the amount and clear the flag.
* **UX Fix Scope**: We will introduce an interactive Slide-Out Drawer (or Dialog) that opens when a user taps a "needs review" expense. Inside, they can see the original text/image, edit the extracted amount/currency, and hit "Save", which transitions the expense to `status: 'final'`.

## 2. Architecture & Data Flow (The "How")
* **Current Backend**: `src/routes/api.ts` already exposes a robust `PUT /api/expenses/:id` endpoint that accepts an updated `amount_minor` and `currency`, and automatically upgrades the database row to `status: 'final'`. (Audit confirms no backend changes needed).
* **New React Component (`ReviewDrawer.tsx`)**:
    * A bottom sheet (using `vaul` or `shadcn/ui` Drawer) overlay.
    * **Inputs**: Two controlled input fields—`Amount` (number) and `Currency` (dropdown/select).
    * **Context**: Displays `expense.text_raw` or the original Telegram image so the user can verify what the AI parsed.
    * **Action**: A "Finalize & Save" button.
* **Flow**:
    1. User opens the Web App and sees 3 red "Review" badges.
    2. Taps an expense.
    3. `ReviewDrawer` slides up, auto-filled with the AI's *best guess* amount.
    4. User corrects the amount (e.g., changes `15.00` to `150.00`).
    5. User clicks Save.
    6. React calls `updateExpense(id, newAmount, newCurrency)`.
    7. React refreshes the local `expenses` state to remove the Review badge.

## 3. Data Contract (The Schema)
* **Frontend Payload** (sent via `api.ts` `updateExpense`):
    ```json
    {
      "amount_minor": 15000, 
      "currency": "PHP"
    }
    ```
* **Database Target**: `expenses.status` upgrades from `'needs_review'` to `'final'`.

## 4. Edge Cases & Constraints (The "What Not")
* **No Image Rendering Yet**: If the expense was a photo receipt uploaded to R2, we *will not* attempt to render the Presigned URL in the Drawer for Phase M6. We will only display the `parsed_description`. Handling secure R2 image retrieval into the React app is a complex networking task deferred to **M8 (Media Pre-signing)**.
* **No Deletion Yet**: The Drawer will strictly focus on *fixing/approving* the amount. Deleting an erroneous expense entirely will likely be handled via a red swipe-to-delete gesture row, and is outside the scope of this specific M6 review queue fix.

## 5. Acceptance Criteria
* [ ] Tapping a `needs_review` expense opens a Drawer.
* [ ] Drawer shows the raw text and editable Amount/Currency fields.
* [ ] Tapping Save fires a `PUT` request to `/api/expenses/:id`.
* [ ] The red "Review" badge disappears from the list upon successful DB update without requiring a hard refresh.
