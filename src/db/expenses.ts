import type { Env } from "../types";
import { getPeriodUtcRange, type TotalsPeriod } from "../totals";

const ALLOWED_UPDATE_COLUMNS = new Set([
  "amount_minor", "currency", "category", "tags", "occurred_at_utc", "status"
]);

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
    db: D1Database,
    expenseId: number,
    userId: number,
    updates: Record<string, unknown>
): Promise<number> {
    const keys = Object.keys(updates);
    if (keys.length === 0) return 0;

    for (const key of keys) {
      if (!ALLOWED_UPDATE_COLUMNS.has(key)) {
        throw new Error(`Invalid update column: ${key}`);
      }
    }

    const setClauses = keys.map((k) => `${k} = ?`);
    const bindings = [...keys.map((k) => updates[k]), expenseId, userId];

    const query = `UPDATE expenses SET ${setClauses.join(", ")} WHERE id = ? AND user_id = ?`;

    const result = await db.prepare(query)
        .bind(...bindings)
        .run();

    return result.meta.changes;
}

export async function insertExpense(
  db: D1Database,
  userId: number,
  sourceEventId: number,
  amountMinor: number,
  currency: string,
  category: string,
  tags: string[],
  occurredAtUtc: string,
  needsReview: boolean
): Promise<number> {
  const result = await db.prepare(
    `INSERT INTO expenses (
       user_id, source_event_id, amount_minor, currency,
       category, tags, occurred_at_utc, status, created_at_utc
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_event_id) DO NOTHING`
  )
    .bind(
      userId,
      sourceEventId,
      amountMinor,
      currency,
      category,
      JSON.stringify(tags),
      occurredAtUtc,
      needsReview ? "needs_review" : "final",
      new Date().toISOString()
    )
    .run();

  return result.meta.last_row_id as number;
}

export async function deleteExpense(db: D1Database, expenseId: number, userId: number): Promise<number> {
    const result = await db.prepare(
        `DELETE FROM expenses WHERE id = ? AND user_id = ?`
    )
        .bind(expenseId, userId)
        .run();

    return result.meta.changes;
}

export async function getUserTags(db: D1Database, userId: number): Promise<string[]> {
    const { results } = await db.prepare(
        `SELECT tags FROM expenses WHERE user_id = ? AND tags != '[]'`
    )
        .bind(userId)
        .all<{ tags: string }>();

    const tagSet = new Set<string>();
    for (const row of results ?? []) {
        try {
            const parsed = JSON.parse(row.tags);
            if (Array.isArray(parsed)) {
                for (const tag of parsed) tagSet.add(tag);
            }
        } catch {
            // skip malformed JSON
        }
    }
    return Array.from(tagSet).sort();
}
