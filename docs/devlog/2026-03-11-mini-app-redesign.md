# Ripping Out shadcn/ui and Building a Design System From Scratch

**Date:** 2026-03-11
**Commits:** 21 commits
**PRs:** #2

## What Changed
- Replaced shadcn/ui component library with a custom monochrome design system using CSS variables
- Built new 2-tab layout with BottomNav (Dashboard + Analytics), replacing the old hamburger menu and AppLayout
- Created BottomNav, PeriodToggle, HeroTotal, TransactionRow, TransactionList, EditDrawer, DonutChart, and CategoryList components — all from scratch
- Dashboard screen: hero total with tappable period cycling (day/week/month/year), transaction feed grouped by relative date
- Analytics screen: SVG donut chart with colored category segments, category drill-down list with chevron navigation
- Added formatting helpers: currency display, relative time ("today", "yesterday", "March 8"), date grouping logic, tag formatting
- Extracted shared types (`Expense`, `Category`) and category config (name, color, icon mappings) into dedicated modules
- Replaced the old design token system with a monochrome palette that plays well with Telegram's theme parameters
- Added mock data fallback so the Mini App renders locally without a backend connection
- Removed ReviewQueueScreen and old AppLayout (dead code after the redesign)
- Fixed build errors: unused variables, NaN on save when amount field was empty, divide-y border color mismatch

## Why
The original Mini App was a functional prototype using shadcn/ui defaults. It worked, but it looked like every other shadcn app — the same Tailwind-gray cards, the same font stack, the same spacing. For a portfolio piece that lives inside Telegram, it needed to feel native to the platform, not like a web app crammed into a WebView.

The deeper motivation was control. shadcn/ui is great for moving fast, but every customization fought the defaults. The EditDrawer needed to be a bottom sheet (not a modal), the DonutChart needed to be pure SVG (not a chart library), and the color system needed to respond to Telegram's theme params. At some point the cost of working around the library exceeded the cost of building custom.

## Key Decisions
| Decision | Options Considered | Chosen | Why |
|----------|-------------------|--------|-----|
| Component library | Keep shadcn/ui, Radix primitives only, fully custom | Fully custom | shadcn defaults clashed with the monochrome direction. Radix primitives would have been a reasonable middle ground but most components here are simple enough that the abstraction wasn't worth the dependency. |
| Color system | Colorful category palette, Telegram theme colors, monochrome with accents | Monochrome with CSS variables | Cleaner, more professional. Telegram already has its own color theming — fighting it with a colorful palette creates visual noise. Monochrome lets the data be the focal point. |
| Navigation | Hamburger menu, bottom tabs (2), bottom tabs (3+) | 2-tab bottom nav | Two screens (Dashboard, Analytics) are enough for the current feature set. Hamburger menus hide functionality. Three tabs would mean inventing a third screen that doesn't have a clear purpose yet. |
| Chart library | Chart.js, Recharts, Nivo, pure SVG | Pure SVG DonutChart | The only chart needed is a donut. Pulling in a chart library for one component adds 40-200KB to the bundle. SVG arc math is ~30 lines of geometry. |
| Edit interaction | Modal dialog, full-screen page, bottom sheet | Bottom sheet (EditDrawer) | Bottom sheets are the standard mobile pattern for inline editing. Modals feel desktop-centric. Full-screen navigation would lose the transaction list context. |
| Local development | Require backend running, fixture files, inline mock data | Mock data module with fallback | `mock-data.ts` lets the Mini App render a realistic UI without starting Wrangler. The API layer falls back to mock data when fetch fails. Faster iteration on visual work. |

## How (Workflow)
Started with a design spec and implementation plan (both committed as docs). Worked bottom-up: shared types and formatting utilities first, then atomic components (BottomNav, PeriodToggle, HeroTotal), then composite components (TransactionRow, TransactionList, DonutChart, CategoryList, EditDrawer), then screen rewrites (DashboardScreen, AnalyticsScreen, App.tsx), then cleanup (remove old components, fix build errors).

The monochrome palette was defined as CSS custom properties in `index.css`, which means Telegram's `themeParams` can override them at runtime. Each component uses these variables instead of hard-coded Tailwind colors.

Mock data was essential — it let me iterate on the visual design without round-tripping through the backend. The mock module generates realistic expense data with proper date distribution so the grouping logic gets exercised.

## Metrics
- 23 files changed, ~2,993 lines added, ~767 lines removed
- 8 new components created from scratch
- 3 new utility modules (format.ts, categories.ts, types.ts)
- 1 mock data module with realistic expense fixtures
- 2 screens rewritten, 1 screen removed, 1 layout component removed
- 0 new dependencies added (removed shadcn/ui dependency surface)

## Learnings
- **SVG arc math is annoying but worth it.** The DonutChart uses `Math.cos`/`Math.sin` for arc endpoints and the SVG large-arc-flag for segments > 180 degrees. Took 30 minutes to get right, but the result is a zero-dependency chart component in ~80 lines. Would I do this for 5 chart types? No. For one donut? Every time.
- **Mock data as a first-class module changes the dev loop.** Instead of `console.log` debugging API responses, I could see exactly what the UI would render. It also served as documentation for the expected data shape.
- **CSS variables for theming are underrated in Telegram Mini Apps.** Telegram injects `themeParams` with the user's color scheme. Mapping those to CSS custom properties means the entire app adapts without any React re-renders or context providers.
- **Removing a component library is harder than adding one.** shadcn/ui components were woven into the screens. The refactor wasn't "swap Button for button" — it was rethinking the entire layout structure, spacing system, and interaction patterns. Good learning experience, but not something I'd recommend doing casually.
- **Bottom-up component building with a plan prevents rework.** Having the implementation plan meant I knew exactly which props each component needed before building it. No "oh wait, DashboardScreen needs to pass X to HeroTotal" moments late in the session.

## Content Angles
- "Why I Replaced shadcn/ui With Custom Components in a Telegram Mini App" — the tradeoff between library convenience and platform-native feel
- "Building a Zero-Dependency SVG Donut Chart in React" — the geometry, the gotchas, the 80-line result
- "Telegram Mini App Theming With CSS Custom Properties" — how to make a web app feel native inside Telegram's WebView
- "Mock Data as a Development Tool, Not Just a Testing Tool" — using realistic fixtures to accelerate UI iteration
