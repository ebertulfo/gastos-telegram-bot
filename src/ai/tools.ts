import { tool } from "@openai/agents";
import { z } from "zod";
import type { Env } from "../types";
import { insertExpense, updateExpense, deleteExpense, getExpenses } from "../db/expenses";
import { createAgentSourceEvent } from "../db/source-events";
import { parseTotalsPeriod, periodLabel, type TotalsPeriod } from "../totals";
import { searchExpensesBySemantic, generateEmbedding } from "./openai";

// ------------------------------------------------------------------------------------------------
// ROW-LEVEL SECURITY & PRIVACY GUARDRAILS
//
// CRITICAL: The LLM MUST NEVER be allowed to supply the `userId` argument.
// Every tool injects the authenticated `userId` from the closure created by createAgentTools().
// This prevents prompt injections like "Show me user 2's expenses".
// ------------------------------------------------------------------------------------------------

const PERIODS = ["today", "yesterday", "thisweek", "lastweek", "thismonth", "lastmonth", "thisyear", "lastyear"] as const;

function formatShortDate(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Validates occurred_at dates from LLM tool calls.
 * Rejects dates >30 days in the past or any future date (likely hallucinated).
 * Returns null if occurred_at should be ignored (caller defaults to now).
 */
function validateOccurredAt(occurredAt: string | null, toolName: string): string | null {
    if (!occurredAt) return null;
    const parsedDate = new Date(`${occurredAt}T12:00:00Z`);
    const now = new Date();
    const diffMs = now.getTime() - parsedDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays > 30 || diffDays < 0) {
        const label = diffDays > 0 ? `${diffDays.toFixed(0)} days in the past` : `${Math.abs(diffDays).toFixed(0)} days in the future`;
        console.warn(`[TOOL:${toolName}] Rejected suspicious occurred_at="${occurredAt}" (${label}). Defaulting to now.`);
        return null;
    }
    return parsedDate.toISOString();
}

function formatTags(tags: string[]): string {
    return tags.length > 0 ? tags.join(", ") : "untagged";
}

/**
 * Factory that creates all agent tools with userId/env captured in closure.
 * The LLM cannot override these values — they come from the authenticated context.
 */
