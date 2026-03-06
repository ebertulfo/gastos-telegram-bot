import type { Env } from "../types";
import { GetFinancialReportTool, executeGetFinancialReport } from "./tools";
import { getRecentChatHistory, insertChatMessage } from "../db/chat-history";
import { checkAndRefreshTokenQuota, incrementTokenUsage } from "../db/quotas";
import { sendTelegramChatMessage, sendChatAction } from "../telegram/messages";

export type ParsedIntent = "log" | "question" | "unclear";

/**
 * ⚡️ THE FAST INTENT CLASSIFIER ⚡️
 * Hits gpt-4o-mini to instantly route the Telegram message.
 * Returns "log" if it's an expense to be queued, or "question" if it needs semantic chat.
 */
export async function classifyIntent(env: Env, userId: number, text: string): Promise<ParsedIntent> {
    if (!env.OPENAI_API_KEY) return "log"; // Fallback to queue if no AI

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${env.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are a strict text classification router. You only output exactly one word: "log", "question", or "unclear".
If the user says "15 food", "lunch 20$", "grab 6", or provides a receipt-like entry with a number, output "log".
If the user asks "How much did I spend?", "What's my biggest expense?", "Show me my recent food", output "question".
If the message is ambiguous, conversational, or doesn't clearly fit either (e.g. "use suggested", "ok", "thanks", "hello", "yes", random words without a number), output "unclear".`
                },
                {
                    role: "user",
                    content: text
                }
            ],
            max_completion_tokens: 500
        })
    });

    if (!response.ok) return "log";
    const data = await response.json() as any;

    if (data.usage?.total_tokens) {
        // Fire and forget quota increment so it doesn't block the hot classification path
        incrementTokenUsage(env.DB, userId, data.usage.total_tokens).catch(console.error);
    }

    const answer = data.choices?.[0]?.message?.content?.trim().toLowerCase();

    if (answer === "question") return "question";
    if (answer === "unclear") return "unclear";
    return "log";
}

/**
 * Executes the Multi-Turn Conversational Agent with strict DB limits and TTL.
 */
