# Phase 2: Mini App Redesign — Execution Plan

**Scope:** Apply iOS design system to Mini App. No backend changes.

## Changes

### 1. Font loading (`index.html`)
- Add Google Fonts: Sora (300-800) + DM Mono (400-500)

### 2. Design tokens (`index.css`)
- Dark-only theme (ignore Telegram light theme)
- iOS palette: bg-base #0D1117, accent #2DCC72, text-primary #F0F4F8
- Typography: Sora for display/body, DM Mono for labels/metadata
- Border radii: sm 6px, md 10px, lg 14px, xl 20px, 2xl 28px
- Remove light mode variables entirely

### 3. Tailwind config
- Map new CSS variables to Tailwind theme
- Remove unused HSL references

### 4. Component updates (all using new tokens)
- **HeroTotal** — Sora 700 amount, DM Mono period label, accent green amount
- **TransactionRow** — tag pills with colors, description prominent
- **BottomNav** — accent green active indicator
- **PeriodToggle** — match dark theme
- **DonutChart** — keep, colors from tag palette
- **CategoryList** — rename file to TagList, update types (category → tag)
- **EditDrawer** — match dark surfaces
- **TransactionList** — DM Mono section headers

### 5. Empty states
- Dashboard: "No expenses yet"
- Analytics: "Not enough data yet — log a few expenses to see insights"
- Search: "Nothing matched — try a different search"

### 6. App.tsx
- Force dark mode class, remove theme toggle logic