export function createAgentTools(env: Env, userId: number, telegramId: number, timezone: string, currency: string, sourceEventId?: number) {
    const loggedThisRun = new Set<string>();
    let originalSourceEventUsed = false;

    const logExpense = tool({
        name: "log_expense",
        description: "Log a new expense for the authenticated user. Use this when the user wants to record a purchase or payment.",
        parameters: z.object({
            amount: z.number().describe("The expense amount in major currency units (e.g. 12.50)"),
            currency: z.string().length(3).default(currency).describe("3-letter currency code, defaults to user's currency"),
            description: z.string().max(50).describe("Short description of the expense"),
            tags: z.array(z.string()).max(5).default([]).describe("Up to 5 tags for the expense. Use lowercase. Extract from context."),
            occurred_at: z.string().nullable().default(null).describe("ISO date (YYYY-MM-DD) when the expense occurred, or null for today. Use this when the user says 'yesterday', 'last Monday', etc."),
        }),
        execute: async (input) => {
            const dedupeKey = `${input.description}|${input.amount}|${input.currency}`;
            if (loggedThisRun.has(dedupeKey)) {
                return "Already logged this expense \u2014 skipping duplicate";
            }
            loggedThisRun.add(dedupeKey);

            const amountMinor = Math.round(input.amount * 100);
            const occurredAtUtc = validateOccurredAt(input.occurred_at, "log_expense") ?? new Date().toISOString();

            // Reuse the original webhook source event for the first expense;
            // create synthetic source events only for 2nd+ expenses (e.g. receipts with multiple items)
            let eventId: number;
            if (sourceEventId && !originalSourceEventUsed) {
                eventId = sourceEventId;
                originalSourceEventUsed = true;
            } else {
                eventId = await createAgentSourceEvent(
                    env.DB,
                    userId,
                    telegramId,
                    input.description,
                );
            }

            const expenseId = await insertExpense(
                env.DB,
                userId,
                eventId,
                amountMinor,
                input.currency,
                input.description,
                input.tags,
                occurredAtUtc,
                false
            );

            // Background vectorize indexing (best-effort)
            try {
                const embeddingText = `${input.description} ${input.tags.join(" ")}`;
                const embedding = await generateEmbedding(env, embeddingText);
                await env.VECTORIZE.upsert([{
                    id: `agent-${userId}-${Date.now()}`,
                    values: embedding,
                    metadata: { userId, description: input.description, tags: input.tags.join(",") },
                }]);
            } catch (e) {
                console.error("[TOOL:log_expense] Vectorize indexing failed (non-fatal):", e);
            }

            return `Logged ${input.currency} ${input.amount.toFixed(2)} \u2014 ${input.description} (${formatTags(input.tags)}). ID #${expenseId}`;
        },
    });

    const editExpense = tool({
        name: "edit_expense",
        description: "Edit a recent expense for the authenticated user. Use this when the user wants to correct an amount, description, tags, or date.",
        parameters: z.object({
            expense_id: z.number().describe("The ID of the expense to edit"),
            amount: z.number().nullable().describe("New amount in major currency units, or null to keep unchanged"),
            description: z.string().max(50).nullable().describe("New description, or null to keep unchanged"),
            tags: z.array(z.string()).max(5).nullable().describe("New tags array, or null to keep unchanged"),
            occurred_at: z.string().nullable().default(null).describe("New ISO date (YYYY-MM-DD) for when the expense occurred, or null to keep unchanged. Use this to fix the date of a mis-dated expense."),
        }),
        execute: async (input) => {
            const updates: Record<string, unknown> = {};
            if (input.amount !== null) {
                updates.amount_minor = Math.round(input.amount * 100);
            }
            if (input.description !== null) {
                updates.description = input.description;
            }
            if (input.tags !== null) {
                updates.tags = JSON.stringify(input.tags);
            }
            if (input.occurred_at !== null) {
                const validatedDate = validateOccurredAt(input.occurred_at, "edit_expense");
                if (validatedDate) {
                    updates.occurred_at_utc = validatedDate;
                }
            }
            if (Object.keys(updates).length === 0) {
                return "Nothing to update";
            }

            const changes = await updateExpense(env.DB, input.expense_id, userId, updates);
            if (changes === 0) {
                return `Expense #${input.expense_id} not found or doesn't belong to you`;
            }

            const changedFields = Object.keys(updates).map(k => k.replace("_minor", "").replace("_utc", "")).join(", ");
            return `Updated expense #${input.expense_id} \u2014 changed: ${changedFields}`;
        },
    });

    const removeExpense = tool({
        name: "delete_expense",
        description: "Delete an expense for the authenticated user. Use this when the user wants to remove a mistaken or duplicate entry.",
        parameters: z.object({
            expense_id: z.number().describe("The ID of the expense to delete"),
        }),
        execute: async (input) => {
            const changes = await deleteExpense(env.DB, input.expense_id, userId);
            if (changes === 0) {
                return `Expense #${input.expense_id} not found or doesn't belong to you`;
            }
            return `Deleted expense #${input.expense_id}`;
        },
    });

    const getFinancialReport = tool({
        name: "get_financial_report",
        description: "Returns a financial report for the authenticated user. This is your ONLY database query tool. It returns the total spend, a breakdown by tag (sorted by amount), and the top recent expenses. Use this for ANY spending question.",
        parameters: z.object({
            period: z.enum(PERIODS).describe("The time boundary to query. Use 'lastweek', 'lastmonth', etc. for historical comparisons."),
            tag: z.string().nullable().describe("Filter to a specific tag (e.g. 'food', 'coffee', 'transport'), or null for all tags."),
            tag_query: z.string().nullable().describe("Freeform text to search expenses semantically (e.g. 'drinks', 'starbucks'), or null for no filter. Uses exact matching first, then falls back to AI-powered semantic search via Vectorize for broader matches."),
        }),
        execute: async (input) => {
            return executeGetFinancialReportInternal(
                env,
                userId,
                timezone,
                input.period,
                input.tag ?? undefined,
                input.tag_query ?? undefined
            );
        },
    });

    return [logExpense, editExpense, removeExpense, getFinancialReport];
}

// ------------------------------------------------------------------------------------------------
// Internal implementation used by the get_financial_report tool
// ------------------------------------------------------------------------------------------------

