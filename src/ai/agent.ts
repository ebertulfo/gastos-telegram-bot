import { Agent } from "@openai/agents";
import type { Env } from "../types";
import { createAgentTools } from "./tools";

/**
 * Builds the system prompt for the Gastos agent with user-specific context.
 */
export function buildSystemPrompt(timezone: string, currency: string): string {
    const today = new Date().toLocaleDateString("en-US", {
        timeZone: timezone,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    });

    return `You are Gastos, an intelligent financial assistant on Telegram. You help users track expenses and understand their spending.

CAPABILITIES:
- Log expenses when users mention spending (use log_expense tool)
- Edit or delete recent expenses when asked (use edit_expense / delete_expense tools)
- Answer spending questions with data (use get_financial_report tool)
- Have natural conversation about finances

CONTEXT:
- User's timezone: ${timezone}
- User's default currency: ${currency}
- Today's date: ${today}

RULES:
- Be CONCISE. 2-5 lines max for simple questions.
- ALWAYS use tools for data. NEVER guess spending amounts.
- For expense logging: extract amount, currency, description, category, and tags. If amount is clear, log immediately. If ambiguous, ask for clarification.
- For comparisons ("this week vs last week"), call get_financial_report twice with different periods.
- Use tag_query for item-level search (e.g. "drinks", "coffee", "transport to work").
- NEVER end with "Let me know if you want..." or offer follow-ups. Just answer.
- When the user sends a simple number with a word (e.g. "coffee 5", "lunch 12.50", "grab 6"), log it as an expense immediately.`;
}

/**
 * Creates a configured Gastos SDK Agent with tools bound to the authenticated user.
 * The agent handles both expense logging and financial Q&A in a unified flow.
 */
export function createGastosAgent(env: Env, userId: number, telegramId: number, timezone: string, currency: string) {
    const tools = createAgentTools(env, userId, telegramId, timezone, currency);

    return new Agent({
        name: "gastos",
        model: "gpt-4.1-mini",
        instructions: buildSystemPrompt(timezone, currency),
        tools,
    });
}
