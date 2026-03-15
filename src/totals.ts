import type { Env } from "./types";

export type TotalsPeriod = "today" | "yesterday" | "thisweek" | "lastweek" | "thismonth" | "lastmonth" | "thisyear" | "lastyear";

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export type TotalsResult = {
  totalMinor: number;
  count: number;
  needsReviewCount: number;
};

export function parseTotalsPeriod(command: string): TotalsPeriod | null {
  const normalized = command.trim().toLowerCase();
  const map: Record<string, TotalsPeriod> = {
    "/today": "today",
    "/yesterday": "yesterday",
    "/thisweek": "thisweek",
    "/lastweek": "lastweek",
    "/thismonth": "thismonth",
    "/lastmonth": "lastmonth",
    "/thisyear": "thisyear",
    "/lastyear": "lastyear",
  };
  return map[normalized] ?? null;
}

export async function getTotalsForUserAndPeriod(
  env: Env,
  input: { userId: number; currency: string; timezone: string; period: TotalsPeriod; now?: Date }
): Promise<TotalsResult> {
  const now = input.now ?? new Date();
  const range = getPeriodUtcRange(now, input.timezone, input.period);

  const row = await env.DB.prepare(
    `SELECT
       COALESCE(SUM(amount_minor), 0) AS total_minor,
       COUNT(*) AS count,
       COALESCE(SUM(CASE WHEN status = 'needs_review' THEN 1 ELSE 0 END), 0) AS needs_review_count
      FROM expenses
     WHERE user_id = ?
       AND occurred_at_utc >= ?
       AND occurred_at_utc <= ?`
  )
    .bind(input.userId, range.startUtc.toISOString(), range.endUtc.toISOString())
    .first<{ total_minor: number | string; count: number | string; needs_review_count: number | string }>();

  return {
    totalMinor: toInt(row?.total_minor),
    count: toInt(row?.count),
    needsReviewCount: toInt(row?.needs_review_count)
  };
}

export function formatTotalsMessage(input: {
  currency: string;
  totals: TotalsResult;
  period: TotalsPeriod;
}): string {
  const formattedTotal = formatMinorAsMoney(input.totals.totalMinor);
  const label = periodLabel(input.period);
  const lines = [
    `${label} — ${input.currency} ${formattedTotal}`,
    `${input.totals.count} expenses`,
  ];
  if (input.totals.needsReviewCount > 0) {
    lines.push(`${input.totals.needsReviewCount} need review`);
  }
  return lines.join("\n");
}

export function getPeriodUtcRange(now: Date, timezone: string, period: TotalsPeriod): { startUtc: Date; endUtc: Date } {
  const localNow = getDatePartsInTimeZone(now, timezone);

  let startLocal: { year: number; month: number; day: number };
  let nextStartLocal: { year: number; month: number; day: number };

  if (period === "today") {
    startLocal = { year: localNow.year, month: localNow.month, day: localNow.day };
    nextStartLocal = shiftLocalDate(startLocal, 1);
  } else if (period === "yesterday") {
    startLocal = shiftLocalDate({ year: localNow.year, month: localNow.month, day: localNow.day }, -1);
    nextStartLocal = { year: localNow.year, month: localNow.month, day: localNow.day };
  } else if (period === "thisweek") {
    const dayOfWeek = getDayOfWeek(localNow.year, localNow.month, localNow.day);
    const mondayOffset = (dayOfWeek + 6) % 7;
    startLocal = shiftLocalDate({ year: localNow.year, month: localNow.month, day: localNow.day }, -mondayOffset);
    nextStartLocal = shiftLocalDate(startLocal, 7);
  } else if (period === "lastweek") {
    const dayOfWeek = getDayOfWeek(localNow.year, localNow.month, localNow.day);
    const mondayOffset = (dayOfWeek + 6) % 7;
    const thisMonday = shiftLocalDate({ year: localNow.year, month: localNow.month, day: localNow.day }, -mondayOffset);
    startLocal = shiftLocalDate(thisMonday, -7);
    nextStartLocal = thisMonday;
  } else if (period === "thismonth") {
    startLocal = { year: localNow.year, month: localNow.month, day: 1 };
    if (localNow.month === 12) {
      nextStartLocal = { year: localNow.year + 1, month: 1, day: 1 };
    } else {
      nextStartLocal = { year: localNow.year, month: localNow.month + 1, day: 1 };
    }
  } else if (period === "lastmonth") {
    if (localNow.month === 1) {
      startLocal = { year: localNow.year - 1, month: 12, day: 1 };
    } else {
      startLocal = { year: localNow.year, month: localNow.month - 1, day: 1 };
    }
    nextStartLocal = { year: localNow.year, month: localNow.month, day: 1 };
  } else if (period === "lastyear") {
    startLocal = { year: localNow.year - 1, month: 1, day: 1 };
    nextStartLocal = { year: localNow.year, month: 1, day: 1 };
  } else {
    // thisyear
    startLocal = { year: localNow.year, month: 1, day: 1 };
    nextStartLocal = { year: localNow.year + 1, month: 1, day: 1 };
  }

  const startUtc = localDateTimeToUtc(
    timezone,
    startLocal.year,
    startLocal.month,
    startLocal.day,
    0,
    0,
    0
  );
  const nextStartUtc = localDateTimeToUtc(
    timezone,
    nextStartLocal.year,
    nextStartLocal.month,
    nextStartLocal.day,
    0,
    0,
    0
  );
  const endUtc = new Date(nextStartUtc.getTime() - 1);

  return { startUtc, endUtc };
}

export function periodLabel(period: TotalsPeriod): string {
  const labels: Record<TotalsPeriod, string> = {
    today: "Today",
    yesterday: "Yesterday",
    thisweek: "This Week",
    lastweek: "Last Week",
    thismonth: "This Month",
    lastmonth: "Last Month",
    thisyear: "This Year",
    lastyear: "Last Year",
  };
  return labels[period];
}

function formatMinorAsMoney(amountMinor: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amountMinor / 100);
}

function toInt(value: number | string | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getDatePartsInTimeZone(date: Date, timezone: string): DateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  const parts = formatter.formatToParts(date);
  const lookup = (type: string) => Number.parseInt(parts.find((part) => part.type === type)?.value ?? "0", 10);

  return {
    year: lookup("year"),
    month: lookup("month"),
    day: lookup("day"),
    hour: lookup("hour"),
    minute: lookup("minute"),
    second: lookup("second")
  };
}

function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const parts = getDatePartsInTimeZone(date, timezone);
  const zonedAsUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return zonedAsUtcMs - date.getTime();
}

function localDateTimeToUtc(
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): Date {
  const utcGuessMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const guessDate = new Date(utcGuessMs);

  const localFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  const parts = localFormatter.formatToParts(guessDate);
  const lookup = (type: string) => Number.parseInt(parts.find((part) => part.type === type)?.value ?? "0", 10);

  const localGuessMs = Date.UTC(
    lookup("year"),
    lookup("month") - 1,
    lookup("day"),
    lookup("hour"),
    lookup("minute"),
    lookup("second")
  );

  const offsetMs = localGuessMs - utcGuessMs;
  return new Date(utcGuessMs - offsetMs);
}

function shiftLocalDate(input: { year: number; month: number; day: number }, deltaDays: number) {
  const date = new Date(Date.UTC(input.year, input.month - 1, input.day));
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function getDayOfWeek(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