export async function runSemanticChat(
    env: Env,
    userId: number,
    telegramId: number,
    timezone: string,
    tier: "free" | "premium",
    userMessage: string
): Promise<void> {

    // 0. Enforce Daily Token Quota before wasting DB/OpeNAI cycles
    const hasQuota = await checkAndRefreshTokenQuota(env.DB, userId, telegramId, tier);
    if (!hasQuota) {
        await sendTelegramChatMessage(env, telegramId, "⏳ You have reached your daily AI assistant limit to prevent high server costs. Please try again tomorrow! (Logging new expenses still works normally).");
        return;
    }

    // FIRE TYPING INDICATOR: Let the user know the flagship AI is thinking
    await sendChatAction(env, telegramId, "typing");

    // 1. Persist the user's incoming message
    await insertChatMessage(env.DB, userId, "user", userMessage);

    // 2. Fetch truncated short-term memory (Guardrail: Max 10 messages to prevent token explosion)
    const history = await getRecentChatHistory(env.DB, userId, 10);

    const messages: any[] = [
        {
            role: "system",
            content: `You are Gastos, a proactive, intelligent financial assistant. You help the user understand their spending.
You have ONE tool: get_financial_report. It returns the total, category breakdown, and recent transactions all in one call. ALWAYS use it for any spending question.
NEVER guess spending data. If asked to delete or modify data, decline politely (you are read-only).
Their local timezone is ${timezone}. Today's date in their timezone is ${new Date().toLocaleDateString("en-US", { timeZone: timezone, weekday: "long", year: "numeric", month: "long", day: "numeric" })}.

RULES:
- Be CONCISE. Answer the question directly. Give the total and a compact breakdown, but do NOT list individual transactions or dates unless the user explicitly asks for details.
- NEVER withhold useful info, but also NEVER pad with unnecessary extras. Aim for 2-5 lines max for simple questions.
- NEVER end with "Let me know if you want..." or offer follow-ups. Just answer.
- Use tag_query for any item-level search (e.g. "drinks", "coffee", "transport to work"). The backend handles semantic matching automatically.
- For comparisons ("this week vs last week"), call the tool twice with different periods.`
        }
    ];

    // Inject history (with sanitization to prevent poisoned context)
    const cleanHistory = history.filter(h => !looksLikeLeakedToolCall(h.content));
    console.log(`[DEBUG:HISTORY] Loaded ${history.length} messages, ${history.length - cleanHistory.length} filtered as poisoned`);
    cleanHistory.forEach(h => {
        messages.push({ role: h.role, content: h.content });
    });

    // 3. Trigger OpenAI with Tools
    const requestPayload = {
        model: "gpt-4o",
        messages,
        tools: [GetFinancialReportTool],
        tool_choice: "auto",
        max_completion_tokens: 2500
    };
    console.log(`[DEBUG:REQUEST] Sending to OpenAI`, JSON.stringify({
        model: requestPayload.model,
        messageCount: messages.length,
        systemPrompt: messages[0]?.content?.substring(0, 200) + "...",
        userMessage: messages[messages.length - 1]?.content,
        toolCount: requestPayload.tools.length
    }));

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${env.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(requestPayload)
    });

    if (!response.ok) {
        await sendTelegramChatMessage(env, telegramId, "❌ AI Service Error. Please try again later.");
        return;
    }

    const data = await response.json() as any;
    if (data.usage?.total_tokens) {
        await incrementTokenUsage(env.DB, userId, data.usage.total_tokens);
    }

    const responseMessage = data.choices[0].message;

    // 4. Handle Tool Calls if the LLM wants database info
    if (responseMessage.tool_calls) {
        messages.push(responseMessage); // Append the assistant's intent to use a tool

        for (const toolCall of responseMessage.tool_calls) {
            const functionName = toolCall.function.name;
            const args = JSON.parse(toolCall.function.arguments);
            console.log(`[DEBUG:TOOL_CALL] AI called ${functionName}`, JSON.stringify(args));
            let toolResult = "";

            try {
                if (functionName === "get_financial_report") {
                    toolResult = await executeGetFinancialReport(env, userId, timezone, args.period, args.category, args.tag_query);
                } else {
                    toolResult = `Error: Unknown tool ${functionName}`;
                }
            } catch (err: any) {
                toolResult = `Error executing tool: ${err.message}`;
            }

            console.log(`[DEBUG:TOOL_RESULT] ${functionName} returned (${toolResult.length} chars):`, toolResult.substring(0, 500));

            messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                name: functionName,
                content: toolResult
            });
        }

        // 5. Send results back to OpenAI for the final natural language answer
        const finalResponse = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${env.OPENAI_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "gpt-4o",
                messages,
                max_completion_tokens: 2500
            })
        });

        if (!finalResponse.ok) {
            await sendTelegramChatMessage(env, telegramId, "❌ AI Generation Error. Please try again later.");
            return;
        }

        const finalData = await finalResponse.json() as any;
        if (finalData.usage?.total_tokens) {
            await incrementTokenUsage(env.DB, userId, finalData.usage.total_tokens);
        }

        const finalContent = finalData.choices[0].message.content as string;
        console.log(`[DEBUG:FINAL_RESPONSE]`, finalContent.substring(0, 300));

        // GUARD: Detect leaked tool-call content in post-tool response
        if (looksLikeLeakedToolCall(finalContent)) {
            console.error("Tool call content leaked in final response, suppressing", { finalContent });
            await sendTelegramChatMessage(env, telegramId, "⏳ I'm having trouble processing your request. Please try rephrasing your question!");
            return;
        }

        // Never persist poisoned content
        if (!looksLikeLeakedToolCall(finalContent)) {
            await insertChatMessage(env.DB, userId, "assistant", finalContent);
        }
        await sendTelegramChatMessage(env, telegramId, finalContent);
        return;
    }

    // If the LLM didn't need any tools, just output its direct answer
    if (responseMessage.content) {
        const content = responseMessage.content as string;
        console.log(`[DEBUG:DIRECT_RESPONSE] No tool call. AI responded directly:`, content.substring(0, 300));

        if (looksLikeLeakedToolCall(content)) {
            console.error("Tool call content leaked to user, suppressing", { content });
            await sendTelegramChatMessage(env, telegramId, "⏳ I'm having trouble processing your request. Please try rephrasing your question!");
            return;
        }

        if (!looksLikeLeakedToolCall(content)) {
            await insertChatMessage(env.DB, userId, "assistant", content);
        }
        await sendTelegramChatMessage(env, telegramId, content);
    }
}

/** Detects when the model leaks raw tool-call JSON/instructions as text content */
function looksLikeLeakedToolCall(text: string): boolean {
    if (!text) return false;
    return text.includes("functions.get") ||
        text.includes("to=functions") ||
        text.includes("getfinancialreport") ||
        (text.startsWith("{") && text.includes('"period"'));
}
