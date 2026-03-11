# Mini App Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Telegram Mini App into a clean, minimal expense management interface with hero dashboard, colored analytics, and bottom sheet editing.

**Architecture:** Replace the three-tab layout (Dashboard/Analytics/Review) with a two-tab layout (Dashboard/Analytics). Extract shared components (TransactionList, TransactionRow, EditDrawer) that are reused across both tabs and the analytics drill-down. All editing happens via a vaul bottom sheet instead of dialog modals.

**Tech Stack:** React 19, Vite, TypeScript, Tailwind CSS, vaul (drawer), @twa-dev/sdk, Lucide icons (nav only), Radix UI primitives.

**Spec:** `docs/superpowers/specs/2026-03-11-mini-app-redesign.md`

---

## File Structure

### New files to create:
| File | Purpose |
|------|---------|
| `webapp/src/lib/categories.ts` | Category config: names, emoji, colors. Single source of truth. |
| `webapp/src/lib/format.ts` | Formatting helpers: currency, relative time, date grouping. |
| `webapp/src/lib/types.ts` | Shared TypeScript types (move `ExpenseWithDetails` from api.ts). |
| `webapp/src/components/TransactionRow.tsx` | Single expense row: emoji, description, tags, time, amount. |
| `webapp/src/components/TransactionList.tsx` | Date-grouped list of TransactionRow. Used by Dashboard + drill-down. |
| `webapp/src/components/EditDrawer.tsx` | Vaul bottom sheet with editable fields + source info. |
| `webapp/src/components/HeroTotal.tsx` | Tappable hero number with period cycling + sub-totals. |
| `webapp/src/components/PeriodToggle.tsx` | Segmented control (Week/Month/Year). |
| `webapp/src/components/DonutChart.tsx` | SVG donut chart with colored segments + centered total. |
| `webapp/src/components/CategoryList.tsx` | Analytics category rows with color dots + chevron. |
| `webapp/src/components/BottomNav.tsx` | Two-tab bottom navigation (icon + label). |

### Files to rewrite:
| File | What changes |
|------|-------------|
| `webapp/src/App.tsx` | New navigation: 2 tabs + category drill-down state. |
| `webapp/src/screens/DashboardScreen.tsx` | Hero + TransactionList. Remove dialog, use EditDrawer. |
| `webapp/src/screens/AnalyticsScreen.tsx` | Donut + CategoryList. Period toggle. |
| `webapp/src/index.css` | New design tokens (monochrome palette). |
| `webapp/src/components/layout/AppLayout.tsx` | Use BottomNav, simplified layout. |

### Files to delete:
| File | Reason |
|------|--------|
| `webapp/src/screens/ReviewQueueScreen.tsx` | Review merged into dashboard feed inline. |
| `webapp/src/App.css` | Unused boilerplate. |

### Files unchanged:
- `webapp/src/main.tsx` — entry point
- `webapp/src/lib/utils.ts` — cn() utility
- `webapp/src/lib/api.ts` — API client (minor: move type out, add tags update support)
- All `webapp/src/components/ui/*` — shadcn primitives (keep for Select, Input, Button, etc.)

---

## Chunk 1: Foundation (types, categories, formatters, design tokens)

### Task 1: Shared types and category config

**Files:**
- Create: `webapp/src/lib/types.ts`
- Create: `webapp/src/lib/categories.ts`
- Modify: `webapp/src/lib/api.ts`

- [ ] **Step 1: Create shared types file**

Create `webapp/src/lib/types.ts`:

```typescript
export type ExpenseWithDetails = {
  id: number;
  source_event_id: number;
  amount_minor: number;
  currency: string;
  occurred_at_utc: string;
  status: "final" | "needs_review";
  text_raw: string | null;
  r2_object_key: string | null;
  needs_review_reason: boolean;
  parsed_description: string | null;
  category: string;
  tags: string; // JSON array stored as string
};

export type Period = "today" | "thisweek" | "thismonth" | "thisyear";

export type Tab = "dashboard" | "analytics";
```

- [ ] **Step 2: Create category config**

Create `webapp/src/lib/categories.ts`:

