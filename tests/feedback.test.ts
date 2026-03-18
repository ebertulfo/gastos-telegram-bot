import { describe, expect, it, vi } from "vitest";
import { insertFeedback, updateGithubIssueUrl, getRecentErrorTraces } from "../src/db/feedback";

describe("insertFeedback", () => {
  it("inserts a feedback row and returns the new row id", async () => {
    const first = vi.fn(async () => ({ id: 7 }));
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    const id = await insertFeedback(db, {
      userId: 1,
      telegramChatId: 100,
      type: "feedback",
      text: "Love the app!",
      chatContext: null,
      errorContext: null,
    });

    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO feedback"));
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("RETURNING id"));
    expect(bind).toHaveBeenCalledWith(
      1, 100, "feedback", "Love the app!", null, null, expect.any(String)
    );
    expect(id).toBe(7);
  });

  it("inserts a bug report with chat and error context", async () => {
    const first = vi.fn(async () => ({ id: 42 }));
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    const id = await insertFeedback(db, {
      userId: 2,
      telegramChatId: 200,
      type: "bug",
      text: "The bot crashed",
      chatContext: "some chat history",
      errorContext: "Error: something went wrong",
    });

    expect(bind).toHaveBeenCalledWith(
      2, 200, "bug", "The bot crashed", "some chat history", "Error: something went wrong", expect.any(String)
    );
    expect(id).toBe(42);
  });

  it("throws if the insert returns no id", async () => {
    const first = vi.fn(async () => null);
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    await expect(
      insertFeedback(db, {
        userId: 1,
        telegramChatId: 100,
        type: "feedback",
        text: "test",
        chatContext: null,
        errorContext: null,
      })
    ).rejects.toThrow("Failed to insert feedback");
  });
});

describe("updateGithubIssueUrl", () => {
  it("updates the github_issue_url for the given feedback id", async () => {
    const run = vi.fn(async () => ({ meta: { changes: 1 } }));
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    await updateGithubIssueUrl(db, 7, "https://github.com/owner/repo/issues/123");

    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE feedback"));
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("github_issue_url"));
    expect(bind).toHaveBeenCalledWith("https://github.com/owner/repo/issues/123", 7);
  });

  it("resolves without throwing when no row is matched", async () => {
    const run = vi.fn(async () => ({ meta: { changes: 0 } }));
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    await expect(updateGithubIssueUrl(db, 9999, "https://example.com")).resolves.toBeUndefined();
  });
});

describe("getRecentErrorTraces", () => {
  it("returns error traces for a user ordered by most recent", async () => {
    const rows = [
      { trace_id: "t1", span_name: "queue.process", error_message: "timeout", started_at_utc: "2026-03-18T10:00:00Z", duration_ms: 5000 },
      { trace_id: "t2", span_name: "openai.call", error_message: "rate limit", started_at_utc: "2026-03-18T09:00:00Z", duration_ms: 200 },
    ];
    const all = vi.fn(async () => ({ results: rows }));
    const bind = vi.fn(() => ({ all }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    const traces = await getRecentErrorTraces(db, 1);

    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("SELECT"));
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("status = 'error'"));
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("ORDER BY"));
    expect(bind).toHaveBeenCalledWith(1, 3);
    expect(traces).toHaveLength(2);
    expect(traces[0].trace_id).toBe("t1");
    expect(traces[0].error_message).toBe("timeout");
  });

  it("accepts a custom limit", async () => {
    const all = vi.fn(async () => ({ results: [] }));
    const bind = vi.fn(() => ({ all }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    await getRecentErrorTraces(db, 5, 10);

    expect(bind).toHaveBeenCalledWith(5, 10);
  });

  it("returns empty array when no error traces exist", async () => {
    const all = vi.fn(async () => ({ results: [] }));
    const bind = vi.fn(() => ({ all }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    const traces = await getRecentErrorTraces(db, 99);
    expect(traces).toEqual([]);
  });
});
