import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock @openai/agents before importing the module under test
vi.mock("@openai/agents", () => ({
  tool: vi.fn((config: any) => ({
    type: "function",
    name: config.name,
    description: config.description,
    parameters: config.parameters,
    execute: config.execute,
  })),
}));

// Mock DB functions
vi.mock("../src/db/expenses", () => ({
  insertExpense: vi.fn().mockResolvedValue(1),
  updateExpense: vi.fn().mockResolvedValue(1),
  deleteExpense: vi.fn().mockResolvedValue(1),
  getExpenses: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/totals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/totals")>();
  return {
    ...actual,
    parseTotalsPeriod: vi.fn().mockReturnValue("thismonth"),
  };
});

vi.mock("../src/db/source-events", () => ({
  createAgentSourceEvent: vi.fn().mockResolvedValue(999),
}));

vi.mock("../src/ai/openai", () => ({
  searchExpensesBySemantic: vi.fn().mockResolvedValue([]),
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

import { createAgentTools } from "../src/ai/tools";
import type { Env } from "../src/types";

function createMockEnv(): Env {
  return {
    APP_ENV: "development",
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
    OPENAI_API_KEY: "test-key",
    DB: {} as any,
    MEDIA_BUCKET: {} as any,
    INGEST_QUEUE: {} as any,
    RATE_LIMITER: {} as any,
    VECTORIZE: {
      upsert: vi.fn().mockResolvedValue(undefined),
    } as any,
  } satisfies Env;
}

describe("createAgentTools", () => {
  const userId = 42;
  const timezone = "Asia/Manila";
  const currency = "PHP";

  it("returns exactly 4 tools", () => {
    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    expect(tools).toHaveLength(4);
  });

  it("returns tools with expected names", () => {
    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const names = tools.map((t: any) => t.name);
    expect(names).toEqual([
      "log_expense",
      "edit_expense",
      "delete_expense",
      "get_financial_report",
    ]);
  });

  it("every tool has a description and parameters", () => {
    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    for (const t of tools as any[]) {
      expect(t.description).toBeTruthy();
      expect(t.parameters).toBeTruthy();
    }
  });

  it("log_expense execute returns confirmation string", async () => {
    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const logTool = tools[0] as any;
    const result = await logTool.execute({
      amount: 150,
      currency: "PHP",
      description: "Lunch",
      category: "Food",
      tags: ["lunch"],
    });
    expect(result).toContain("150");
    expect(result).toContain("Food");
  });

  it("edit_expense execute returns confirmation string", async () => {
    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const editTool = tools[1] as any;
    const result = await editTool.execute({
      expense_id: 1,
      amount: 200,
      category: "Transport",
    });
    expect(result).toContain("1");
  });

  it("delete_expense execute returns confirmation string", async () => {
    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const deleteTool = tools[2] as any;
    const result = await deleteTool.execute({
      expense_id: 5,
    });
    expect(result).toContain("5");
  });

  it("edit_expense maps description to valid expenses columns only", async () => {
    const { updateExpense } = await import("../src/db/expenses");
    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const editTool = tools[1] as any;
    await editTool.execute({
      expense_id: 1,
      amount: 17.2,
      category: null,
      description: "Lunch updated",
    });
    // Should NOT pass 'parsed_description' — that column doesn't exist on expenses table
    // Should pass only columns that exist: amount_minor, category, tags
    const calls = vi.mocked(updateExpense).mock.calls;
    const updates = calls[calls.length - 1][3];
    expect(updates).not.toHaveProperty("parsed_description");
    expect(updates).toHaveProperty("amount_minor", 1720);
  });

  it("edit_expense updates occurred_at_utc when occurred_at is provided", async () => {
    const { updateExpense } = await import("../src/db/expenses");
    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const editTool = tools[1] as any;
    await editTool.execute({
      expense_id: 1,
      amount: null,
      category: null,
      description: null,
      occurred_at: "2026-03-10",
    });
    const calls = vi.mocked(updateExpense).mock.calls;
    const updates = calls[calls.length - 1][3];
    expect(updates).toHaveProperty("occurred_at_utc");
    expect(updates.occurred_at_utc).toContain("2026-03-10");
  });

  it("edit_expense does not update occurred_at_utc when occurred_at is null", async () => {
    const { updateExpense } = await import("../src/db/expenses");
    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const editTool = tools[1] as any;
    await editTool.execute({
      expense_id: 1,
      amount: 20,
      category: null,
      description: null,
      occurred_at: null,
    });
    const calls = vi.mocked(updateExpense).mock.calls;
    const updates = calls[calls.length - 1][3];
    expect(updates).not.toHaveProperty("occurred_at_utc");
    expect(updates).toHaveProperty("amount_minor", 2000);
  });

  it("log_expense returns the new expense ID", async () => {
    const { insertExpense } = await import("../src/db/expenses");
    // Mock insertExpense to return an ID
    vi.mocked(insertExpense).mockResolvedValueOnce(42);

    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const logTool = tools[0] as any;
    const result = await logTool.execute({
      amount: 18,
      currency: "SGD",
      description: "Lunch",
      category: "Food",
      tags: ["lunch"],
    });
    expect(result).toContain("ID");
  });

  it("get_financial_report includes expense IDs in output", async () => {
    const { getExpenses } = await import("../src/db/expenses");
    vi.mocked(getExpenses).mockResolvedValueOnce([
      {
        id: 77,
        source_event_id: 100,
        amount_minor: 1800,
        currency: "SGD",
        occurred_at_utc: "2026-03-10T04:07:00Z",
        status: "final",
        category: "Food",
        tags: '["lunch"]',
        text_raw: null,
        r2_object_key: null,
        needs_review_reason: false,
        parsed_description: "Lunch",
      },
    ]);

    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const reportTool = tools[3] as any;
    const result = await reportTool.execute({
      period: "today",
      category: null,
      tag_query: null,
    });
    // The report should include expense IDs so the agent can use edit_expense/delete_expense
    expect(result).toContain("#77");
  });

  it("log_expense uses occurred_at date when provided", async () => {
    const { insertExpense } = await import("../src/db/expenses");
    vi.mocked(insertExpense).mockResolvedValueOnce(50);

    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const logTool = tools[0] as any;
    await logTool.execute({
      amount: 18,
      currency: "SGD",
      description: "Lunch",
      category: "Food",
      tags: ["lunch"],
      occurred_at: "2026-03-10",
    });

    const calls = vi.mocked(insertExpense).mock.calls;
    const occurredAtUtc = calls[calls.length - 1][7] as string;
    // Should use the provided date, not "now"
    expect(occurredAtUtc).toContain("2026-03-10");
  });

  it("log_expense rejects occurred_at more than 30 days in the past", async () => {
    const { insertExpense } = await import("../src/db/expenses");
    vi.mocked(insertExpense).mockResolvedValueOnce(60);

    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const logTool = tools[0] as any;
    await logTool.execute({
      amount: 5,
      currency: "SGD",
      description: "Coffee",
      category: "Food",
      tags: [],
      occurred_at: "2025-01-01",
    });

    const calls = vi.mocked(insertExpense).mock.calls;
    const occurredAtUtc = calls[calls.length - 1][7] as string;
    const today = new Date().toISOString().slice(0, 10);
    expect(occurredAtUtc).toContain(today);
  });

  it("log_expense rejects occurred_at in the future", async () => {
    const { insertExpense } = await import("../src/db/expenses");
    vi.mocked(insertExpense).mockResolvedValueOnce(61);

    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const logTool = tools[0] as any;
    await logTool.execute({
      amount: 10,
      currency: "SGD",
      description: "Future lunch",
      category: "Food",
      tags: [],
      occurred_at: "2099-01-01",
    });

    const calls = vi.mocked(insertExpense).mock.calls;
    const occurredAtUtc = calls[calls.length - 1][7] as string;
    const today = new Date().toISOString().slice(0, 10);
    expect(occurredAtUtc).toContain(today);
  });

  it("log_expense accepts occurred_at within valid range (e.g. yesterday)", async () => {
    const { insertExpense } = await import("../src/db/expenses");
    vi.mocked(insertExpense).mockResolvedValueOnce(62);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const logTool = tools[0] as any;
    await logTool.execute({
      amount: 18,
      currency: "SGD",
      description: "Lunch",
      category: "Food",
      tags: [],
      occurred_at: yesterdayStr,
    });

    const calls = vi.mocked(insertExpense).mock.calls;
    const occurredAtUtc = calls[calls.length - 1][7] as string;
    expect(occurredAtUtc).toContain(yesterdayStr);
  });

  it("get_financial_report uses human-readable period labels", async () => {
    const { getExpenses } = await import("../src/db/expenses");
    vi.mocked(getExpenses).mockResolvedValueOnce([
      {
        id: 80,
        source_event_id: 101,
        amount_minor: 500,
        currency: "SGD",
        occurred_at_utc: "2026-03-14T04:00:00Z",
        status: "final",
        category: "Food",
        tags: "[]",
        text_raw: null,
        r2_object_key: null,
        needs_review_reason: false,
        parsed_description: "Coffee",
      },
    ]);

    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const reportTool = tools[3] as any;
    const result = await reportTool.execute({
      period: "thismonth",
      category: null,
      tag_query: null,
    });
    expect(result).toContain("This Month");
    expect(result).not.toContain("thismonth");
  });

  it("get_financial_report formats dates as readable strings", async () => {
    const { getExpenses } = await import("../src/db/expenses");
    vi.mocked(getExpenses).mockResolvedValueOnce([
      {
        id: 81,
        source_event_id: 102,
        amount_minor: 1800,
        currency: "SGD",
        occurred_at_utc: "2026-03-14T04:00:00Z",
        status: "final",
        category: "Food",
        tags: "[]",
        text_raw: null,
        r2_object_key: null,
        needs_review_reason: false,
        parsed_description: "Lunch",
      },
    ]);

    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const reportTool = tools[3] as any;
    const result = await reportTool.execute({
      period: "today",
      category: null,
      tag_query: null,
    });
    expect(result).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(result).toMatch(/[A-Z][a-z]{2} \d{1,2}/);
  });

  it("log_expense returns em-dash separated confirmation", async () => {
    const { insertExpense } = await import("../src/db/expenses");
    vi.mocked(insertExpense).mockResolvedValueOnce(99);

    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const logTool = tools[0] as any;
    const result = await logTool.execute({
      amount: 12.5,
      currency: "PHP",
      description: "Lunch",
      category: "Food",
      tags: [],
    });
    expect(result).toContain("\u2014");
    expect(result).not.toContain('for "');
    expect(result).not.toContain("under");
  });

  it("edit_expense returns descriptive change confirmation", async () => {
    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const editTool = tools[1] as any;
    const result = await editTool.execute({
      expense_id: 7,
      amount: 37.8,
      category: null,
      description: null,
      occurred_at: null,
    });
    expect(result).toContain("#7");
    expect(result).toContain("amount");
  });

  it("edit_expense returns failure when expense not found", async () => {
    const { updateExpense } = await import("../src/db/expenses");
    vi.mocked(updateExpense).mockResolvedValueOnce(0);

    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const editTool = tools[1] as any;
    const result = await editTool.execute({
      expense_id: 999,
      amount: 5,
      category: null,
      description: null,
      occurred_at: null,
    });
    expect(result).toContain("not found");
  });

  it("edit_expense returns not-supported when only description provided", async () => {
    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const editTool = tools[1] as any;
    const result = await editTool.execute({
      expense_id: 42,
      amount: null,
      category: null,
      description: "Updated name",
      occurred_at: null,
    });
    expect(result).toContain("not yet supported");
  });

  it("delete_expense returns failure when expense not found", async () => {
    const { deleteExpense } = await import("../src/db/expenses");
    vi.mocked(deleteExpense).mockResolvedValueOnce(0);

    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const deleteTool = tools[2] as any;
    const result = await deleteTool.execute({ expense_id: 999 });
    expect(result).toContain("not found");
  });

  it("edit_expense returns nothing-to-update when all inputs null", async () => {
    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const editTool = tools[1] as any;
    const result = await editTool.execute({
      expense_id: 42,
      amount: null,
      category: null,
      description: null,
      occurred_at: null,
    });
    expect(result).toContain("Nothing to update");
  });

  it("log_expense defaults to now when occurred_at is not provided", async () => {
    const { insertExpense } = await import("../src/db/expenses");
    vi.mocked(insertExpense).mockResolvedValueOnce(51);

    const tools = createAgentTools(createMockEnv(), userId, 12345, timezone, currency);
    const logTool = tools[0] as any;
    await logTool.execute({
      amount: 5,
      currency: "SGD",
      description: "Coffee",
      category: "Food",
      tags: [],
    });

    const calls = vi.mocked(insertExpense).mock.calls;
    const occurredAtUtc = calls[calls.length - 1][7] as string;
    // Should be today's date
    const today = new Date().toISOString().slice(0, 10);
    expect(occurredAtUtc).toContain(today);
  });
});
