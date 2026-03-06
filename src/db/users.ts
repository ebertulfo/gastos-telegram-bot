import type { Env } from "../types";

export type UserRecord = {
  id: number;
  telegram_user_id: number;
  telegram_chat_id: number;
  timezone: string | null;
  currency: string | null;
  onboarding_step: string | null;
  tier: "free" | "premium";
};

export async function getUserByTelegramUserId(env: Env, telegramUserId: number): Promise<UserRecord | null> {
  const row = await env.DB.prepare(
    `SELECT id, telegram_user_id, telegram_chat_id, timezone, currency, onboarding_step, tier
     FROM users
     WHERE telegram_user_id = ?`
  )
    .bind(telegramUserId)
    .first<UserRecord>();

  return row ?? null;
}

export async function upsertUserForStart(
  env: Env,
  telegramUserId: number,
  telegramChatId: number
): Promise<UserRecord> {
  await env.DB.prepare(
    `INSERT INTO users (
      telegram_user_id,
      telegram_chat_id,
      timezone,
      currency,
      onboarding_step,
      created_at_utc
    ) VALUES (?, ?, NULL, NULL, 'awaiting_currency', ?)
    ON CONFLICT(telegram_user_id) DO UPDATE SET
      telegram_chat_id = excluded.telegram_chat_id,
      timezone = NULL,
      currency = NULL,
      onboarding_step = 'awaiting_currency'`
  )
    .bind(telegramUserId, telegramChatId, new Date().toISOString())
    .run();

  const user = await getUserByTelegramUserId(env, telegramUserId);
  if (!user) {
    throw new Error("Failed to upsert onboarding user");
  }
  return user;
}

export async function upsertUserForIngestion(
  env: Env,
  telegramUserId: number,
  telegramChatId: number
): Promise<UserRecord> {
  await env.DB.prepare(
    `INSERT INTO users (
      telegram_user_id,
      telegram_chat_id,
      timezone,
      currency,
      onboarding_step,
      created_at_utc
    ) VALUES (?, ?, NULL, NULL, NULL, ?)
    ON CONFLICT(telegram_user_id) DO UPDATE SET
      telegram_chat_id = excluded.telegram_chat_id`
  )
    .bind(telegramUserId, telegramChatId, new Date().toISOString())
    .run();

  const user = await getUserByTelegramUserId(env, telegramUserId);
  if (!user) {
    throw new Error("Failed to upsert ingestion user");
  }
  return user;
}

export async function updateUserOnboardingState(
  env: Env,
  userId: number,
  input: {
    timezone?: string | null;
    currency?: string | null;
    onboardingStep: string;
  }
) {
  await env.DB.prepare(
    `UPDATE users
     SET timezone = COALESCE(?, timezone),
         currency = COALESCE(?, currency),
         onboarding_step = ?
     WHERE id = ?`
  )
    .bind(input.timezone ?? null, input.currency ?? null, input.onboardingStep, userId)
    .run();
}

export async function setUserTimezone(env: Env, userId: number, timezone: string) {
  await env.DB.prepare(
    `UPDATE users
     SET timezone = ?
     WHERE id = ?`
  )
    .bind(timezone, userId)
    .run();
}
