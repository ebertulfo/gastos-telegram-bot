# Teaching a Bot to Check In Without Being Annoying

**Date:** 2026-03-06
**Commits:** 5 commits

## What Changed
- Designed and implemented proactive daily notifications with per-user timezone-aware scheduling
- Added D1 migration (`0006_notification_schedule.sql`) with `last_notified_at` and related tracking columns to the users table
- Built `dispatchNotifications()` system with morning/evening/weekly/monthly/yearly scheduling based on each user's local time
- Created `src/facts.ts` with 20 curated, science-backed expense tracking facts (with citations) that rotate by day-of-year via `getFactForDay()`
- Added `src/db/notifications.ts` with `getUsersForNotifications()` and `updateLastSent()` query modules
- Configured hourly cron trigger (`[0 * * * *]`) in `wrangler.toml` with scheduled export handler in `src/index.ts`
- Full design doc and implementation plan before writing any code

## Why
A personal expense tracker that never reaches out is easy to forget. I wanted Gastos to send a daily spending summary at a natural time in the user's evening — not a 3am UTC blast that wakes someone up in Manila. The constraint was keeping it useful without crossing into spam territory: if you spent nothing today, you shouldn't get a "you spent $0" message. That's when the fun facts idea came in — give the user something worth reading even on quiet days, so the notification still feels like it earned the interruption.

## Key Decisions
| Decision | Options Considered | Chosen | Why |
|----------|-------------------|--------|-----|
| Scheduling model | Blast all users at fixed UTC time, per-user timezone scheduling, user-configurable time | Per-user timezone scheduling (evening 9PM local) | Users in different timezones need summaries at locally sensible times. Hardcoded UTC would mean 3am notifications for some. User-configurable adds UI complexity I didn't need yet. |
| Cron frequency | Every 15 min, every hour, daily | Hourly cron with "already sent today" guard | Hourly is frequent enough to hit each timezone's window without burning queue invocations. The idempotent guard (`last_notified_at`) prevents double-sends if cron fires twice. |
| Empty state handling | Skip notification entirely, send "$0 spent" message, send fun fact | Rotating fun facts | Skipping feels like the bot died. "$0 spent" is useless. Fun facts keep the habit of opening the bot without being annoying. 20 facts rotating by day-of-year means no repeats for almost 3 weeks. |
| AI insight in summaries | No AI, LLM-generated financial advice, observational AI summary | Observational only (no financial advice) | Financial advice from a bot is irresponsible and potentially harmful. Observations like "your food spending is up 15% this week" are useful without being prescriptive. |
| Implementation pattern | Jump into code, design then build | Design doc then plan then implement | This was the first feature where I committed to the design-first workflow. Having the plan written down before coding meant the D1 migration, query modules, and dispatch logic all came together without backtracking. |

## How (Workflow)
Followed design doc -> implementation plan -> build for the first time on this project. Started with the design spec to pin down the scheduling model and empty state strategy. The plan broke it into clear tasks: migration first, then DB queries, then facts module, then dispatch logic, then cron wiring.

The facts module was the most fun to write — researching behavioral economics and expense tracking psychology, then condensing each finding into a one-liner with a citation. Used Claude to help curate and verify the citations.

The trickiest part was the timezone math. Each user stores their IANA timezone from onboarding. The cron handler converts "now" to each user's local time and checks whether the notification window applies. The `last_notified_at` column provides the idempotency guard.

## Metrics
- 8 files changed, ~1,372 lines added
- 1 D1 migration (`0006_notification_schedule.sql`)
- 2 new source files (`src/notifications.ts`, `src/facts.ts`), 1 new DB module (`src/db/notifications.ts`)
- 20 curated facts with citations
- 2 docs (design spec + implementation plan, ~916 lines combined)
- No new tests added (notification dispatch is integration-heavy; covered by manual testing against prod)

## Learnings
- **Empty states are a design problem, not an edge case.** The fun facts approach turned what would have been a "skip this notification" scenario into one of the more engaging touchpoints. I've seen this pattern in Duolingo and Headspace — they never send you nothing.
- **Timezone-aware cron is deceptively complex.** You can't just store a UTC offset because DST changes it. Storing the IANA timezone and computing local time on each cron tick is the only correct approach. Glad I invested in that during onboarding.
- **Design-first paid off here.** The scheduling model and empty state strategy were the hard decisions. Once those were written down, the implementation was mechanical. Without the design doc, I would have started coding the cron handler and realized halfway through that I hadn't thought about what to send when there are no expenses.
- **Observational AI is a sweet spot.** There's a huge gap between "here are your numbers" and "you should spend less on food." Observations fill that gap — they feel intelligent without being presumptuous.

## Content Angles
- "Designing Notifications That Don't Annoy: Timezone-Aware Scheduling for Personal Bots" — the UX thinking behind per-user timing and empty state engagement
- "Fun Facts as Empty State: A Retention Pattern Borrowed from Consumer Apps" — applying Duolingo-style engagement to a side project
- "Design Doc First, Even for Side Projects" — why writing 900 lines of planning docs before code made a 450-line feature easier to build
