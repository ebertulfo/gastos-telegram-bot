# Specification: M7 Expense Categories

## 1. Intent (The "What")
* **Goal**: To intelligently categorize expenses parsed by the AI into strict, high-level buckets (e.g., Food, Transport) and visualize spending breakdowns in the React Mini-app.
* **Problem**: Unbounded AI "tags" (e.g., `#starbucks`, `#coffee`) create noisy datasets that are impossible to chart accurately. 
* **UX Fix Scope**: We will force the AI to select from a strict union of predefined categories. If it is unsure, it will select `Other` and set `needs_review: true`. We will then build a new "Analytics" tab in the React app featuring a Donut Chart/List to visualize spending by category.

## 2. Architecture & Data Flow (The "How")

### 2.1 The Categories List
We will define a strict set of global categories:
* `Food` (Groceries, Dining out, Coffee)
* `Transport` (Gas, Fares, Parking)
* `Housing` (Rent, Utilities, Maintenance)
* `Shopping` (Clothing, Electronics)
* `Entertainment` (Movies, Games, Subscriptions)
* `Health` (Medical, Pharmacy, Fitness)
* `Other` (Misc. or Unknown)

### 2.2 OpenAI Zod Schema (`src/ai/openai.ts`)
We will update our strict `zod` extraction schema to include:
```typescript
category: z.enum([
  "Food", "Transport", "Housing", "Shopping", "Entertainment", "Health", "Other"
]).describe("The strict master category this expense falls into.")
```
We will update the system prompt to explicitly instruct the AI *not* to invent tags, and if it chooses "Other", it must flag the expense for `needs_review: true`.

### 2.3 Database Schema (`src/db/expenses.ts`)
We will execute a D1 Migration (`0002_add_categories.sql`):
```sql
ALTER TABLE expenses ADD COLUMN category TEXT DEFAULT 'Other';
```
*Note: Because we want SQLite query simplicity, and we don't want users arbitrarily inventing new categories and breaking the donut charts, we will start with a simple textual `category` column validated at the application layer, rather than a separate relational table.*

### 2.4 Web App UI (`webapp/`)
* **Bottom Navigation**: The app will now have two main tabs: `📱 Dashboard` and `📊 Analytics`.
* **Dashboard Drawer Update**: The existing `ReviewDrawer` will be updated to include a `Category` Select dropdown, so users can correct categorized mistakes.
* **AnalyticsScreen.tsx**: A new screen that fetches `api/expenses` and uses a charting library (e.g., `recharts` or native Shadcn charts) to display a Donut/Pie chart of total spend per Category.

## 3. Data Contract
* **Database Target**: `expenses.category` (TEXT)
* **Frontend Payload** (sent via `api.ts` `updateExpense`):
    ```json
    {
      "amount_minor": 15000, 
      "currency": "PHP",
      "category": "Food"
    }
    ```

## 4. Edge Cases & Constraints
* **Backwards Compatibility**: All legacy `expenses` rows without a category will default to `'Other'`. We will *not* attempt to run an expensive AI backfill job in M7 to retroactively categorize thousands of old rows. That is deferred to an optional cron task later.
* **No Custom Tags Yet**: Users cannot create their own "Sub-tags" via the Telegram GUI. This feature remains strictly constrained to high-level master buckets to ensure chart stability.

## 5. Acceptance Criteria
* [ ] DB Migration `0002` applied adding `category` to `expenses`.
* [ ] `src/ai/openai.ts` prompt updated to force strict Category enum extraction.
* [ ] React `ReviewDrawer` updated to allow Category editing.
* [ ] React `AnalyticsScreen` built displaying a visual breakdown of spend.
