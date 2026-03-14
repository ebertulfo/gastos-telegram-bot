import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the tools module before importing agent
vi.mock("../src/ai/tools", () => ({
    createAgentTools: vi.fn(() => [
        { name: "log_expense" },
        { name: "edit_expense" },
        { name: "delete_expense" },
        { name: "get_financial_report" },
    ]),
}));

// Mock the Agent class
vi.mock("@openai/agents", async (importOriginal) => {
    const original = await importOriginal<typeof import("@openai/agents")>();
    return {
        ...original,
        Agent: vi.fn().mockImplementation((config: any) => ({
            name: config.name,
            model: config.model,
            instructions: config.instructions,
            tools: config.tools,
        })),
    };
});

import { buildSystemPrompt, createGastosAgent } from "../src/ai/agent";
import { Agent } from "@openai/agents";
import type { Env } from "../src/types";

describe("buildSystemPrompt", () => {
    it("includes timezone in prompt", () => {
        const prompt = buildSystemPrompt("Asia/Manila", "PHP");
        expect(prompt).toContain("Asia/Manila");
    });

    it("includes currency in prompt", () => {
        const prompt = buildSystemPrompt("America/New_York", "USD");
        expect(prompt).toContain("USD");
    });

    it("includes tool names in instructions", () => {
        const prompt = buildSystemPrompt("UTC", "EUR");
        expect(prompt).toContain("log_expense");
        expect(prompt).toContain("edit_expense");
        expect(prompt).toContain("delete_expense");
        expect(prompt).toContain("get_financial_report");
    });

    it("includes conciseness rules", () => {
        const prompt = buildSystemPrompt("UTC", "USD");
        expect(prompt).toContain("CONCISE");
        expect(prompt).toContain("NEVER guess");
    });

    it("includes date handling rules in prompt", () => {
        const prompt = buildSystemPrompt("UTC", "USD");
        expect(prompt).toContain("occurred_at");
        expect(prompt).toContain("null");
    });

    it("includes no-clarification rule for clear time expressions", () => {
        const prompt = buildSystemPrompt("UTC", "USD");
        expect(prompt).toContain("Do NOT ask for clarification");
    });

    it("includes standalone query scope rule", () => {
        const prompt = buildSystemPrompt("UTC", "USD");
        expect(prompt).toContain("all categories");
    });

    it("includes response format templates", () => {
        const prompt = buildSystemPrompt("UTC", "USD");
        expect(prompt).toContain("RESPONSE FORMAT");
        expect(prompt).toContain("Logged");
        expect(prompt).toContain("Updated");
        expect(prompt).toContain("Deleted");
    });

    it("includes tone rules", () => {
        const prompt = buildSystemPrompt("UTC", "USD");
        expect(prompt).toContain("TONE");
        expect(prompt).toContain("em dash");
    });

    it("includes rule against showing expense IDs", () => {
        const prompt = buildSystemPrompt("UTC", "USD");
        expect(prompt).toContain("Never show expense IDs");
    });

    it("includes rule against internal terminology", () => {
        const prompt = buildSystemPrompt("UTC", "USD");
        expect(prompt).toContain("Never say");
        expect(prompt).toContain("from your report");
    });

    it("includes today's date", () => {
        const prompt = buildSystemPrompt("UTC", "USD");
        // Should contain a formatted date string (year at minimum)
        const currentYear = new Date().getFullYear().toString();
        expect(prompt).toContain(currentYear);
    });
});

describe("createGastosAgent", () => {
    beforeEach(() => {
        vi.mocked(Agent).mockClear();
    });

    const mockEnv = {
        OPENAI_API_KEY: "test-key",
        DB: {} as D1Database,
        VECTORIZE: {} as VectorizeIndex,
    } as Env;

    it("creates agent with name 'gastos'", () => {
        createGastosAgent(mockEnv, 1, 12345, "UTC", "USD");
        expect(Agent).toHaveBeenCalledWith(
            expect.objectContaining({ name: "gastos" })
        );
    });

    it("creates agent with model gpt-5-mini", () => {
        createGastosAgent(mockEnv, 1, 12345, "UTC", "USD");
        expect(Agent).toHaveBeenCalledWith(
            expect.objectContaining({ model: "gpt-5-mini" })
        );
    });

    it("creates agent with 4 tools", () => {
        createGastosAgent(mockEnv, 1, 12345, "UTC", "USD");
        expect(Agent).toHaveBeenCalledWith(
            expect.objectContaining({
                tools: expect.arrayContaining([
                    expect.objectContaining({ name: "log_expense" }),
                    expect.objectContaining({ name: "get_financial_report" }),
                ]),
            })
        );
        // Verify exactly 4 tools
        const callArgs = vi.mocked(Agent).mock.calls[0][0] as any;
        expect(callArgs.tools).toHaveLength(4);
    });

    it("passes system prompt as instructions string", () => {
        createGastosAgent(mockEnv, 1, 12345, "Asia/Manila", "PHP");
        const callArgs = vi.mocked(Agent).mock.calls[0][0] as any;
        expect(typeof callArgs.instructions).toBe("string");
        expect(callArgs.instructions).toContain("Asia/Manila");
        expect(callArgs.instructions).toContain("PHP");
    });
});