```typescript
export type CategoryConfig = {
  name: string;
  emoji: string;
  color: string;
};

const KNOWN_CATEGORIES: Record<string, CategoryConfig> = {
  Food: { name: "Food", emoji: "🍜", color: "#f97316" },
  Transport: { name: "Transport", emoji: "🚗", color: "#3b82f6" },
  Housing: { name: "Housing", emoji: "🏠", color: "#8b5cf6" },
  Shopping: { name: "Shopping", emoji: "🛒", color: "#ec4899" },
  Entertainment: { name: "Entertainment", emoji: "🎬", color: "#eab308" },
  Health: { name: "Health", emoji: "🏥", color: "#22c55e" },
  Other: { name: "Other", emoji: "📦", color: "#94a3b8" },
};

// Extended palette for future custom categories
const OVERFLOW_COLORS = [
  "#06b6d4", "#14b8a6", "#a855f7", "#f43f5e", "#84cc16",
];

/**
 * Get category config. Returns a consistent config for unknown categories
 * using the overflow color palette (deterministic by index).
 */
export function getCategoryConfig(category: string): CategoryConfig {
  if (KNOWN_CATEGORIES[category]) {
    return KNOWN_CATEGORIES[category];
  }
  // Deterministic color for unknown categories
  const hash = category.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const color = OVERFLOW_COLORS[hash % OVERFLOW_COLORS.length];
  return { name: category, emoji: "📦", color };
}

export function getAllKnownCategories(): string[] {
  return Object.keys(KNOWN_CATEGORIES);
}
```

- [ ] **Step 3: Update api.ts to import shared types**

In `webapp/src/lib/api.ts`, replace the inline `ExpenseWithDetails` type with an import from `./types`. Keep the type definition in `types.ts` and add `import type { ExpenseWithDetails, Period } from "./types"` at the top of api.ts. Remove the inline type definition. Also add `source_event_id` to the type if not already present — it's returned by the API and needed for Vectorize matching.

- [ ] **Step 4: Commit**

```bash
cd webapp && git add src/lib/types.ts src/lib/categories.ts src/lib/api.ts
git commit -m "refactor: extract shared types and category config"
```

---

### Task 2: Formatting helpers

**Files:**
- Create: `webapp/src/lib/format.ts`

- [ ] **Step 1: Create format utilities**

Create `webapp/src/lib/format.ts`:

```typescript
/**
 * Format amount from minor units (cents) to display string.
 * formatAmount(2800, "SGD") → "SGD 28.00"
 */
export function formatAmount(amountMinor: number, currency: string): string {
  return `${currency} ${(amountMinor / 100).toFixed(2)}`;
}

/**
 * Format amount for display without currency prefix.
 * formatAmountShort(2800) → "28.00"
 */
export function formatAmountShort(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

/**
 * Relative time string from ISO date.
 * Returns "2h ago", "Yesterday", "Mar 9", etc.
 */
export function relativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Group expenses by date for section headers.
 * Returns: [{ label: "Today", expenses: [...] }, { label: "Yesterday", ... }]
 */
export function groupByDate(
  expenses: { occurred_at_utc: string }[]
): { label: string; expenses: typeof expenses }[] {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const groups = new Map<string, typeof expenses>();

  for (const expense of expenses) {
    const dateStr = expense.occurred_at_utc.slice(0, 10);
    let label: string;
    if (dateStr === todayStr) {
      label = "Today";
    } else if (dateStr === yesterdayStr) {
      label = "Yesterday";
    } else {
      label = new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    }

    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label)!.push(expense);
  }

  return Array.from(groups.entries()).map(([label, exps]) => ({
    label,
    expenses: exps,
  }));
}

/**
 * Parse tags JSON string safely.
 * parseTags('["lunch","work"]') → ["lunch", "work"]
 * parseTags(null) → []
 */
export function parseTags(tagsJson: string | null): string[] {
  if (!tagsJson) return [];
  try {
    const parsed = JSON.parse(tagsJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd webapp && git add src/lib/format.ts
git commit -m "feat: add formatting helpers (currency, relative time, date groups, tags)"
```

---

### Task 3: Design tokens

**Files:**
- Modify: `webapp/src/index.css`
- Delete: `webapp/src/App.css`

- [ ] **Step 1: Rewrite index.css with new design tokens**

