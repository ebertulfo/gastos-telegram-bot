export type ErrorTrace = {
  trace_id: string;
  span_name: string;
  error_message: string | null;
  started_at_utc: string;
  duration_ms: number;
};

export type InsertFeedbackParams = {
  userId: number;
  telegramChatId: number;
  type: "feedback" | "bug";
  text: string;
  chatContext: string | null;
  errorContext: string | null;
};

/**
 * Insert a feedback or bug report row and return the new row ID.
 */
export async function insertFeedback(
  db: D1Database,
  params: InsertFeedbackParams
): Promise<number> {
  const { userId, telegramChatId, type, text, chatContext, errorContext } = params;

  const result = await db
    .prepare(
      `INSERT INTO feedback (
        user_id, telegram_chat_id, type, text,
        chat_context, error_context, created_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING id`
    )
    .bind(userId, telegramChatId, type, text, chatContext, errorContext, new Date().toISOString())
    .first<{ id: number }>();

  if (!result?.id) {
    throw new Error("Failed to insert feedback");
  }

  return result.id;
}

/**
 * Backfill the GitHub issue URL after async creation.
 */
export async function updateGithubIssueUrl(
  db: D1Database,
  feedbackId: number,
  url: string
): Promise<void> {
  await db
    .prepare(`UPDATE feedback SET github_issue_url = ? WHERE id = ?`)
    .bind(url, feedbackId)
    .run();
}

/**
 * Fetch the last N error traces for a user, for bug report context.
 * Default limit is 3.
 */
export async function getRecentErrorTraces(
  db: D1Database,
  userId: number,
  limit: number = 3
): Promise<ErrorTrace[]> {
  const { results } = await db
    .prepare(
      `SELECT trace_id, span_name, error_message, started_at_utc, duration_ms
       FROM traces
       WHERE user_id = ? AND status = 'error'
       ORDER BY started_at_utc DESC
       LIMIT ?`
    )
    .bind(userId, limit)
    .all<ErrorTrace>();

  return results ?? [];
}
