import type { D1Database } from "@cloudflare/workers-types";
import type { Session, AgentInputItem } from "@openai/agents";
import {
    getRecentChatHistory,
    insertChatMessage,
    clearChatHistory,
    type ChatRole,
} from "../db/chat-history";

/**
 * Tool confirmation prefixes that should be filtered from agent context.
 * These cause the model to pattern-match instead of calling tools.
 */
const CONFIRMATION_PREFIXES = ["Logged ", "Updated ", "Deleted "];

function isToolConfirmation(role: string, text: string): boolean {
    if (role !== "assistant") return false;
    return CONFIRMATION_PREFIXES.some(prefix => text.startsWith(prefix));
}

/**
 * Maps a D1 chat_history row to an AgentInputItem.
 */
function rowToItem(row: { role: ChatRole; content: string }): AgentInputItem {
    if (row.role === "user") {
        return { role: "user", content: row.content };
    }
    return {
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: row.content }],
    };
}

/**
 * Extracts a plain-text string from an AgentInputItem, if possible.
 */
function extractText(item: AgentInputItem): string | undefined {
    if (!("role" in item)) return undefined;

    if (item.role === "user") {
        if (typeof item.content === "string") return item.content;
        if (Array.isArray(item.content)) {
            const textPart = item.content.find(
                (p) => "type" in p && p.type === "input_text"
            );
            if (textPart && "text" in textPart) return textPart.text;
        }
        return undefined;
    }

    if (item.role === "assistant") {
        if (Array.isArray(item.content)) {
            const textPart = item.content.find(
                (p) => p.type === "output_text"
            );
            if (textPart && "text" in textPart) return textPart.text;
        }
        return undefined;
    }

    return undefined;
}

/**
 * Maps an AgentInputItem role to a ChatRole for D1 storage.
 * Only "user" and "assistant" messages are persisted.
 */
function extractRole(item: AgentInputItem): ChatRole | undefined {
    if (!("role" in item)) return undefined;
    if (item.role === "user") return "user";
    if (item.role === "assistant") return "assistant";
    return undefined;
}

/**
 * Session implementation backed by D1 chat_history table.
 * Persists conversation history per-user across agent runs.
 */
export class D1Session implements Session {
    constructor(
        private db: D1Database,
        private userId: number,
        private defaultLimit: number = 10
    ) {}

    async getSessionId(): Promise<string> {
        return `user-${this.userId}`;
    }

    async getItems(limit?: number): Promise<AgentInputItem[]> {
        const history = await getRecentChatHistory(
            this.db,
            this.userId,
            limit ?? this.defaultLimit
        );
        return history
            .filter(row => !isToolConfirmation(row.role, row.content))
            .map(rowToItem);
    }

    async addItems(items: AgentInputItem[]): Promise<void> {
        const writes = items
            .map(item => ({ role: extractRole(item), text: extractText(item) }))
            .filter((w): w is { role: ChatRole; text: string } =>
                !!w.role && !!w.text && !isToolConfirmation(w.role, w.text)
            );

        await Promise.all(
            writes.map(w => insertChatMessage(this.db, this.userId, w.role, w.text))
        );
    }

    async popItem(): Promise<AgentInputItem | undefined> {
        // Not critical for our flow — D1 doesn't support efficient pop
        return undefined;
    }

    async clearSession(): Promise<void> {
        await clearChatHistory(this.db, this.userId);
    }
}
