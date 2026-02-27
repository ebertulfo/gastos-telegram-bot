# Specification: M7 Expense Categories

## 1. Intent (The "What")
* **Goal**: To intelligently categorize expenses parsed by the AI into strict, high-level buckets (e.g., Food, Transport) and visualize spending breakdowns in the React Mini-app.
* **Problem**: Unbounded AI "tags" (e.g., `#starbucks`, `#coffee`) create noisy datasets that are impossible to chart accurately at a macro scale. However, relying *only* on strict categories loses the granular context of the purchase.
* **UX Fix Scope (M9 RAG Prep)**: We will implement a **Hybrid Approach**:
    1.  **Strict Categories (Metadata)**: The AI must select from a predefined `enum`. This gives us clean Donut Charts today, and act as strict **Pre-Filter Metadata** for Cloudflare Vectorize in M9 (allowing lightning-fast searches like "only search vectors within the Food category").
    2.  **Granular Tags (Embeddings)**: The AI will concurrently extract a JSON array of descriptive tags (e.g., `["starbucks", "coffee", "latte"]`). These tags will serve as the extreme high-signal text payload that gets embedded into the vector database in M9, drastically improving semantic recall.
* We will build a new "Analytics" tab in the React app featuring a Donut Chart to visualize spending by the strict Category, while still displaying the Tags context in the list view.

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

### 2.2 OpenAI Zod Schema & Prompt Injection (`src/ai/openai.ts`)
We will update our strict `zod` extraction schema to include both fields:
```typescript
category: z.enum([
  "Food", "Transport", "Housing", "Shopping", "Entertainment", "Health", "Other"
]).describe("The strict master category this expense falls into."),
tags: z.array(z.string()).describe("An array of 1 to 3 relevant context tags. e.g. ['coffee', 'starbucks']. All lowercase.")
```

**Geographical Context Injection**:
To solve the issue of the AI hallucinating or failing to categorize local vernacular (e.g., classifying "Andok's" as "Other" instead of "Food" because it lacks Philippine context), we will inject the user's onboarded locale directly into the System Prompt.
When calling OpenAI, we will dynamically append:
```text
The user's local timezone is ${timezone} and their default currency is ${currency}. Use this geographical context to understand local establishments, slang, and brands (e.g., if timezone is Asia/Manila, 'Andoks' is Food. If Asia/Singapore, 'Grab' is Transport, etc).
```

### 2.3 Database Schema (`src/db/expenses.ts`)
We will execute a D1 Migration (`0002_add_categories.sql`):
```sql
ALTER TABLE expenses ADD COLUMN category TEXT DEFAULT 'Other';
ALTER TABLE expenses ADD COLUMN tags TEXT DEFAULT '[]'; -- JSON Array
```
*Note: Because we want SQLite query simplicity, and we don't want users arbitrarily inventing new categories and breaking the donut charts, we will start with a simple textual `category` column validated at the application layer, rather than a separate relational table.*

### 2.4 Web App UI (`webapp/`)
* **Bottom Navigation**: The app will now have two main tabs: `📱 Dashboard` and `📊 Analytics`.
* **Dashboard Expense Rows**: Update the row UI to render the new `tags` array beautifully beneath the `parsed_description`.
* **Dashboard Drawer Update**: The existing `ReviewDrawer` will be updated to include a `Category` Select dropdown and a dynamic `Tags` input, so users can correct categorized mistakes.
* **AnalyticsScreen.tsx**: A new screen that fetches `api/expenses` and uses a charting library (e.g., `recharts` or native Shadcn charts) to display a Donut/Pie chart of total spend per Master Category.

## 3. Data Contract
* **Database Target**: `expenses.category` (TEXT) and `expenses.tags` (TEXT containing JSON array)
* **Frontend Payload** (sent via `api.ts` `updateExpense`):
    ```json
    {
      "amount_minor": 15000, 
      "currency": "PHP",
      "category": "Food",
      "tags": ["coffee", "starbucks", "date"]
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
