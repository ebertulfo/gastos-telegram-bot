export type NotificationType = "morning" | "evening" | "weekly" | "monthly" | "yearly";

export type UserForNotification = {
  id: number;
  telegram_chat_id: number;
  timezone: string;
  currency: string;
  last_morning_sent_date: string | null;
  last_evening_sent_date: string | null;
  last_weekly_sent_date: string | null;
  last_monthly_sent_date: string | null;
  last_yearly_sent_date: string | null;
};

const COLUMN_FOR_TYPE: Record<NotificationType, string> = {
  morning: "last_morning_sent_date",
  evening: "last_evening_sent_date",
  weekly: "last_weekly_sent_date",
  monthly: "last_monthly_sent_date",
  yearly: "last_yearly_sent_date",
};

export async function getUsersForNotifications(db: D1Database): Promise<UserForNotification[]> {
  const { results } = await db
    .prepare(
      `SELECT id, telegram_chat_id, timezone, currency,
              last_morning_sent_date, last_evening_sent_date,
              last_weekly_sent_date, last_monthly_sent_date, last_yearly_sent_date
       FROM users
       WHERE onboarding_step = 'completed'
         AND timezone IS NOT NULL
         AND currency IS NOT NULL`
    )
    .all<UserForNotification>();
  return results ?? [];
}

export async function updateLastSent(
  db: D1Database,
  userId: number,
  type: NotificationType,
  value: string
): Promise<void> {
  const column = COLUMN_FOR_TYPE[type];
  await db
    .prepare(`UPDATE users SET ${column} = ? WHERE id = ?`)
    .bind(value, userId)
    .run();
}
