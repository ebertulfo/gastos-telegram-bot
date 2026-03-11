# Mini App Redesign Spec

## Goal

Redesign the Telegram Mini App from a generic shadcn template into a clean, minimal expense management interface. The mini-app is the **management layer** (view, edit, fix expenses) while the bot handles quick queries and logging.

## Design Decisions

- **Two tabs** — Dashboard + Analytics (removed Review Queue as separate tab)
- **Layout** — Hero number + feed (Revolut-inspired but minimal)
- **Edit interaction** — Bottom sheet (vaul drawer) on row tap
- **Analytics drill-down** — Navigate to filtered transaction list (reuses shared TransactionList component)
- **Visual style** — Clean minimal (Linear-inspired), monochrome UI with colored category charts
- **Dark mode** — Inherits from Telegram theme variables

## Screens

### Dashboard

**Hero section (top):**
- Large monthly total as anchor (32px, weight 700, tight tracking)
- "This Month ▾" label — tappable to cycle period (today → week → month → year)
- Sub-totals for today and this week underneath in smaller text

**Transaction feed (scrollable):**
- Grouped by date (section headers: "Today", "Yesterday", "Mar 9", etc.)
- Each row: category emoji (32px rounded square, `#f3f4f6` bg) | description + metadata | amount
- Metadata line: category name, tag pills (`#f3f4f6` bg, 10px), relative time
- Review items: subtle `#fff8f8` background, red `REVIEW` badge next to description
- Tapping any row opens the Edit Drawer

### Edit Drawer (Bottom Sheet)

Slides up from bottom using vaul. Contains:

**Header:**
- Description (20px, bold) + expense ID
- Amount (24px, bold, right-aligned)

**Editable fields:**
- Category — dropdown with emoji + name
- Date — date picker showing "Today, Mar 11" format
- Tags — pill chips with ✕ to remove, dashed "+ Add" button
- Amount — currency selector (64px) + amount input side by side

**Source section (read-only, muted):**
- "Logged via text/photo/voice · [time]"
- Original message in muted quote block (left border, italic)
- Receipt thumbnail if `r2_object_key` exists (tappable)

**Actions:**
- Save button (primary, full-width, `#111` bg)
- Delete button (text-only, `#dc2626` color, below save)

### Analytics

**Period toggle:**
- Segmented control (Week | Month | Year)
- Pill-style with white active state + subtle shadow

**Donut chart:**
- Colored segments by category, total in center
- Category colors:
  - Food: `#f97316` (orange)
  - Transport: `#3b82f6` (blue)
  - Housing: `#8b5cf6` (purple)
  - Shopping: `#ec4899` (pink)
  - Entertainment: `#eab308` (yellow)
  - Health: `#22c55e` (green)
  - Other: `#94a3b8` (slate gray)
- Color assignment for future custom categories: fixed palette of 12 colors, assigned in order. Overflow cycles back.

**Category list:**
- Color dot + category name | percentage + amount + chevron (›)
- Tapping navigates to filtered transaction list with back arrow
- Filtered view reuses the same TransactionList component from Dashboard

### Category Drill-Down

- Back arrow + "Food" (or category name) as header
- Same TransactionList component, filtered to selected category
- Same row tap → Edit Drawer behavior

## Navigation

```
Dashboard ←→ Analytics (bottom tab bar)
    ↓                ↓
EditDrawer    Category → FilteredList
                            ↓
                        EditDrawer
```

**Bottom nav:** Two tabs with icon + label. Active state: bold label + darker icon.

## Design System

**Palette (monochrome base):**
- Background: `#ffffff` / Telegram dark theme
- Text primary: `#111111`
- Text secondary: `#999999`
- Borders: `#f0f0f0`
- Row hover/press: `#f9f9f9`
- Review highlight: `#fff8f8` bg + `#dc2626` badge
- Category chart: colored (see above)

**Typography:** System font stack (`-apple-system, system-ui, sans-serif`)
- Hero: 32px / 700 / letter-spacing -1px
- Amount (drawer): 24px / 700
- Row description: 14px / 500
- Metadata/labels: 11-12px / 400 / uppercase for section headers

**Spacing:** 12px row padding, 16px page margins, 20px between sections.

**Icons:** Category emoji in 32px rounded squares. No icon library for categories.

**Components (shared):**
- `TransactionList` — date-grouped feed, used by Dashboard + category drill-down
- `TransactionRow` — emoji + description + tags + time + amount, tappable
- `EditDrawer` — vaul bottom sheet with all editable fields + source info
- `PeriodToggle` — segmented control for period selection
- `DonutChart` — colored donut with centered total
- `CategoryList` — analytics breakdown with drill-down navigation
- `BottomNav` — two-tab icon + label navigation

## Tech Stack (unchanged)

- React 19 + Vite + TypeScript
- Tailwind CSS + shadcn/ui components
- vaul for bottom sheet drawer
- @twa-dev/sdk for Telegram theme integration
- Lucide for nav icons (not category icons — those are emoji)

## Data Requirements

Uses existing API endpoints:
- `GET /expenses?period=...` — transaction feed
- `PUT /expenses/:id` — edit from drawer
- `DELETE /expenses/:id` — delete from drawer
- `GET /users/me` — user profile (currency, timezone)

No new API endpoints needed. Analytics aggregation happens client-side from the expenses list.

## Mockups

Visual mockups saved at `.superpowers/brainstorm/41608-1773222763/`:
- `dashboard-layout.html` — layout comparison (chose B: Hero + Feed)
- `analytics-layout.html` — analytics comparison (chose B: Donut + List)
- `full-app-mockup.html` — complete app mockup (all three views)
