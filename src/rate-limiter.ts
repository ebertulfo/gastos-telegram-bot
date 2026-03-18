import type { Env } from "./types";

const MAX_CHAT_MESSAGES_PER_HOUR = 20;
const MAX_API_REQUESTS_PER_HOUR = 100;

async function checkHourlyLimit(env: Env, keyPrefix: string, max: number): Promise<boolean> {
    const now = new Date();
    const hourBucket = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}T${now.getUTCHours()}`;
    const key = `${keyPrefix}:${hourBucket}`;

    const currentCountStr = await env.RATE_LIMITER.get(key);
    const count = currentCountStr ? parseInt(currentCountStr, 10) : 0;

    if (count >= max) {
        return false;
    }

    await env.RATE_LIMITER.put(key, (count + 1).toString(), { expirationTtl: 3600 });
    return true;
}

export function checkRateLimit(env: Env, telegramUserId: number): Promise<boolean> {
    return checkHourlyLimit(env, `ratelimit:chat:${telegramUserId}`, MAX_CHAT_MESSAGES_PER_HOUR);
}

export function checkApiRateLimit(env: Env, userId: number): Promise<boolean> {
    return checkHourlyLimit(env, `ratelimit:api:${userId}`, MAX_API_REQUESTS_PER_HOUR);
}