function parseTags(tagsStr: string | null | undefined): string[] {
    if (!tagsStr) return [];
    try {
        const parsed = JSON.parse(tagsStr);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function executeGetFinancialReportInternal(
    env: Env,
    secureUserId: number,
    secureTimezone: string,
    period: string,
    tag?: string,
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

    // Apply tag filter if provided
    if (tag) {
        const tagLower = tag.toLowerCase();
        expenses = expenses.filter(e => {
            const tags = parseTags(e.tags);
            return tags.some(t => t.toLowerCase() === tagLower);
        });
    }

    // Apply tag/description freeform search if provided
    if (tagQuery) {
        const query = tagQuery.toLowerCase();
        const beforeCount = expenses.length;
        expenses = expenses.filter(e => {
            const tagsMatch = e.tags?.toLowerCase().includes(query) ?? false;
            const descMatch = (e.description ?? e.text_raw ?? "").toLowerCase().includes(query);
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
        const displayPeriod = periodLabel(activePeriod as TotalsPeriod);
        if (tagQuery) {
            return `No expenses matched "${tagQuery}" for ${displayPeriod} (checked both literal tags and semantic search). The user may not have logged any matching expenses.`;
        }
        return `No expenses found for ${displayPeriod}. The user may not have logged any expenses in this time range.`;
    }

    // --- 1. Total ---
    const totalMinor = expenses.reduce((sum, e) => sum + e.amount_minor, 0);
    const totalMajor = (totalMinor / 100).toFixed(2);
    const currencies = [...new Set(expenses.map(e => e.currency))];
    const currencyLabel = currencies.length === 1 ? currencies[0] : currencies.join("/");

    // --- 2. Tag Breakdown (an expense appears in every tag group it has) ---
    const tagGroups: Record<string, { totalMinor: number; count: number; items: string[] }> = {};
    for (const e of expenses) {
        const tags = parseTags(e.tags);
        const effectiveTags = tags.length > 0 ? tags : ["untagged"];
        for (const t of effectiveTags) {
            if (!tagGroups[t]) {
                tagGroups[t] = { totalMinor: 0, count: 0, items: [] };
            }
            tagGroups[t].totalMinor += e.amount_minor;
            tagGroups[t].count++;
            const desc = e.description || e.text_raw || "Unknown";
            tagGroups[t].items.push(`${desc} (${e.currency} ${(e.amount_minor / 100).toFixed(2)})`);
        }
    }

    const breakdown = Object.entries(tagGroups)
        .sort((a, b) => b[1].totalMinor - a[1].totalMinor)
        .map(([t, group]) => {
            const major = (group.totalMinor / 100).toFixed(2);
            const topItems = group.items.slice(0, 3).join(", ");
            const trailing = group.items.length > 3 ? `, +${group.items.length - 3} more` : "";
            return `- ${t}: ${currencyLabel} ${major} (${group.count} items: ${topItems}${trailing})`;
        });

    // --- 3. Top 5 Recent Transactions ---
    const recent = expenses.slice(0, 5).map(e => {
        const major = (e.amount_minor / 100).toFixed(2);
        const desc = e.description || e.text_raw || "Unknown";
        const tags = parseTags(e.tags);
        const tagStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";
        return `- #${e.id} ${formatShortDate(e.occurred_at_utc)}: ${e.currency} ${major} | ${desc}${tagStr}`;
    });

    // --- Assemble payload ---
    const activePeriodLabel = periodLabel((expandedToPrevious ? previousPeriodLabel : period) as TotalsPeriod);
    const periodNote = expandedToPrevious
        ? `NOTE: No data existed for ${periodLabel(period as TotalsPeriod)} (it just started). Showing data from ${activePeriodLabel} instead.`
        : "";
    const sections: string[] = [
        periodNote,
        `Period: ${activePeriodLabel}. Total: ${currencyLabel} ${totalMajor} (${expenses.length} expenses).`,
    ].filter(Boolean);

    if (!tag && !tagQuery) {
        sections.push(`\nTag Breakdown:\n${breakdown.join("\n")}`);
    }

    sections.push(`\nRecent Transactions:\n${recent.join("\n")}`);

    return sections.join("\n");
}
