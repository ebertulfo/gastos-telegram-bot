import type { D1Database } from "@cloudflare/workers-types";

export type AuditLogEntry = {
  trace_id: string;
  user_id: number;
  messages_sent: string | null;
  response_received: string | null;
  tool_calls: string | null;
  total_tokens: number;
  latency_ms: number;
  anomaly_flags: string | null;
};

export type AuditLogRow = AuditLogEntry & {
  id: number;
  created_at_utc: string;
};

function truncate(s: string | null, max = 4000): string | null {
  if (!s) return s;
  return s.length > max ? s.slice(0, max) + "...[truncated]" : s;
}

export async function insertAuditLog(
  db: D1Database,
  entry: AuditLogEntry
): Promise<void> {
  await db.prepare(
    `INSERT INTO ai_audit_log (trace_id, user_id, messages_sent, response_received, tool_calls, total_tokens, latency_ms, anomaly_flags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      entry.trace_id,
      entry.user_id,
      truncate(entry.messages_sent),
      truncate(entry.response_received),
      truncate(entry.tool_calls),
      entry.total_tokens,
      entry.latency_ms,
      entry.anomaly_flags
    )
    .run();
}

export async function getRecentAuditLogs(
  db: D1Database,
  limit: number = 20
): Promise<AuditLogRow[]> {
  const { results } = await db.prepare(
    `SELECT * FROM ai_audit_log ORDER BY created_at_utc DESC LIMIT ?`
  ).bind(limit).all<AuditLogRow>();
  return results ?? [];
}

export async function getAuditLogByTraceId(
  db: D1Database,
  traceId: string
): Promise<AuditLogRow | null> {
  return db.prepare(
    `SELECT * FROM ai_audit_log WHERE trace_id = ?`
  ).bind(traceId).first<AuditLogRow>();
}

export async function getAnomalousAuditLogs(
  db: D1Database,
  limit: number = 20
): Promise<AuditLogRow[]> {
  const { results } = await db.prepare(
    `SELECT * FROM ai_audit_log
     WHERE anomaly_flags IS NOT NULL AND anomaly_flags != '[]'
     ORDER BY created_at_utc DESC LIMIT ?`
  ).bind(limit).all<AuditLogRow>();
  return results ?? [];
}
