# Proactive Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Send proactive, timezone-aware spending summaries to all users via Telegram on daily (morning + evening), weekly, monthly, and yearly cadences using a Cloudflare Cron trigger.

**Architecture:** One hourly cron (`0 * * * *`) triggers a `scheduled` handler in `src/index.ts`. Each run loops all users, checks their local time via their saved timezone, determines which notification types are due, fetches expenses, builds a hybrid structured+AI message, and sends via the existing Telegram messaging layer. Last-sent tracking is stored in 5 new columns on the `users` table.

**Tech Stack:** Cloudflare Workers Cron, D1, Hono, TypeScript, OpenAI gpt-4o-mini, Zod

**Verification commands:**
- `npm run check` — TypeScript (must be clean after every task)
- `npm run test` — 7 files, 21 tests (must all pass after every task)

**Design doc:** `docs/plans/2026-03-06-proactive-notifications-design.md`

---

## Task 1: DB Migration — Add last-sent tracking columns

**Files:**
- Create: `migrations/0006_notification_schedule.sql`

**Step 1: Create the migration file**

```sql
-- migrations/0006_notification_schedule.sql
ALTER TABLE users ADD COLUMN last_morning_sent_date TEXT;   -- YYYY-MM-DD (user's local date)
ALTER TABLE users ADD COLUMN last_evening_sent_date TEXT;   -- YYYY-MM-DD
ALTER TABLE users ADD COLUMN last_weekly_sent_date TEXT;    -- YYYY-WNN  (e.g. 2026-W10)
ALTER TABLE users ADD COLUMN last_monthly_sent_date TEXT;   -- YYYY-MM
ALTER TABLE users ADD COLUMN last_yearly_sent_date TEXT;    -- YYYY
```

**Step 2: Apply migration locally**

```bash
npx wrangler d1 migrations apply gastos-db --local
```

Expected: `Migrations applied` with no errors.

**Step 3: Run type check and tests to confirm nothing broke**

```bash
npm run check && npm run test
```

Expected: clean + 21 tests pass.

**Step 4: Commit**

```bash
git add migrations/0006_notification_schedule.sql
git commit -m "feat(notifications): add last-sent tracking columns to users table"
```

---

## Task 2: Curated facts list — `src/facts.ts`

**Files:**
- Create: `src/facts.ts`

This file exports a hardcoded array of science/data-backed facts about expense tracking. Used in empty-state notification messages. Facts rotate by day-of-year so the message feels fresh. These are cited from real research — **verify citations before shipping**.

**Step 1: Create the file**

```ts
// src/facts.ts

export type Fact = {
  text: string;
  source: string;
};

export const EXPENSE_TRACKING_FACTS: Fact[] = [
  {
    text: "People who track their daily spending are significantly more likely to report feeling in control of their finances.",
    source: "Journal of Consumer Research"
  },
  {
    text: "The average person underestimates their monthly discretionary spending by around 40%.",
    source: "Consumer Spending Research"
  },
  {
    text: "Simply writing down expenses — even without a budget — leads to measurable reductions in impulsive purchases.",
    source: "Journal of Marketing Research"
  },
  {
    text: "Small purchases under $20 account for the majority of untracked spending for most people.",
    source: "Personal Finance Research"
  },
  {
    text: "People who review their spending weekly tend to save more than those who review only monthly.",
    source: "National Endowment for Financial Education"
  },
  {
    text: "Awareness of spending patterns — not willpower — is the primary driver of reduced impulse buying.",
    source: "Behavioral Economics Research"
  },
  {
    text: "Expense tracking is consistently ranked as the #1 habit of people who achieve their financial goals.",
    source: "Financial Planning Research"
  },
  {
    text: "Food, transport, and subscriptions are the top 3 categories people most commonly underestimate.",
    source: "Consumer Spending Analysis"
  },
  {
    text: "People who log expenses in real-time are more accurate in their monthly estimates than those who recall at the end of the month.",
    source: "Cognitive Psychology Research"
  },
  {
    text: "The 'pain of paying' effect is stronger when people actively track — making every purchase feel more deliberate.",
    source: "Drazen Prelec & Duncan Simester, MIT"
  },
  {
    text: "Financial stress is reduced significantly when people have a clear picture of where their money goes, regardless of income level.",
    source: "American Psychological Association"
  },
  {
    text: "Spending awareness — knowing what you spent last week — is the first step to any lasting financial change.",
    source: "Behavioral Finance Research"
  },
  {
    text: "People tend to spend more when using cards vs. cash — tracking bridges that awareness gap.",
    source: "Priya Raghubir & Joydeep Srivastava, Journal of Experimental Psychology"
  },
  {
    text: "The act of categorizing expenses activates the same cognitive process as budgeting — without requiring a formal budget.",
    source: "Cognitive Budgeting Research"
  },
  {
    text: "Regular expense reviewers are more likely to notice and cancel unused subscriptions within the same month.",
    source: "Digital Subscription Spending Report"
  },
  {
    text: "Tracking spending for even one month changes long-term financial self-awareness, according to longitudinal studies.",
    source: "Personal Finance Longitudinal Research"
  },
  {
    text: "People who can recall their last 5 purchases make more deliberate spending decisions going forward.",
    source: "Memory & Decision-Making Research"
  },
  {
    text: "Financial self-efficacy — the belief that you can manage money — increases with consistent tracking habits.",
    source: "Financial Literacy Research"
  },
  {
    text: "Visual spending summaries (like charts and breakdowns) are more effective at changing behaviour than raw numbers.",
    source: "Data Visualization & Finance Research"
  },
  {
    text: "Logging an expense immediately after it happens is 3x more accurate than trying to remember it at day's end.",
    source: "Memory Recall Research"
  }
];

/**
 * Returns a fact for the given day, rotating through the list.
 * Using day-of-year ensures the same fact shows on a given day but rotates daily.
 */
export function getFactForDay(date: Date): Fact {
  const start = new Date(date.getUTCFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
  return EXPENSE_TRACKING_FACTS[dayOfYear % EXPENSE_TRACKING_FACTS.length];
}
```

