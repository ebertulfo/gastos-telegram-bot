import { tool } from "@openai/agents";
import { z } from "zod";
import type { Env } from "../types";
import { insertExpense, updateExpense, deleteExpense, getExpenses } from "../db/expenses";
import { createAgentSourceEvent } from "../db/source-events";
import { parseTotalsPeriod } from "../totals";
import { searchExpensesBySemantic, generateEmbedding } from "./openai";

// ------------------------------------------------------------------------------------------------
// ROW-LEVEL SECURITY & PRIVACY GUARDRAILS
//
// CRITICAL: The LLM MUST NEVER be allowed to supply the `userId` argument.
// Every tool injects the authenticated `userId` from the closure created by createAgentTools().
// This prevents prompt injections like "Show me user 2's expenses".
// ------------------------------------------------------------------------------------------------

const CATEGORIES = ["Food", "Transport", "Housing", "Shopping", "Entertainment", "Health", "Other"] as const;
const PERIODS = ["today", "yesterday", "thisweek", "lastweek", "thismonth", "lastmonth", "thisyear", "lastyear"] as const;

/**
 * Factory that creates all agent tools with userId/env captured in closure.
 * The LLM cannot override these values — they come from the authenticated context.
 */
export function createAgentTools(env: Env, userId: number, telegramId: number, timezone: string, currency: string) {
    const logExpense = tool({
        name: "log_expense",
        description: "Log a new expense for the authenticated user. Use this when the user wants to record a purchase or payment.",
        parameters: z.object({
            amount: z.number().describe("The expense amount in major currency units (e.g. 12.50)"),
            currency: z.string().length(3).default(currency).describe("3-letter currency code, defaults to user's currency"),
            description: z.string().max(50).describe("Short description of the expense"),
            category: z.enum(CATEGORIES).describe("Expense category"),
            tags: z.array(z.string()).max(3).default([]).describe("Up to 3 tags for the expense"),
        }),
        execute: async (input) => {
            const amountMinor = Math.round(input.amount * 100);
            const occurredAtUtc = new Date().toISOString();

            // Create a real source event to avoid source_event_id=0 collision
            const sourceEventId = await createAgentSourceEvent(
                env.DB,
                userId,
                telegramId,
                input.description,
            );

            await insertExpense(
                env.DB,
                userId,
                sourceEventId,
                amountMinor,
                input.currency,
                input.category,
                input.tags,
                occurredAtUtc,
                false
            );

            // Background vectorize indexing (best-effort)
            try {
                const embeddingText = `${input.description} ${input.category} ${input.tags.join(" ")}`;
                const embedding = await generateEmbedding(env, embeddingText);
                await env.VECTORIZE.upsert([{
                    id: `agent-${userId}-${Date.now()}`,
                    values: embedding,
                    metadata: { userId, description: input.description, category: input.category },
                }]);
            } catch (e) {
                console.error("[TOOL:log_expense] Vectorize indexing failed (non-fatal):", e);
            }

            return `Logged ${input.currency} ${input.amount.toFixed(2)} for "${input.description}" under ${input.category}.`;
        },
    });

    const editExpense = tool({
        name: "edit_expense",
        description: "Edit a recent expense for the authenticated user. Use this when the user wants to correct an amount, category, or description.",
        parameters: z.object({
            expense_id: z.number().describe("The ID of the expense to edit"),
            amount: z.number().optional().describe("New amount in major currency units"),
            category: z.enum(CATEGORIES).optional().describe("New category"),
            description: z.string().max(50).optional().describe("New description"),
        }),
        execute: async (input) => {
            const updates: Record<string, unknown> = {};
            if (input.amount !== undefined) {
                updates.amount_minor = Math.round(input.amount * 100);
            }
            if (input.category !== undefined) {
                updates.category = input.category;
            }
            if (input.description !== undefined) {
                updates.parsed_description = input.description;
            }

            await updateExpense(env.DB, input.expense_id, userId, updates);

            const changes = Object.keys(updates).join(", ");
            return `Updated expense #${input.expense_id} (changed: ${changes || "nothing"}).`;
        },
    });

    const removeExpense = tool({
        name: "delete_expense",
        description: "Delete an expense for the authenticated user. Use this when the user wants to remove a mistaken or duplicate entry.",
        parameters: z.object({
            expense_id: z.number().describe("The ID of the expense to delete"),
        }),
        execute: async (input) => {
            await deleteExpense(env.DB, input.expense_id, userId);
            return `Deleted expense #${input.expense_id}.`;
        },
    });

    const getFinancialReport = tool({
        name: "get_financial_report",
        description: "Returns a comprehensive financial report for the authenticated user. This is your ONLY database query tool. It returns the total spend, a breakdown by category (sorted by amount), and the top recent transactions—all in one call. Use this for ANY spending question.",
        parameters: z.object({
            period: z.enum(PERIODS).describe("The time boundary to query. Use 'lastweek', 'lastmonth', etc. for historical comparisons."),
            category: z.enum(CATEGORIES).optional().describe("Optional. Filters results to a specific master category."),
            tag_query: z.string().optional().describe("Optional. Freeform text to search expenses semantically (e.g. 'drinks', 'coffee', 'transport'). Uses exact matching first, then falls back to AI-powered semantic search via Vectorize for broader matches."),
        }),
        execute: async (input) => {
            return executeGetFinancialReportInternal(
                env,
                userId,
                timezone,
                input.period,
                input.category,
                input.tag_query
            );
        },
    });

    return [logExpense, editExpense, removeExpense, getFinancialReport];
}

