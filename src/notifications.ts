import { getUsersForNotifications, updateLastSent } from "./db/notifications";
import type { NotificationType, UserForNotification } from "./db/notifications";
import { sendTelegramChatMessage } from "./telegram/messages";
import { getPeriodUtcRange } from "./totals";
import { getFactForDay } from "./facts";
import type { Env } from "./types";

// ---------------------------------------------------------------------------
// Entry point — called by the scheduled cron handler
// ---------------------------------------------------------------------------

export async function dispatchNotifications(env: Env, now: Date): Promise<void> {
  const users = await getUsersForNotifications(env.DB);

  for (const user of users) {
    const due = getDueNotifications(user, now);
    for (const type of due) {
      try {
        await sendNotification(env, user, type, now);
        await updateLastSent(env.DB, user.id, type, lastSentValue(type, now, user.timezone));
      } catch (err) {
        console.error("Notification failed", { userId: user.id, type, error: String(err) });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Scheduling — determines which notification types are due for a user
// ---------------------------------------------------------------------------

type LocalDate = { year: number; month: number; day: number; hour: number; dayOfWeek: number };

function getLocalDate(now: Date, timezone: string): LocalDate {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday"); // "Sun", "Mon", ...
  const dayOfWeekMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    dayOfWeek: dayOfWeekMap[weekday] ?? 0,
  };
}

function isoWeek(year: number, month: number, day: number): string {
  // ISO 8601 week: week 1 = week containing first Thursday of the year
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayNum = d.getUTCDay() || 7; // Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function lastSentValue(type: NotificationType, now: Date, timezone: string): string {
  const ld = getLocalDate(now, timezone);
  if (type === "morning" || type === "evening") {
    return `${ld.year}-${String(ld.month).padStart(2, "0")}-${String(ld.day).padStart(2, "0")}`;
  }
  if (type === "weekly") return isoWeek(ld.year, ld.month, ld.day);
  if (type === "monthly") return `${ld.year}-${String(ld.month).padStart(2, "0")}`;
  return String(ld.year); // yearly
}

export function getDueNotifications(user: UserForNotification, now: Date): NotificationType[] {
  const ld = getLocalDate(now, user.timezone);
  const due: NotificationType[] = [];

  // Monthly and yearly replace morning on their trigger days
  const isMonthlyDay = ld.day === 1 && ld.hour === 8;
  const isYearlyDay = ld.month === 1 && ld.day === 1 && ld.hour === 8;

  if (isYearlyDay) {
    const yearStr = String(ld.year);
    if (user.last_yearly_sent_date !== yearStr) due.push("yearly");
  } else if (isMonthlyDay) {
    const monthStr = `${ld.year}-${String(ld.month).padStart(2, "0")}`;
    if (user.last_monthly_sent_date !== monthStr) due.push("monthly");
  } else if (ld.hour === 8) {
    const dateStr = `${ld.year}-${String(ld.month).padStart(2, "0")}-${String(ld.day).padStart(2, "0")}`;
    if (user.last_morning_sent_date !== dateStr) due.push("morning");
  }

  if (ld.hour === 21) {
    const dateStr = `${ld.year}-${String(ld.month).padStart(2, "0")}-${String(ld.day).padStart(2, "0")}`;
    if (user.last_evening_sent_date !== dateStr) due.push("evening");

    // Weekly fires alongside evening on Sundays
    if (ld.dayOfWeek === 0) {
      const weekStr = isoWeek(ld.year, ld.month, ld.day);
      if (user.last_weekly_sent_date !== weekStr) due.push("weekly");
    }
  }

  return due;
}

// ---------------------------------------------------------------------------
// Message building and sending
// ---------------------------------------------------------------------------

type CategoryTotal = { category: string; total_minor: number };

async function getCategoryBreakdown(
  env: Env,
  userId: number,
  startUtc: Date,
  endUtc: Date
): Promise<{ totalMinor: number; count: number; categories: CategoryTotal[] }> {
  const [summaryRow, catRows] = await Promise.all([
    env.DB.prepare(
      `SELECT COALESCE(SUM(amount_minor),0) AS total_minor, COUNT(*) AS count
       FROM expenses
       WHERE user_id = ? AND occurred_at_utc >= ? AND occurred_at_utc <= ?`
    )
      .bind(userId, startUtc.toISOString(), endUtc.toISOString())
      .first<{ total_minor: number; count: number }>(),

    env.DB.prepare(
      `SELECT category, COALESCE(SUM(amount_minor),0) AS total_minor
       FROM expenses
       WHERE user_id = ? AND occurred_at_utc >= ? AND occurred_at_utc <= ?
       GROUP BY category
       ORDER BY total_minor DESC
       LIMIT 5`
    )
      .bind(userId, startUtc.toISOString(), endUtc.toISOString())
      .all<CategoryTotal>(),
  ]);

  return {
    totalMinor: summaryRow?.total_minor ?? 0,
    count: summaryRow?.count ?? 0,
    categories: catRows.results ?? [],
  };
}

function fmt(amountMinor: number, currency: string): string {
  return `${currency} ${(amountMinor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function categoryLines(categories: CategoryTotal[], currency: string): string {
  if (categories.length === 0) return "";
  return categories.map((c) => `  • ${c.category}: ${fmt(c.total_minor, currency)}`).join("\n");
}

async function getAiInsight(env: Env, summaryText: string): Promise<string | null> {
  if (!env.OPENAI_API_KEY) return null;
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-nano",
        max_tokens: 80,
        messages: [
          {
            role: "system",
            content: [
              "You produce one short, purely observational sentence about the spending data provided.",
              "NEVER use: should, consider, recommend, try, need to, cut back, save, advice, budget.",
              "NEVER compare to other people. NEVER suggest actions.",
              "Describe what happened factually. Example: 'Food was your biggest category this week.'",
            ].join(" "),
          },
          { role: "user", content: summaryText },
        ],
      }),
    });

    if (!response.ok) return null;
    const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

function buildEmptyStateMessage(type: NotificationType, now: Date): string {
  const fact = getFactForDay(now);
  const greeting =
    type === "morning" || type === "monthly" || type === "yearly"
      ? "Good morning — nothing logged yet"
      : "No expenses logged today";

  return [
    greeting,
    "",
    `"${fact.text}"`,
    `— ${fact.source}`,
  ].join("\n");
}

async function sendNotification(
  env: Env,
  user: UserForNotification,
  type: NotificationType,
  now: Date
): Promise<void> {
  const tz = user.timezone;
  const cur = user.currency;

  let header: string;
  let primaryPeriod: { startUtc: Date; endUtc: Date };
  let contextPeriod: { startUtc: Date; endUtc: Date } | null = null;
  let contextLabel: string | null = null;

  if (type === "morning") {
    header = "Good morning! Here's yesterday's recap:";
    primaryPeriod = getPeriodUtcRange(now, tz, "yesterday");
    contextPeriod = getPeriodUtcRange(now, tz, "thismonth");
    contextLabel = "This month so far";
  } else if (type === "evening") {
    header = "Here's your day:";
    primaryPeriod = getPeriodUtcRange(now, tz, "today");
    contextPeriod = getPeriodUtcRange(now, tz, "thisweek");
    contextLabel = "This week so far";
  } else if (type === "weekly") {
    header = "Weekly rollup — here's how your week looked:";
    primaryPeriod = getPeriodUtcRange(now, tz, "thisweek");
    contextPeriod = getPeriodUtcRange(now, tz, "lastweek");
    contextLabel = "Last week";
  } else if (type === "monthly") {
    header = "Monthly rollup — here's your month:";
    primaryPeriod = getPeriodUtcRange(now, tz, "lastmonth");
    contextPeriod = getPeriodUtcRange(now, tz, "thismonth");
    contextLabel = "This month so far";
  } else {
    // yearly
    header = "Year in review:";
    primaryPeriod = getPeriodUtcRange(now, tz, "lastyear");
    contextPeriod = getPeriodUtcRange(now, tz, "thisyear");
    contextLabel = "This year so far";
  }

  const primary = await getCategoryBreakdown(env, user.id, primaryPeriod.startUtc, primaryPeriod.endUtc);

  if (primary.count === 0) {
    await sendTelegramChatMessage(env, user.telegram_chat_id, buildEmptyStateMessage(type, now));
    return;
  }

  const lines: string[] = [header, ""];

  const primaryLabel =
    type === "morning"
      ? "Yesterday"
      : type === "evening"
        ? "Today"
        : type === "weekly"
          ? "This week"
          : type === "monthly"
            ? "Last month"
            : "Last year";

  lines.push(`${primaryLabel}: ${fmt(primary.totalMinor, cur)} (${primary.count} expenses)`);
  if (primary.categories.length > 0) {
    lines.push(categoryLines(primary.categories, cur));
  }

  if (contextPeriod && contextLabel) {
    const context = await getCategoryBreakdown(env, user.id, contextPeriod.startUtc, contextPeriod.endUtc);
    if (context.count > 0) {
      lines.push("");
      lines.push(`${contextLabel}: ${fmt(context.totalMinor, cur)}`);
    }
  }

  const summaryForAi = lines.join("\n");
  const insight = await getAiInsight(env, summaryForAi);
  if (insight) {
    lines.push("");
    lines.push(`"${insight}"`);
  }

  await sendTelegramChatMessage(env, user.telegram_chat_id, lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Trace cleanup — deletes spans older than 30 days, batched to 500 rows
// ---------------------------------------------------------------------------

export async function cleanupOldTraces(db: D1Database): Promise<void> {
  await db
    .prepare(
      "DELETE FROM traces WHERE id IN (SELECT id FROM traces WHERE created_at_utc < datetime('now', '-30 days') LIMIT 500)"
    )
    .run();
}
