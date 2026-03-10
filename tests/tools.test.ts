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
  insertExpense: vi.fn().mockResolvedValue(undefined),
  updateExpense: vi.fn().mockResolvedValue(undefined),
  deleteExpense: vi.fn().mockResolvedValue(undefined),
  getExpenses: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/totals", () => ({
  parseTotalsPeriod: vi.fn().mockReturnValue("thismonth"),
}));

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
});
