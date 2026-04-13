import { describe, expect, it, vi } from "vitest";
import {
  insertAuditLog,
  getRecentAuditLogs,
  getAuditLogByTraceId,
  getAnomalousAuditLogs,
} from "../src/db/audit-log";

function mockDb(queryResults: any[] = []) {
  const run = vi.fn(async () => ({ meta: { changes: 1 } }));
  const all = vi.fn(async () => ({ results: queryResults }));
  const first = vi.fn(async () => queryResults[0] ?? null);
  const bind = vi.fn(() => ({ run, all, first }));
  const prepare = vi.fn(() => ({ bind }));
  return { db: { prepare } as unknown as D1Database, prepare, bind, run, all, first };
}

describe("insertAuditLog", () => {
  it("inserts an audit log entry with all fields", async () => {
    const { db, prepare, bind, run } = mockDb();
    await insertAuditLog(db, {
      trace_id: "trace-123",
      user_id: 42,
      messages_sent: '{"role":"user","content":"coffee 5"}',
      response_received: '"Logged SGD 5.00"',
      tool_calls: '[{"name":"log_expense","input":"{}"}]',
      total_tokens: 150,
      latency_ms: 1200,
      anomaly_flags: null,
    });

    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO ai_audit_log"));
    expect(bind).toHaveBeenCalledWith(
      "trace-123", 42,
      '{"role":"user","content":"coffee 5"}',
      '"Logged SGD 5.00"',
      '[{"name":"log_expense","input":"{}"}]',
      150, 1200, null
    );
    expect(run).toHaveBeenCalled();
  });
});

describe("getRecentAuditLogs", () => {
  it("returns entries in reverse chronological order", async () => {
    const rows = [
      { id: 2, trace_id: "b", created_at_utc: "2026-04-13T12:00:00Z" },
      { id: 1, trace_id: "a", created_at_utc: "2026-04-13T11:00:00Z" },
    ];
    const { db, bind } = mockDb(rows);
    const result = await getRecentAuditLogs(db, 10);
    expect(result).toEqual(rows);
    expect(bind).toHaveBeenCalledWith(10);
  });

  it("returns empty array when no logs exist", async () => {
    const { db } = mockDb([]);
    const result = await getRecentAuditLogs(db);
    expect(result).toEqual([]);
  });
});

describe("getAuditLogByTraceId", () => {
  it("returns matching entry", async () => {
    const row = { id: 1, trace_id: "trace-abc", user_id: 42 };
    const { db } = mockDb([row]);
    const result = await getAuditLogByTraceId(db, "trace-abc");
    expect(result).toEqual(row);
  });

  it("returns null when not found", async () => {
    const { db } = mockDb([]);
    const result = await getAuditLogByTraceId(db, "nonexistent");
    expect(result).toBeNull();
  });
});

describe("getAnomalousAuditLogs", () => {
  it("returns only entries with non-empty anomaly_flags", async () => {
    const rows = [
      { id: 1, anomaly_flags: '["empty_response"]' },
    ];
    const { db, prepare } = mockDb(rows);
    const result = await getAnomalousAuditLogs(db, 10);
    expect(result).toEqual(rows);
    expect(prepare).toHaveBeenCalledWith(
      expect.stringContaining("anomaly_flags IS NOT NULL")
    );
  });
});
