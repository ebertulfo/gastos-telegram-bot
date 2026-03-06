# Proactive Notifications Design

**Goal:** Make Gastos sticky by sending proactive, timezone-aware spending summaries to users via Telegram on a daily, weekly, monthly, and yearly cadence.

**Date:** 2026-03-06

---

## Problem

Users forget the app exists. Without outgoing messages, the app is entirely passive — it only adds value when the user remembers to use it.

---

## Approach

One hourly Cloudflare Cron (`0 * * * *`) triggers a `scheduled` handler. Each run loops over all users and determines which notifications are due based on their saved timezone and last-sent tracking in the DB. No new infrastructure — just a cron trigger and a scheduled export.

---

## Notification Schedule

| Type | Local Time | Day |
|------|-----------|-----|
| Morning daily | 8:00 AM | Every day |
| Evening daily | 9:00 PM | Every day |
| Weekly rollup | 9:00 PM | Sunday only |
| Monthly rollup | 8:00 AM | 1st of month |
| Yearly rollup | 8:00 AM | January 1st |

- Weekly fires alongside evening on Sundays (user gets both)
- Monthly/yearly replace morning on their respective trigger days (no double message)
- All times are in each user's saved timezone from their profile

---

## Message Format

### Morning daily (8 AM)
```
🌅 Good morning! Here's yesterday's recap:

📊 Yesterday: PHP 850.00 (5 expenses)
• Food: PHP 420.00
• Transport: PHP 180.00
• Shopping: PHP 250.00

📈 This month so far: PHP 12,450.00

"You spent more on food yesterday than your daily average this month."
```

### Evening daily (9 PM)
```
🌙 Here's your day:

📊 Today: PHP 650.00 (4 expenses)
• Food: PHP 300.00
• Transport: PHP 200.00
• Entertainment: PHP 150.00

📈 This week so far: PHP 3,200.00

"Good day — you stayed under your typical daily spend."
```

### Weekly/Monthly/Yearly rollup
Same structure with fuller category breakdown and AI insight comparing to the previous equivalent period (e.g. "15% above your weekly average from last month").

### Empty state (any type, nothing logged)
```
🌅 Good morning! Nothing was logged yesterday.

💡 People who track their daily expenses are 73% more
likely to feel in control of their finances.
(Journal of Consumer Research)

Don't forget to log today — just send me anything! 💸
```

Empty state uses a rotating curated fact from a hardcoded list (~20-30 entries, rotate by day of year). No AI call needed for empty state.

---

## AI Insight Line

- Model: GPT-4o-mini (one call per user per notification, only when expenses exist)
- Input: structured summary data (totals, category breakdown, comparison to prior period)
- Output: one observational sentence

**Hard constraints on the AI insight system prompt:**
- Purely observational — describes what happened, never prescribes action
- Never use: "should", "consider", "recommend", "try to", "you need to", "cut back", "save more"
- No financial advice of any kind (Singapore MAS and Philippine BSP compliance)
- No comparison to other people's spending
- Examples of valid output:
  - "Transport was your biggest category this week."
  - "Quieter day than usual — only 2 expenses logged."
  - "Food spending was higher on weekdays than weekends this month."

---

## DB Changes

New migration adds 5 columns to `users` table:

```sql
ALTER TABLE users ADD COLUMN last_morning_sent_date TEXT;
ALTER TABLE users ADD COLUMN last_evening_sent_date TEXT;
ALTER TABLE users ADD COLUMN last_weekly_sent_date TEXT;
ALTER TABLE users ADD COLUMN last_monthly_sent_date TEXT;
ALTER TABLE users ADD COLUMN last_yearly_sent_date TEXT;
```

Format per column:
- Daily: `YYYY-MM-DD` (in user's local date)
- Weekly: `YYYY-WNN` (e.g. `2026-W10`)
- Monthly: `YYYY-MM`
- Yearly: `YYYY`

---

## New Files

| File | Purpose |
|------|---------|
| `src/notifications.ts` | Main dispatch: loops users, checks due types, builds + sends messages |
| `src/db/notifications.ts` | DB helpers: `getUsersForNotifications()`, `updateLastSent()` |
| `src/facts.ts` | Hardcoded curated list of science/data-backed expense tracking facts |
| `migrations/0006_notification_schedule.sql` | Adds 5 last_sent columns to users |

---

## Modified Files

| File | Change |
|------|--------|
| `wrangler.toml` | Add `[triggers]` with `crons = ["0 * * * *"]` |
| `src/index.ts` | Add `scheduled` export handler that calls `src/notifications.ts` |

---

## Reused Infrastructure

- `sendTelegramChatMessage()` — already exists in `src/telegram/messages.ts`
- `getExpenses()` — already exists in `src/db/expenses.ts`
- `getPeriodUtcRange()` — already exists in `src/totals.ts`
- User timezone from `users.timezone` — already stored

---

## Multi-User Behaviour

The hourly cron fetches all users in a single DB query. For each user, timezone-local time is computed independently. This scales to any number of users with no config changes.

---

## Constraints

- No financial advice in any message (MAS / BSP compliance)
- AI insight is observational only — describes patterns, never recommends actions
- Empty state facts are hardcoded with real citations (not AI-generated, to prevent hallucinated statistics)
- Users cannot currently opt out (future feature)
