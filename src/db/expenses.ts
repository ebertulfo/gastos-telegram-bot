import type { Env } from "../types";
import { getPeriodUtcRange, type TotalsPeriod } from "../totals";

export type ExpenseWithDetails = {
    id: number;
    source_event_id: number;
    amount_minor: number;
    currency: string;
    occurred_at_utc: string;
    status: "final" | "needs_review";
    text_raw: string | null;
    r2_object_key: string | null;
    needs_review_reason: boolean;
    parsed_description: string | null;
    category: string;
    tags: string; // Stored as JSON string in sqlite
};

export async function getExpenses(
    env: Env,
    userId: number,
    timezone: string,
    period: TotalsPeriod
): Promise<ExpenseWithDetails[]> {
    const range = getPeriodUtcRange(new Date(), timezone, period);

    const { results } = await env.DB.prepare(
        `SELECT
       e.id,
       e.source_event_id,
       e.amount_minor,
       e.currency,
       e.occurred_at_utc,
       e.status,
       e.category,
       e.tags,
       se.text_raw,
       se.r2_object_key,
       pr.needs_review as needs_review_reason,
       JSON_EXTRACT(pr.parsed_json, '$.description') as parsed_description
     FROM expenses e
     JOIN source_events se ON e.source_event_id = se.id
     LEFT JOIN parse_results pr ON pr.source_event_id = se.id
     WHERE e.user_id = ?
       AND e.occurred_at_utc >= ?
       AND e.occurred_at_utc <= ?
     ORDER BY e.occurred_at_utc DESC
     LIMIT 100`
    )
        .bind(userId, range.startUtc.toISOString(), range.endUtc.toISOString())
        .all<ExpenseWithDetails>();

    return results ?? [];
}

export async function updateExpense(
    env: Env,
    userId: number,
    expenseId: number,
    data: { amount_minor?: number; currency?: string; category?: string; tags?: string[] }
): Promise<boolean> {
    const updates: string[] = [];
    const bindings: any[] = [];

    if (data.amount_minor !== undefined) {
        updates.push("amount_minor = ?");
        bindings.push(data.amount_minor);
    }
    if (data.currency !== undefined) {
        updates.push("currency = ?");
        bindings.push(data.currency);
    }
    if (data.category !== undefined) {
        updates.push("category = ?");
        bindings.push(data.category);
    }
    if (data.tags !== undefined) {
        updates.push("tags = ?");
        bindings.push(JSON.stringify(data.tags));
    }

    if (updates.length === 0) return true;

    // Always clear the needs_review status when manually updated
    updates.push("status = 'final'");
    bindings.push(expenseId, userId);

    const query = `UPDATE expenses SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`;

    const result = await env.DB.prepare(query)
        .bind(...bindings)
        .run();

    return result.meta.changes > 0;
}

export async function deleteExpense(env: Env, userId: number, expenseId: number): Promise<boolean> {
    // SQLite doesn't natively support ON DELETE CASCADE unless enabled, 
    // but since Gastos appends rows, we just delete the expense itself.
    // We leave the source_event and parse_result intact as audit trails.
    const result = await env.DB.prepare(
        `DELETE FROM expenses
     WHERE id = ? AND user_id = ?`
    )
        .bind(expenseId, userId)
        .run();

    return result.meta.changes > 0;
}
