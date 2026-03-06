import type { D1Database } from "@cloudflare/workers-types";
import config from "../config.json";

export interface UserQuota {
    user_id: number;
    tokens_used_today: number;
    last_usage_date_utc: string; // YYYY-MM-DD
}

/**
 * Ensures the user has not exceeded their daily OpenAI token budget.
 * Uses Lazy Evaluation: If their last usage was yesterday, we reset their count to 0 dynamically.
 */
export async function checkAndRefreshTokenQuota(db: D1Database, userId: number, telegramId: number, tier: "free" | "premium"): Promise<boolean> {
    // 0. Premium Tier Bypass
    if (tier === "premium") {
        return true;
    }

    // 1. Admin Override (from JSON config)
    if ((config.admin.unlimited_telegram_ids as number[]).includes(telegramId)) {
        return true;
    }

    const todayUTC = new Date().toISOString().split('T')[0];

    // 2. Fetch current record
    const record = await db.prepare(
        `SELECT tokens_used_today, last_usage_date_utc FROM user_quotas WHERE user_id = ?`
    ).bind(userId).first<UserQuota>();

    if (!record) {
        // First time user, they are good to go.
        await db.prepare(
            `INSERT INTO user_quotas (user_id, tokens_used_today, last_usage_date_utc) VALUES (?, 0, ?)`
        ).bind(userId, todayUTC).run();
        return true;
    }

    // 3. Lazy Evaluation Reset
    if (record.last_usage_date_utc < todayUTC) {
        await db.prepare(
            `UPDATE user_quotas SET tokens_used_today = 0, last_usage_date_utc = ? WHERE user_id = ?`
        ).bind(todayUTC, userId).run();
        return true; // Budget reset, they are allowed
    }

    // 4. Enforce Today's Limit
    if (record.tokens_used_today >= config.limits.daily_token_quota) {
        return false; // Denied
    }

    return true; // Allowed
}

/**
 * Read the usage payload from OpenAI and sum it to the user's daily budget.
 */
export async function incrementTokenUsage(db: D1Database, userId: number, tokensUsed: number): Promise<void> {
    const todayUTC = new Date().toISOString().split('T')[0];

    await db.prepare(`
        INSERT INTO user_quotas (user_id, tokens_used_today, last_usage_date_utc)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET 
            tokens_used_today = CASE 
                WHEN last_usage_date_utc < excluded.last_usage_date_utc THEN excluded.tokens_used_today
                ELSE tokens_used_today + excluded.tokens_used_today
            END,
            last_usage_date_utc = excluded.last_usage_date_utc
    `).bind(userId, tokensUsed, todayUTC).run();
}