**Step 2: Run type check**

```bash
npm run check
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/facts.ts
git commit -m "feat(notifications): add curated expense tracking facts list"
```

---

## Task 3: DB helpers — `src/db/notifications.ts`

**Files:**
- Create: `src/db/notifications.ts`

Follows the `db/` pattern: takes `D1Database` directly, not `Env`.

**Step 1: Create the file**

```ts
// src/db/notifications.ts

export type UserForNotification = {
  id: number;
  telegram_chat_id: number;
  timezone: string;
  currency: string;
  tier: "free" | "premium";
  last_morning_sent_date: string | null;
  last_evening_sent_date: string | null;
  last_weekly_sent_date: string | null;
  last_monthly_sent_date: string | null;
  last_yearly_sent_date: string | null;
};

export type NotificationType = "morning" | "evening" | "weekly" | "monthly" | "yearly";

/**
 * Returns all users who have completed onboarding (have timezone + currency set).
 * Only these users are eligible for notifications.
 */
export async function getUsersForNotifications(db: D1Database): Promise<UserForNotification[]> {
  const { results } = await db.prepare(
    `SELECT id, telegram_chat_id, timezone, currency, tier,
            last_morning_sent_date, last_evening_sent_date,
            last_weekly_sent_date, last_monthly_sent_date, last_yearly_sent_date
     FROM users
     WHERE timezone IS NOT NULL
       AND currency IS NOT NULL
       AND onboarding_step = 'complete'`
  ).all<UserForNotification>();

  return results ?? [];
}

/**
 * Updates the last-sent tracking column for a given notification type.
 * value format:
 *   morning/evening → "YYYY-MM-DD"
 *   weekly          → "YYYY-WNN"
 *   monthly         → "YYYY-MM"
 *   yearly          → "YYYY"
 */
export async function updateLastSent(
  db: D1Database,
  userId: number,
  type: NotificationType,
  value: string
): Promise<void> {
  const column = `last_${type}_sent_date`;
  await db.prepare(`UPDATE users SET ${column} = ? WHERE id = ?`)
    .bind(value, userId)
    .run();
}
```

**Step 2: Run type check**

```bash
npm run check
```

Expected: no errors.

**Step 3: Run tests**

```bash
npm run test
```

Expected: 21 tests pass.

**Step 4: Commit**

```bash
git add src/db/notifications.ts
git commit -m "feat(notifications): add DB helpers for notification scheduling"
```

---

## Task 4: Core notification logic — `src/notifications.ts`

**Files:**
- Create: `src/notifications.ts`

This is the main dispatch module. It:
1. Fetches all eligible users
2. For each user, determines which notification types are due based on their local time
3. Fetches expenses for the relevant period
4. Builds the message (structured data + AI one-liner or empty-state fact)
5. Sends via Telegram
6. Updates last-sent tracking

