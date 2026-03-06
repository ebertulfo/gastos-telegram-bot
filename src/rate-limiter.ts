import type { Env } from "./types";

const MAX_CHAT_MESSAGES_PER_HOUR = 20;

/**
 * Checks if the user has exceeded their Chat API quota for the current hour.
 * Uses Cloudflare KV with an automatic 1-hour expiration TTL per bucket.
 * 
 * @returns true if the user is allowed to proceed, false if they are rate limited.
 */
export async function checkRateLimit(env: Env, telegramUserId: number): Promise<boolean> {
    // Bucket key based on user and the current hour (e.g. "rate_limit:12345:2026-02-28T09")
    const now = new Date();
    const hourBucket = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}T${now.getUTCHours()}`;
    const key = `ratelimit:chat:${telegramUserId}:${hourBucket}`;

    const currentCountStr = await env.RATE_LIMITER.get(key);
    const count = currentCountStr ? parseInt(currentCountStr, 10) : 0;

    if (count >= MAX_CHAT_MESSAGES_PER_HOUR) {
        return false; // Rate limited
    }

    // Increment and set TTL to expire automatically after 1 hour (3600 seconds)
    // Cloudflare KV requires TTL to be at least 60 seconds
    await env.RATE_LIMITER.put(key, (count + 1).toString(), { expirationTtl: 3600 });

    return true; // Allowed
}