// ------------------------------------------------------------------------------------------------
// Internal implementation used by the get_financial_report tool
// ------------------------------------------------------------------------------------------------

async function executeGetFinancialReportInternal(
    env: Env,
    secureUserId: number,
    secureTimezone: string,
    period: string,
    category?: string,
    tagQuery?: string
): Promise<string> {
    const periodEnum = parseTotalsPeriod("/" + period);
    if (!periodEnum) {
        return "System Error: The AI requested an invalid time period.";
    }

    let expenses = await getExpenses(env, secureUserId, secureTimezone, periodEnum);
    console.log(`[DEBUG:TOOL] Period "${period}" -> ${expenses.length} expenses`);

    // --- AUTO-EXPAND: If current period is empty, automatically include previous period ---
    const periodFallbackMap: Record<string, string> = {
        thisweek: "lastweek",
        thismonth: "lastmonth",
        thisyear: "lastyear",
        today: "yesterday",
    };
    let expandedToPrevious = false;
    let previousPeriodLabel = "";

    if (expenses.length === 0 && periodFallbackMap[period]) {
        const fallbackPeriod = parseTotalsPeriod("/" + periodFallbackMap[period]);
        if (fallbackPeriod) {
            expenses = await getExpenses(env, secureUserId, secureTimezone, fallbackPeriod);
            expandedToPrevious = true;
            previousPeriodLabel = periodFallbackMap[period];
            console.log(`[DEBUG:TOOL] Auto-expanded to "${previousPeriodLabel}" -> ${expenses.length} expenses`);
        }
    }

    // Apply category filter if provided
    if (category) {
        expenses = expenses.filter(e => e.category === category);
    }

    // Apply tag/description freeform search if provided
    if (tagQuery) {
        const query = tagQuery.toLowerCase();
        const beforeCount = expenses.length;
        expenses = expenses.filter(e => {
            const tagsMatch = e.tags?.toLowerCase().includes(query) ?? false;
            const descMatch = (e.parsed_description ?? e.text_raw ?? "").toLowerCase().includes(query);
            return tagsMatch || descMatch;
        });
        console.log(`[DEBUG:TOOL] Literal tag search for "${tagQuery}": ${beforeCount} -> ${expenses.length} expenses`);
    }

    if (expenses.length === 0 && tagQuery) {
        // --- SEMANTIC FALLBACK: Use Vectorize to find semantically similar expenses ---
        console.log(`[DEBUG:VECTORIZE] Literal match failed. Trying semantic search for "${tagQuery}"...`);
        const semanticIds = await searchExpensesBySemantic(env, secureUserId, tagQuery, 20);
        console.log(`[DEBUG:VECTORIZE] Semantic search returned ${semanticIds.length} IDs:`, JSON.stringify(semanticIds));

        if (semanticIds.length > 0) {
            // Re-fetch ALL expenses for the active period and filter to semantic matches
            const activeperiod = expandedToPrevious
                ? parseTotalsPeriod("/" + previousPeriodLabel)!
                : periodEnum;
            const allPeriodExpenses = await getExpenses(env, secureUserId, secureTimezone, activeperiod);
            console.log(`[DEBUG:VECTORIZE] Active period expenses: ${allPeriodExpenses.length}, source_event_ids:`, JSON.stringify(allPeriodExpenses.map(e => e.source_event_id)));

            // Also check the fallback period if we haven't already expanded
            let combinedExpenses = allPeriodExpenses;
            if (!expandedToPrevious && periodFallbackMap[period]) {
                const fallbackPeriod = parseTotalsPeriod("/" + periodFallbackMap[period]);
                if (fallbackPeriod) {
                    const prevExpenses = await getExpenses(env, secureUserId, secureTimezone, fallbackPeriod);
                    combinedExpenses = [...allPeriodExpenses, ...prevExpenses];
                    console.log(`[DEBUG:VECTORIZE] Including fallback period: +${prevExpenses.length} expenses`);
                    if (allPeriodExpenses.length === 0 && prevExpenses.length > 0) {
                        expandedToPrevious = true;
                        previousPeriodLabel = periodFallbackMap[period];
                    }
                }
            }

            const semanticIdSet = new Set(semanticIds);
            expenses = combinedExpenses.filter(e => semanticIdSet.has(e.source_event_id));
            console.log(`[DEBUG:VECTORIZE] After filtering by semantic IDs: ${expenses.length} matched`);
        }
    }

    if (expenses.length === 0) {
        const activePeriod = expandedToPrevious ? previousPeriodLabel : period;
        if (tagQuery) {
            return `No expenses matched "${tagQuery}" for period "${activePeriod}" (checked both literal tags and semantic search). The user may not have logged any matching expenses.`;
        }
        return `No expenses found for period "${activePeriod}". The user may not have logged any expenses in this time range.`;
    }

    // --- 1. Total ---
    const totalMinor = expenses.reduce((sum, e) => sum + e.amount_minor, 0);
    const totalMajor = (totalMinor / 100).toFixed(2);
    const currencies = [...new Set(expenses.map(e => e.currency))];
    const currencyLabel = currencies.length === 1 ? currencies[0] : currencies.join("/");

    // --- 2. Category Breakdown ---
    const categoryGroups: Record<string, { totalMinor: number; count: number; items: string[] }> = {};
    for (const e of expenses) {
        const cat = e.category ?? "Uncategorized";
        if (!categoryGroups[cat]) {
            categoryGroups[cat] = { totalMinor: 0, count: 0, items: [] };
        }
        categoryGroups[cat].totalMinor += e.amount_minor;
        categoryGroups[cat].count++;
        const desc = e.parsed_description || e.text_raw || "Unknown";
        categoryGroups[cat].items.push(`${desc} (${e.currency} ${(e.amount_minor / 100).toFixed(2)})`);
    }

    const breakdown = Object.entries(categoryGroups)
        .sort((a, b) => b[1].totalMinor - a[1].totalMinor)
        .map(([cat, group]) => {
            const major = (group.totalMinor / 100).toFixed(2);
            const topItems = group.items.slice(0, 3).join(", ");
            const trailing = group.items.length > 3 ? `, +${group.items.length - 3} more` : "";
            return `- ${cat}: ${currencyLabel} ${major} (${group.count} items: ${topItems}${trailing})`;
        });

    // --- 3. Top 5 Recent Transactions ---
    const recent = expenses.slice(0, 5).map(e => {
        const major = (e.amount_minor / 100).toFixed(2);
        const desc = e.parsed_description || e.text_raw || "Unknown";
        let tags = "";
        try {
            const parsed = JSON.parse(e.tags || "[]");
            if (Array.isArray(parsed) && parsed.length > 0) {
                tags = ` [${parsed.join(", ")}]`;
            }
        } catch { /* ignore */ }
        return `- ${e.occurred_at_utc}: ${e.currency} ${major} | ${e.category} | ${desc}${tags}`;
    });

    // --- Assemble payload ---
    const periodNote = expandedToPrevious
        ? `NOTE: No data existed for "${period}" (it just started). Showing data from "${previousPeriodLabel}" instead.`
        : "";
    const sections: string[] = [
        periodNote,
        `Period: ${expandedToPrevious ? previousPeriodLabel : period}. Total: ${currencyLabel} ${totalMajor} (${expenses.length} expenses).`,
    ].filter(Boolean);

    if (!category && !tagQuery) {
        sections.push(`\nCategory Breakdown:\n${breakdown.join("\n")}`);
    }

    sections.push(`\nRecent Transactions:\n${recent.join("\n")}`);

    return sections.join("\n");
}