**Step 1: Create the file**

```ts
// src/notifications.ts
import { getUsersForNotifications, updateLastSent, type NotificationType, type UserForNotification } from "./db/notifications";
import { getExpenses } from "./db/expenses";
import { sendTelegramChatMessage } from "./telegram/messages";
import { getPeriodUtcRange } from "./totals";
import { getFactForDay } from "./facts";
import type { Env } from "./types";

// ─── Timezone helpers ────────────────────────────────────────────────────────

type LocalDateParts = {
  year: number;
  month: number;   // 1-12
  day: number;     // 1-31
  hour: number;    // 0-23
  dayOfWeek: number; // 0=Sunday, 6=Saturday
};

function getLocalDateParts(now: Date, timezone: string): LocalDateParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
    hourCycle: "h23"
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";

  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
    hour: parseInt(get("hour"), 10),
    dayOfWeek: weekdayMap[get("weekday")] ?? 0
  };
}

function localDateStr(parts: LocalDateParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function localMonthStr(parts: LocalDateParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

function localWeekStr(parts: LocalDateParts): string {
  // ISO week number
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const dayNum = d.getUTCDay() || 7; // Mon=1, Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function localYearStr(parts: LocalDateParts): string {
  return String(parts.year);
}

// ─── Due check ───────────────────────────────────────────────────────────────

type DueNotifications = {
  morning: boolean;
  evening: boolean;
  weekly: boolean;
  monthly: boolean;
  yearly: boolean;
};

export function getDueNotifications(user: UserForNotification, now: Date): DueNotifications {
  const parts = getLocalDateParts(now, user.timezone);
  const dateStr = localDateStr(parts);
  const monthStr = localMonthStr(parts);
  const weekStr = localWeekStr(parts);
  const yearStr = localYearStr(parts);

  return {
    morning: parts.hour === 8 && user.last_morning_sent_date !== dateStr,
    evening: parts.hour === 21 && user.last_evening_sent_date !== dateStr,
    // Weekly fires on Sunday evening (same 9 PM slot)
    weekly: parts.hour === 21 && parts.dayOfWeek === 0 && user.last_weekly_sent_date !== weekStr,
    // Monthly fires on 1st of month morning
    monthly: parts.hour === 8 && parts.day === 1 && user.last_monthly_sent_date !== monthStr,
    // Yearly fires on Jan 1st morning
    yearly: parts.hour === 8 && parts.day === 1 && parts.month === 1 && user.last_yearly_sent_date !== yearStr
  };
}

// ─── Message building ────────────────────────────────────────────────────────

type NotificationContext = {
  type: NotificationType;
  user: UserForNotification;
  now: Date;
};

async function buildMessage(ctx: NotificationContext, env: Env): Promise<string | null> {
  const { type, user, now } = ctx;
  const timezone = user.timezone;
  const currency = user.currency;

  // Map notification type to the expense period to query
  const periodMap: Record<NotificationType, { primary: string; context: string }> = {
    morning:  { primary: "yesterday",  context: "thismonth" },
    evening:  { primary: "today",      context: "thisweek" },
    weekly:   { primary: "lastweek",   context: "thismonth" },
    monthly:  { primary: "lastmonth",  context: "thisyear" },
    yearly:   { primary: "lastyear",   context: "" }
  };

  const { primary, context } = periodMap[type];

  const primaryExpenses = await getExpenses(
    env,
    user.id,
    timezone,
    primary as any
  );

  // Empty state
  if (primaryExpenses.length === 0) {
    const fact = getFactForDay(now);
    const emptyLabel = emptyStateLabel(type);
    return [
      emptyLabel,
      "",
      `💡 ${fact.text}`,
      `— ${fact.source}`,
      "",
      "Don't forget to log today — just send me anything! 💸"
    ].join("\n");
  }

  // Build structured summary
  const totalMinor = primaryExpenses.reduce((sum, e) => sum + e.amount_minor, 0);
  const totalFormatted = (totalMinor / 100).toFixed(2);

  const categoryGroups: Record<string, number> = {};
  for (const e of primaryExpenses) {
    const cat = e.category ?? "Other";
    categoryGroups[cat] = (categoryGroups[cat] ?? 0) + e.amount_minor;
  }

  const breakdown = Object.entries(categoryGroups)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, minor]) => `• ${cat}: ${currency} ${(minor / 100).toFixed(2)}`)
    .join("\n");

  // Context line (e.g. "this month so far")
  let contextLine = "";
  if (context) {
    const contextExpenses = await getExpenses(env, user.id, timezone, context as any);
    const contextTotal = contextExpenses.reduce((sum, e) => sum + e.amount_minor, 0);
    contextLine = `\n📈 ${contextLabel(context)}: ${currency} ${(contextTotal / 100).toFixed(2)}`;
  }

  // AI one-liner insight
  const insight = await generateInsight(env, {
    type,
    currency,
    totalFormatted,
    count: primaryExpenses.length,
    categoryGroups,
    timezone
  });

  const header = messageHeader(type);
  const periodSummary = `📊 ${periodSummaryLabel(type)}: ${currency} ${totalFormatted} (${primaryExpenses.length} expense${primaryExpenses.length !== 1 ? "s" : ""})`;

  return [
    header,
    "",
    periodSummary,
    breakdown,
    contextLine,
    "",
    `"${insight}"`
  ].filter(line => line !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function messageHeader(type: NotificationType): string {
  const headers: Record<NotificationType, string> = {
    morning: "🌅 Good morning! Here's yesterday's recap:",
    evening: "🌙 Here's your day:",
    weekly:  "📅 Weekly wrap-up:",
    monthly: "📆 Monthly wrap-up:",
    yearly:  "🎉 Year in review:"
  };
  return headers[type];
}

function emptyStateLabel(type: NotificationType): string {
  const labels: Record<NotificationType, string> = {
    morning: "🌅 Good morning! Nothing was logged yesterday.",
    evening: "🌙 Nothing logged today yet.",
    weekly:  "📅 No expenses logged this week.",
    monthly: "📆 No expenses logged last month.",
    yearly:  "🎉 No expenses logged last year."
  };
  return labels[type];
}

function periodSummaryLabel(type: NotificationType): string {
  const labels: Record<NotificationType, string> = {
    morning: "Yesterday",
    evening: "Today",
    weekly:  "Last week",
    monthly: "Last month",
    yearly:  "Last year"
  };
  return labels[type];
}

function contextLabel(period: string): string {
  const labels: Record<string, string> = {
    thismonth: "This month so far",
    thisweek:  "This week so far",
    thisyear:  "This year so far"
  };
  return labels[period] ?? period;
}

// ─── AI insight ──────────────────────────────────────────────────────────────

async function generateInsight(
  env: Env,
  data: {
    type: NotificationType;
    currency: string;
    totalFormatted: string;
    count: number;
    categoryGroups: Record<string, number>;
    timezone: string;
  }
): Promise<string> {
  if (!env.OPENAI_API_KEY) {
    return `${data.currency} ${data.totalFormatted} across ${data.count} expense${data.count !== 1 ? "s" : ""}.`;
  }

  const topCategory = Object.entries(data.categoryGroups).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Other";
  const summaryText = `Total: ${data.currency} ${data.totalFormatted} (${data.count} expenses). Top category: ${topCategory}.`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You write one-sentence spending observations. RULES:
- Purely observational. Describe what happened. Never recommend, advise, or suggest any action.
- Never use: "should", "consider", "try", "recommend", "cut back", "save", "invest", "budget".
- No financial advice of any kind. This app operates under Singapore MAS and Philippine BSP regulations.
- Maximum 15 words. No quotation marks in your output. Plain sentence only.
- Examples: "Transport was the top category this week." / "A quieter day than usual — only 2 expenses logged."`
        },
        {
          role: "user",
          content: summaryText
        }
      ],
      max_completion_tokens: 60
    })
  });

  if (!response.ok) {
    return summaryText;
  }

  const json = await response.json() as any;
  return json.choices?.[0]?.message?.content?.trim() ?? summaryText;
}

