import type { D1Database } from "@cloudflare/workers-types";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
    id: number;
    user_id: number;
    role: ChatRole;
    content: string;
    created_at_utc: string;
}

/**
 * Inserts a new message into the user's chat history.
 */
export async function insertChatMessage(
    db: D1Database,
    userId: number,
    role: ChatRole,
    content: string
): Promise<void> {
    await db.prepare(
        `INSERT INTO chat_history (user_id, role, content) VALUES (?, ?, ?)`
    )
        .bind(userId, role, content)
        .run();
}

/**
 * Retrieves the most recent N messages for a user, ordered chronologically.
 * This inherently acts as our Token Guardrail / TTL mechanism.
 */
export async function getRecentChatHistory(
    db: D1Database,
    userId: number,
    limit: number = 10
): Promise<{ role: ChatRole; content: string }[]> {
    // We order by DESC to get the newest `limit` messages, 
    // but the LLM expects the array in chronological order (oldest first).
    // So we wrap it in a subquery and sort ASC.
    const results = await db.prepare(
        `SELECT role, content FROM (
            SELECT role, content, created_at_utc 
            FROM chat_history 
            WHERE user_id = ? 
            ORDER BY created_at_utc DESC 
            LIMIT ?
         ) ORDER BY created_at_utc ASC`
    )
        .bind(userId, limit)
        .all<{ role: ChatRole; content: string }>();

    return results.results ?? [];
}

/**
 * Deletes all chat history for a given user (e.g. if they want to clear context).
 */
export async function clearChatHistory(
    db: D1Database,
    userId: number
): Promise<void> {
    await db.prepare(`DELETE FROM chat_history WHERE user_id = ?`)
        .bind(userId)
        .run();
}