Replace `webapp/src/index.css` entirely:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* Monochrome base */
    --background: #ffffff;
    --foreground: #111111;
    --text-secondary: #999999;
    --border: #f0f0f0;
    --surface: #f3f4f6;
    --surface-hover: #f9f9f9;

    /* Review highlight */
    --review-bg: #fff8f8;
    --review-badge: #dc2626;

    /* Actions */
    --primary: #111111;
    --primary-foreground: #ffffff;
    --destructive: #dc2626;

    /* Radius */
    --radius: 0.5rem;
  }

  .dark {
    --background: var(--tg-theme-bg-color, #1a1a1a);
    --foreground: var(--tg-theme-text-color, #f5f5f5);
    --text-secondary: var(--tg-theme-hint-color, #888888);
    --border: rgba(255, 255, 255, 0.08);
    --surface: rgba(255, 255, 255, 0.06);
    --surface-hover: rgba(255, 255, 255, 0.1);

    --review-bg: rgba(220, 38, 38, 0.08);
    --review-badge: #f87171;

    --primary: var(--tg-theme-button-color, #ffffff);
    --primary-foreground: var(--tg-theme-button-text-color, #111111);
    --destructive: #f87171;
  }

  * {
    border-color: var(--border);
  }

  body {
    background-color: var(--background);
    color: var(--foreground);
    font-family: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
}
```

- [ ] **Step 2: Delete App.css and remove its import**

Delete `webapp/src/App.css`. In `webapp/src/App.tsx` remove the `import './App.css'` line if present.

- [ ] **Step 3: Commit**

```bash
cd webapp && git add src/index.css && git rm src/App.css
git commit -m "refactor: replace design tokens with monochrome palette"
```

---

## Chunk 2: Shared UI Components

### Task 4: BottomNav component

**Files:**
- Create: `webapp/src/components/BottomNav.tsx`

- [ ] **Step 1: Create BottomNav**

```tsx
import { LayoutList, PieChart } from "lucide-react";
import type { Tab } from "../lib/types";

type BottomNavProps = {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
};

const TABS: { id: Tab; label: string; icon: typeof LayoutList }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutList },
  { id: "analytics", label: "Analytics", icon: PieChart },
];

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 flex border-t bg-[var(--background)]"
         style={{ borderColor: "var(--border)" }}>
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className="flex flex-1 flex-col items-center gap-0.5 py-2"
          >
            <Icon
              size={20}
              color={active ? "var(--foreground)" : "var(--text-secondary)"}
              strokeWidth={active ? 2.5 : 1.5}
            />
            <span
              className="text-[10px]"
              style={{
                color: active ? "var(--foreground)" : "var(--text-secondary)",
                fontWeight: active ? 600 : 400,
              }}
            >
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd webapp && git add src/components/BottomNav.tsx
git commit -m "feat: add BottomNav component (2-tab icon + label)"
```

---

### Task 5: PeriodToggle component

**Files:**
- Create: `webapp/src/components/PeriodToggle.tsx`

- [ ] **Step 1: Create PeriodToggle**

A segmented control (pill-style) for selecting period.

```tsx
type PeriodOption = {
  value: string;
  label: string;
};

type PeriodToggleProps = {
  options: PeriodOption[];
  value: string;
  onChange: (value: string) => void;
};

export function PeriodToggle({ options, value, onChange }: PeriodToggleProps) {
  return (
    <div className="flex rounded-lg p-0.5" style={{ background: "var(--surface)" }}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className="flex-1 rounded-md py-1.5 text-xs transition-all"
            style={{
              background: active ? "var(--background)" : "transparent",
              color: active ? "var(--foreground)" : "var(--text-secondary)",
              fontWeight: active ? 600 : 400,
              boxShadow: active ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd webapp && git add src/components/PeriodToggle.tsx
git commit -m "feat: add PeriodToggle segmented control"
```

---

### Task 6: HeroTotal component

**Files:**
- Create: `webapp/src/components/HeroTotal.tsx`

- [ ] **Step 1: Create HeroTotal**

Displays the main spend total with tappable period cycling and sub-totals.

```tsx
import type { ExpenseWithDetails, Period } from "../lib/types";
import { formatAmountShort } from "../lib/format";

const PERIOD_LABELS: Record<Period, string> = {
  today: "Today",
  thisweek: "This Week",
  thismonth: "This Month",
  thisyear: "This Year",
};

const PERIOD_CYCLE: Period[] = ["today", "thisweek", "thismonth", "thisyear"];

type HeroTotalProps = {
  period: Period;
  onPeriodChange: (period: Period) => void;
  expenses: ExpenseWithDetails[];
  currency: string;
};

export function HeroTotal({ period, onPeriodChange, expenses, currency }: HeroTotalProps) {
  const totalMinor = expenses.reduce((sum, e) => sum + e.amount_minor, 0);

  const handleCyclePeriod = () => {
    const idx = PERIOD_CYCLE.indexOf(period);
    const next = PERIOD_CYCLE[(idx + 1) % PERIOD_CYCLE.length];
    onPeriodChange(next);
  };

  return (
    <div className="text-center py-4">
      <button
        onClick={handleCyclePeriod}
        className="text-[11px] uppercase tracking-wider mb-1"
        style={{ color: "var(--text-secondary)" }}
      >
        {PERIOD_LABELS[period]} ▾
      </button>
      <div
        className="text-[32px] font-bold"
        style={{ color: "var(--foreground)", letterSpacing: "-1px" }}
      >
        {currency} {formatAmountShort(totalMinor)}
      </div>
    </div>
  );
}
```

**Note:** The sub-totals (today/this week) require separate API calls for different periods. For simplicity in v1, just show the single hero total for the selected period. Sub-totals can be added later if needed.

- [ ] **Step 2: Commit**

```bash
cd webapp && git add src/components/HeroTotal.tsx
git commit -m "feat: add HeroTotal component with tappable period cycling"
```

---

### Task 7: TransactionRow and TransactionList components

**Files:**
- Create: `webapp/src/components/TransactionRow.tsx`
- Create: `webapp/src/components/TransactionList.tsx`

- [ ] **Step 1: Create TransactionRow**

A single expense row with emoji, description, tags, relative time, and amount.

```tsx
import type { ExpenseWithDetails } from "../lib/types";
import { getCategoryConfig } from "../lib/categories";
import { formatAmountShort, relativeTime, parseTags } from "../lib/format";

type TransactionRowProps = {
  expense: ExpenseWithDetails;
  onClick: (expense: ExpenseWithDetails) => void;
};

export function TransactionRow({ expense, onClick }: TransactionRowProps) {
  const cat = getCategoryConfig(expense.category);
  const tags = parseTags(expense.tags);
  const description = expense.parsed_description || expense.text_raw || "Unknown";
  const isReview = expense.status === "needs_review";

  return (
    <button
      onClick={() => onClick(expense)}
      className="flex w-full items-center justify-between py-2.5 text-left"
      style={{
        background: isReview ? "var(--review-bg)" : "transparent",
        marginLeft: isReview ? "-8px" : 0,
        marginRight: isReview ? "-8px" : 0,
        paddingLeft: isReview ? "8px" : 0,
        paddingRight: isReview ? "8px" : 0,
        borderRadius: isReview ? "6px" : 0,
      }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm"
          style={{ background: isReview ? "var(--review-bg)" : "var(--surface)" }}
        >
          {cat.emoji}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className="truncate text-sm font-medium"
              style={{ color: "var(--foreground)" }}
            >
              {description}
            </span>
            {isReview && (
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold"
                style={{ background: "var(--review-bg)", color: "var(--review-badge)" }}
              >
                REVIEW
              </span>
            )}
          </div>
          <div
            className="flex items-center gap-1 text-[11px]"
            style={{ color: "var(--text-secondary)" }}
          >
            <span>{expense.category}</span>
            {tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="rounded px-1.5 py-0.5"
                style={{ background: "var(--surface)", fontSize: "10px" }}
              >
                #{tag}
              </span>
            ))}
            <span style={{ color: "var(--border)" }}>·</span>
            <span>{relativeTime(expense.occurred_at_utc)}</span>
          </div>
        </div>
      </div>
      <span
        className="shrink-0 text-sm font-semibold ml-2"
        style={{ color: "var(--foreground)" }}
      >
        -{formatAmountShort(expense.amount_minor)}
      </span>
    </button>
  );
}
```

- [ ] **Step 2: Create TransactionList**

Date-grouped list of TransactionRow items.

```tsx
import type { ExpenseWithDetails } from "../lib/types";
import { groupByDate } from "../lib/format";
import { TransactionRow } from "./TransactionRow";

type TransactionListProps = {
  expenses: ExpenseWithDetails[];
  onSelectExpense: (expense: ExpenseWithDetails) => void;
};

export function TransactionList({ expenses, onSelectExpense }: TransactionListProps) {
  const groups = groupByDate(expenses);

  if (expenses.length === 0) {
    return (
      <div className="py-12 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
        No expenses yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {groups.map((group) => (
        <div key={group.label}>
          <div
            className="pb-1.5 pt-4 text-[11px] uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}
          >
            {group.label}
          </div>
          <div className="flex flex-col divide-y" style={{ borderColor: "var(--border)" }}>
            {(group.expenses as ExpenseWithDetails[]).map((expense) => (
              <TransactionRow
                key={expense.id}
                expense={expense}
                onClick={onSelectExpense}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
cd webapp && git add src/components/TransactionRow.tsx src/components/TransactionList.tsx
git commit -m "feat: add TransactionRow and TransactionList components"
```

---

### Task 8: EditDrawer (bottom sheet)

**Files:**
- Create: `webapp/src/components/EditDrawer.tsx`

- [ ] **Step 1: Create EditDrawer**

Uses vaul's `Drawer` component. Contains all editable fields + source info + save/delete.

```tsx
import { useState } from "react";
import { Drawer } from "vaul";
import type { ExpenseWithDetails } from "../lib/types";
import { getCategoryConfig, getAllKnownCategories } from "../lib/categories";
import { formatAmountShort, parseTags } from "../lib/format";
import { updateExpense, deleteExpense } from "../lib/api";

type EditDrawerProps = {
  expense: ExpenseWithDetails | null;
  onClose: () => void;
  onSaved: () => void;
};

export function EditDrawer({ expense, onClose, onSaved }: EditDrawerProps) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset form when expense changes
  const open = expense !== null;
  if (expense && amount === "" && category === "") {
    // Lazy init — runs once when drawer opens
  }

  const handleOpen = (isOpen: boolean) => {
    if (!isOpen) {
      onClose();
      setAmount("");
      setCategory("");
    }
  };

  const handleSave = async () => {
    if (!expense) return;
    setSaving(true);
    try {
      const amountMinor = Math.round(parseFloat(amount) * 100);
      await updateExpense(expense.id, amountMinor, expense.currency, category || undefined);
      onSaved();
      onClose();
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
      setAmount("");
      setCategory("");
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

  // Initialize form values when expense appears
  const displayAmount = amount || (expense ? formatAmountShort(expense.amount_minor) : "");
  const displayCategory = category || (expense?.category ?? "");
  const tags = expense ? parseTags(expense.tags) : [];
  const description = expense?.parsed_description || expense?.text_raw || "Unknown";
  const cat = getCategoryConfig(displayCategory);

  // Determine source type
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
                    {expense.currency} {displayAmount}
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
                      value={displayCategory}
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
                    <div
                      className="rounded-lg border px-3 py-2.5 text-sm"
                      style={{
                        background: "var(--surface-hover)",
                        borderColor: "var(--border)",
                        color: "var(--foreground)",
                      }}
                    >
                      {expense.occurred_at_utc
                        ? new Date(expense.occurred_at_utc).toLocaleDateString("en-US", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })
                        : "Unknown"}
                    </div>
                  </div>

                  {/* Tags */}
                  <div>
                    <label className="mb-1 block text-[11px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                      Tags
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
                          style={{ background: "var(--surface)", color: "var(--text-secondary)" }}
                        >
                          #{tag}
                        </span>
                      ))}
                      {tags.length === 0 && (
                        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                          No tags
                        </span>
                      )}
                    </div>
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
                        value={displayAmount}
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

**Note:** The form state management is intentionally simple (useState). React Hook Form is available but overkill for 2 fields. Tags editing (add/remove) is deferred to a future iteration — we display them read-only for now.

- [ ] **Step 2: Commit**

```bash
cd webapp && git add src/components/EditDrawer.tsx
git commit -m "feat: add EditDrawer bottom sheet with editable fields and source info"
```

---

## Chunk 3: Analytics Components

### Task 9: DonutChart component

**Files:**
- Create: `webapp/src/components/DonutChart.tsx`

- [ ] **Step 1: Create DonutChart**

Pure SVG donut chart — no dependencies. Takes category totals, renders colored segments with total in center.

```tsx
type DonutSegment = {
  label: string;
  value: number;
  color: string;
};

type DonutChartProps = {
  segments: DonutSegment[];
  total: string; // formatted total string
  currency: string;
  size?: number;
};

export function DonutChart({ segments, total, currency, size = 120 }: DonutChartProps) {
  const center = size / 2;
  const radius = size * 0.4;
  const strokeWidth = size * 0.15;
  const circumference = 2 * Math.PI * radius;
  const totalValue = segments.reduce((sum, s) => sum + s.value, 0);

  let accumulated = 0;

  return (
    <div className="flex items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--surface)"
          strokeWidth={strokeWidth}
        />
        {/* Segments */}
        {segments.map((segment) => {
          const pct = totalValue > 0 ? segment.value / totalValue : 0;
          const dashLength = circumference * pct;
          const dashOffset = circumference * (0.25 - accumulated); // start from top
          accumulated += pct;

          return (
            <circle
              key={segment.label}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dashLength} ${circumference - dashLength}`}
              strokeDashoffset={dashOffset}
              strokeLinecap="butt"
            />
          );
        })}
        {/* Center text */}
        <text
          x={center}
          y={center - 4}
          textAnchor="middle"
          className="text-sm font-bold"
          style={{ fill: "var(--foreground)" }}
        >
          {total}
        </text>
        <text
          x={center}
          y={center + 12}
          textAnchor="middle"
          className="text-[9px]"
          style={{ fill: "var(--text-secondary)" }}
        >
          {currency}
        </text>
      </svg>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd webapp && git add src/components/DonutChart.tsx
git commit -m "feat: add DonutChart SVG component with colored segments"
```

---

### Task 10: CategoryList component

**Files:**
- Create: `webapp/src/components/CategoryList.tsx`

- [ ] **Step 1: Create CategoryList**

Category breakdown rows with color dot, name, percentage, amount, and chevron for drill-down.

```tsx
import { ChevronRight } from "lucide-react";
import { getCategoryConfig } from "../lib/categories";
import { formatAmountShort } from "../lib/format";

export type CategoryTotal = {
  category: string;
  totalMinor: number;
  count: number;
  percentage: number;
};

type CategoryListProps = {
  categories: CategoryTotal[];
  currency: string;
  onCategoryClick: (category: string) => void;
};

export function CategoryList({ categories, currency, onCategoryClick }: CategoryListProps) {
  return (
    <div className="flex flex-col">
      {categories.map((cat) => {
        const config = getCategoryConfig(cat.category);
        return (
          <button
            key={cat.category}
            onClick={() => onCategoryClick(cat.category)}
            className="flex items-center justify-between rounded-lg px-2 py-2.5 transition-colors"
            style={{ color: "var(--foreground)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <div className="flex items-center gap-2.5">
              <div
                className="h-2.5 w-2.5 rounded-sm"
                style={{ background: config.color }}
              />
              <span className="text-sm font-medium">{cat.category}</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {cat.percentage}%
              </span>
              <span className="text-sm font-semibold">
                {currency} {formatAmountShort(cat.totalMinor)}
              </span>
              <ChevronRight size={14} color="var(--text-secondary)" strokeWidth={1.5} />
            </div>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd webapp && git add src/components/CategoryList.tsx
git commit -m "feat: add CategoryList component with color dots and drill-down chevron"
```

---

## Chunk 4: Screens and App Shell

### Task 11: Rewrite App.tsx with new navigation

**Files:**
- Modify: `webapp/src/App.tsx`

- [ ] **Step 1: Rewrite App.tsx**

Two tabs + category drill-down state. Simplified navigation.

```tsx
import { useState, useEffect } from "react";
import WebApp from "@twa-dev/sdk";
import { BottomNav } from "./components/BottomNav";
import { DashboardScreen } from "./screens/DashboardScreen";
import { AnalyticsScreen } from "./screens/AnalyticsScreen";
import type { Tab } from "./lib/types";

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [drillDownCategory, setDrillDownCategory] = useState<string | null>(null);

  useEffect(() => {
    WebApp.ready();
    WebApp.expand();

    const updateTheme = () => {
      document.documentElement.classList.toggle("dark", WebApp.colorScheme === "dark");
    };
    updateTheme();
    WebApp.onEvent("themeChanged", updateTheme);
    return () => WebApp.offEvent("themeChanged", updateTheme);
  }, []);

  // Back button for drill-down
  useEffect(() => {
    if (drillDownCategory) {
      WebApp.BackButton.show();
      const handleBack = () => setDrillDownCategory(null);
      WebApp.BackButton.onClick(handleBack);
      return () => {
        WebApp.BackButton.offClick(handleBack);
        WebApp.BackButton.hide();
      };
    }
  }, [drillDownCategory]);

  const handleTabChange = (tab: Tab) => {
    setDrillDownCategory(null); // reset drill-down on tab switch
    setActiveTab(tab);
  };

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "var(--background)" }}>
      <main className="flex-1 overflow-y-auto px-4 pb-16">
        {activeTab === "dashboard" && <DashboardScreen />}
        {activeTab === "analytics" && (
          <AnalyticsScreen
            drillDownCategory={drillDownCategory}
            onDrillDown={setDrillDownCategory}
            onBack={() => setDrillDownCategory(null)}
          />
        )}
      </main>
      {!drillDownCategory && (
        <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd webapp && git add src/App.tsx
git commit -m "refactor: rewrite App.tsx with 2-tab nav and category drill-down"
```

---

### Task 12: Rewrite DashboardScreen

**Files:**
- Modify: `webapp/src/screens/DashboardScreen.tsx`

- [ ] **Step 1: Rewrite DashboardScreen**

Hero total + transaction list + edit drawer. Replace the old dialog-based editing.

```tsx
import { useState, useEffect, useCallback } from "react";
import { HeroTotal } from "../components/HeroTotal";
import { TransactionList } from "../components/TransactionList";
import { EditDrawer } from "../components/EditDrawer";
import { Skeleton } from "../components/ui/skeleton";
import { fetchExpenses, fetchUserProfile } from "../lib/api";
import type { ExpenseWithDetails, Period } from "../lib/types";

export function DashboardScreen() {
  const [period, setPeriod] = useState<Period>("thismonth");
  const [expenses, setExpenses] = useState<ExpenseWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("SGD");
  const [selectedExpense, setSelectedExpense] = useState<ExpenseWithDetails | null>(null);

  const loadExpenses = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchExpenses(period);
      setExpenses(data);
    } catch (err) {
      console.error("Failed to load expenses:", err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchUserProfile().then((profile) => {
      if (profile.currency) setCurrency(profile.currency);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  return (
    <>
      {loading ? (
        <div className="py-6 text-center">
          <Skeleton className="mx-auto mb-2 h-4 w-24" />
          <Skeleton className="mx-auto h-10 w-48" />
          <div className="mt-8 space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        </div>
      ) : (
        <>
          <HeroTotal
            period={period}
            onPeriodChange={setPeriod}
            expenses={expenses}
            currency={currency}
          />
          <div className="my-3 h-px" style={{ background: "var(--border)" }} />
          <TransactionList
            expenses={expenses}
            onSelectExpense={setSelectedExpense}
          />
        </>
      )}

      <EditDrawer
        expense={selectedExpense}
        onClose={() => setSelectedExpense(null)}
        onSaved={loadExpenses}
      />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd webapp && git add src/screens/DashboardScreen.tsx
git commit -m "refactor: rewrite DashboardScreen with hero total and transaction feed"
```

---

### Task 13: Rewrite AnalyticsScreen with drill-down

**Files:**
- Modify: `webapp/src/screens/AnalyticsScreen.tsx`

- [ ] **Step 1: Rewrite AnalyticsScreen**

Donut chart + category list. When a category is selected, shows filtered TransactionList.

```tsx
import { useState, useEffect, useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import { PeriodToggle } from "../components/PeriodToggle";
import { DonutChart } from "../components/DonutChart";
import { CategoryList, type CategoryTotal } from "../components/CategoryList";
import { TransactionList } from "../components/TransactionList";
import { EditDrawer } from "../components/EditDrawer";
import { Skeleton } from "../components/ui/skeleton";
import { fetchExpenses, fetchUserProfile } from "../lib/api";
import { getCategoryConfig } from "../lib/categories";
import { formatAmountShort } from "../lib/format";
import type { ExpenseWithDetails, Period } from "../lib/types";

const PERIOD_OPTIONS = [
  { value: "thisweek", label: "Week" },
  { value: "thismonth", label: "Month" },
  { value: "thisyear", label: "Year" },
];

type AnalyticsScreenProps = {
  drillDownCategory: string | null;
  onDrillDown: (category: string) => void;
  onBack: () => void;
};

export function AnalyticsScreen({ drillDownCategory, onDrillDown, onBack }: AnalyticsScreenProps) {
  const [period, setPeriod] = useState<Period>("thismonth");
  const [expenses, setExpenses] = useState<ExpenseWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("SGD");
  const [selectedExpense, setSelectedExpense] = useState<ExpenseWithDetails | null>(null);

  const loadExpenses = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchExpenses(period);
      setExpenses(data);
    } catch (err) {
      console.error("Failed to load expenses:", err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchUserProfile().then((profile) => {
      if (profile.currency) setCurrency(profile.currency);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  // Compute category totals
  const totalMinor = expenses.reduce((sum, e) => sum + e.amount_minor, 0);
  const categoryMap = new Map<string, { totalMinor: number; count: number }>();
  for (const e of expenses) {
    const cat = e.category || "Other";
    const existing = categoryMap.get(cat) || { totalMinor: 0, count: 0 };
    existing.totalMinor += e.amount_minor;
    existing.count++;
    categoryMap.set(cat, existing);
  }
  const categoryTotals: CategoryTotal[] = Array.from(categoryMap.entries())
    .map(([category, data]) => ({
      category,
      totalMinor: data.totalMinor,
      count: data.count,
      percentage: totalMinor > 0 ? Math.round((data.totalMinor / totalMinor) * 100) : 0,
    }))
    .sort((a, b) => b.totalMinor - a.totalMinor);

  const donutSegments = categoryTotals.map((cat) => ({
    label: cat.category,
    value: cat.totalMinor,
    color: getCategoryConfig(cat.category).color,
  }));

  // Drill-down: filter expenses by selected category
  if (drillDownCategory) {
    const filtered = expenses.filter((e) => e.category === drillDownCategory);
    const catConfig = getCategoryConfig(drillDownCategory);

    return (
      <>
        <div className="flex items-center gap-2 py-3">
          <button onClick={onBack} className="p-1">
            <ArrowLeft size={20} color="var(--foreground)" />
          </button>
          <span className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
            {catConfig.emoji} {drillDownCategory}
          </span>
          <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
            ({filtered.length})
          </span>
        </div>
        <TransactionList expenses={filtered} onSelectExpense={setSelectedExpense} />
        <EditDrawer
          expense={selectedExpense}
          onClose={() => setSelectedExpense(null)}
          onSaved={loadExpenses}
        />
      </>
    );
  }

  return (
    <>
      <div className="py-4">
        <PeriodToggle options={PERIOD_OPTIONS} value={period} onChange={(v) => setPeriod(v as Period)} />
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="mx-auto h-28 w-28 rounded-full" />
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      ) : expenses.length === 0 ? (
        <div className="py-12 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
          No spending data yet.
        </div>
      ) : (
        <>
          <DonutChart
            segments={donutSegments}
            total={formatAmountShort(totalMinor)}
            currency={currency}
          />
          <div className="mt-6">
            <CategoryList
              categories={categoryTotals}
              currency={currency}
              onCategoryClick={onDrillDown}
            />
          </div>
        </>
      )}

      <EditDrawer
        expense={selectedExpense}
        onClose={() => setSelectedExpense(null)}
        onSaved={loadExpenses}
      />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd webapp && git add src/screens/AnalyticsScreen.tsx
git commit -m "refactor: rewrite AnalyticsScreen with donut chart and category drill-down"
```

---

## Chunk 5: Cleanup and Integration

### Task 14: Delete ReviewQueueScreen and AppLayout cleanup

**Files:**
- Delete: `webapp/src/screens/ReviewQueueScreen.tsx`
- Modify: `webapp/src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Delete ReviewQueueScreen**

```bash
cd webapp && git rm src/screens/ReviewQueueScreen.tsx
```

- [ ] **Step 2: Simplify or delete AppLayout**

The new `App.tsx` handles layout directly (Telegram init, bottom nav, content area). `AppLayout.tsx` is no longer used. Delete it:

```bash
cd webapp && git rm src/components/layout/AppLayout.tsx
```

- [ ] **Step 3: Commit**

```bash
cd webapp && git commit -m "refactor: remove ReviewQueueScreen and AppLayout (replaced by new components)"
```

---

### Task 15: Verify build and fix any TypeScript errors

**Files:** All modified files

- [ ] **Step 1: Run type check**

```bash
cd webapp && npx tsc --noEmit
```

Fix any type errors. Common issues:
- Missing imports
- `Period` type mismatch (api.ts may use different period strings)
- `fetchExpenses` return type needs to match `ExpenseWithDetails[]`

- [ ] **Step 2: Run dev server and test**

```bash
cd webapp && npm run dev
```

Open in browser. Verify:
- Dashboard loads with hero total and transaction feed
- Tapping hero cycles period
- Tapping a transaction opens the bottom sheet
- Analytics shows donut and category list
- Tapping a category shows filtered transactions
- Back button returns to analytics
- Dark mode works (toggle in Telegram or via class)

- [ ] **Step 3: Run lint**

```bash
cd webapp && npm run lint
```

Fix any lint errors.

- [ ] **Step 4: Final commit**

```bash
cd webapp && git add -A
git commit -m "fix: resolve build errors and lint issues from redesign"
```

---

### Task 16: Final cleanup

- [ ] **Step 1: Remove unused dependencies**

Check if any shadcn/ui components are no longer imported (Dialog is likely unused now — replaced by vaul Drawer). Keep them for now since they're lightweight and may be useful later.

- [ ] **Step 2: Update .gitignore if needed**

Verify `.superpowers/` is in `.gitignore` (should already be from the spec commit).

- [ ] **Step 3: Final commit and summary**

```bash
git add -A
git commit -m "chore: mini-app redesign cleanup"
```

**Verify the full app works end-to-end before marking complete.**