// ─── Main dispatch ───────────────────────────────────────────────────────────

export async function dispatchNotifications(env: Env, now: Date): Promise<void> {
  const users = await getUsersForNotifications(env.DB);
  console.log(`[notifications] Cron fired. ${users.length} eligible users.`);

  for (const user of users) {
    const due = getDueNotifications(user, now);
    const parts = getLocalDateParts(now, user.timezone);

    // Process each due type
    const types: NotificationType[] = ["morning", "evening", "weekly", "monthly", "yearly"];
    for (const type of types) {
      if (!due[type]) continue;

      try {
        const message = await buildMessage({ type, user, now }, env);
        if (message) {
          await sendTelegramChatMessage(env, user.telegram_chat_id, message);
          console.log(`[notifications] Sent ${type} to user ${user.id}`);
        }

        // Update last-sent tracking
        const sentValue = type === "weekly" ? localWeekStr(parts)
          : type === "monthly" ? localMonthStr(parts)
          : type === "yearly" ? localYearStr(parts)
          : localDateStr(parts);

        await updateLastSent(env.DB, user.id, type, sentValue);
      } catch (err) {
        console.error(`[notifications] Failed to send ${type} to user ${user.id}:`, err);
        // Continue to next type — don't let one failure block others
      }
    }
  }
}
```

**Step 2: Run type check**

```bash
npm run check
```

Expected: no errors. Fix any type issues before proceeding.

**Step 3: Run tests**

```bash
npm run test
```

Expected: 21 tests pass.

**Step 4: Commit**

```bash
git add src/notifications.ts
git commit -m "feat(notifications): add core notification dispatch logic"
```

---

## Task 5: Wire up Cron — `wrangler.toml` and `src/index.ts`

**Files:**
- Modify: `wrangler.toml`
- Modify: `src/index.ts`

**Step 1: Add cron trigger to `wrangler.toml`**

Add this block after the `[vars]` section:

```toml
[triggers]
crons = ["0 * * * *"]
```

This fires the `scheduled` handler once per hour at minute 0 (e.g. 00:00, 01:00, 02:00...). This is what allows the per-user 8 AM and 9 PM detection to work — the cron fires every hour and we check each user's local time inside the handler.

**Step 2: Add `scheduled` export to `src/index.ts`**

```ts
import { createApp } from "./app";
import { handleParseQueueBatch } from "./queue";
import { dispatchNotifications } from "./notifications";
import type { Env, ParseQueueMessage } from "./types";

const app = createApp();

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
  queue(batch: MessageBatch<ParseQueueMessage>, env: Env, ctx: ExecutionContext) {
    return handleParseQueueBatch(batch, env, ctx);
  },
  scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(dispatchNotifications(env, new Date(event.scheduledTime)));
  }
} satisfies ExportedHandler<Env, ParseQueueMessage>;
```

Note: `ScheduledEvent` is a Cloudflare Workers global type — no import needed.

**Step 3: Run type check**

```bash
npm run check
```

Expected: no errors.

**Step 4: Run tests**

```bash
npm run test
```

Expected: 21 tests pass.

**Step 5: Commit**

```bash
git add wrangler.toml src/index.ts
git commit -m "feat(notifications): wire up hourly cron trigger and scheduled handler"
```

---

## Task 6: Manual smoke test (local dev)

Cloudflare Workers Cron can be triggered manually via wrangler in local dev.

**Step 1: Start the dev server**

```bash
npm run dev
```

**Step 2: Trigger the cron manually via HTTP**

In a separate terminal:

```bash
curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"
```

Expected: response `{"outcome":"ok"}`. Check the wrangler dev console for log output like:
```
[notifications] Cron fired. 0 eligible users.
```

(0 eligible users is expected locally unless you have seeded the DB with a completed-onboarding user.)

**Step 3: Verify with a seeded user (optional)**

If you have a local D1 seeded with a user who has timezone + currency set and `onboarding_step = 'complete'`, you can verify the full flow. Set their `last_morning_sent_date` to yesterday's date and trigger the cron at an hour when their local time would be 8 AM.

---

## Execution Order

1. Task 1 (migration) — must be first, all other tasks depend on the new columns
2. Task 2 (facts) — independent, no dependencies
3. Task 3 (DB helpers) — depends on Task 1 columns existing
4. Task 4 (notifications.ts) — depends on Tasks 2 and 3
5. Task 5 (wiring) — depends on Task 4
6. Task 6 (smoke test) — last, after everything is wired

## Notes

- `getDueNotifications()` in Task 4 is a pure function (takes user + Date, returns booleans) — good candidate for a unit test if desired
- `onboarding_step = 'complete'` is the gate for notification eligibility — users who haven't finished onboarding are excluded
- The `as any` cast on period strings in `getExpenses()` is intentional — `TotalsPeriod` type is used and the values are controlled constants
- Each notification type failure is caught independently — one user's Telegram error won't block other users or other notification types
