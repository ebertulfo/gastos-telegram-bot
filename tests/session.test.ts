import { describe, expect, it, vi } from "vitest";
import { D1Session } from "../src/ai/session";

/**
 * Creates a mock D1Database with configurable query results.
 */
function mockDb(queryResults: { role: string; content: string }[] = []) {
    const run = vi.fn(async () => ({ meta: { changes: 1 } }));
    const all = vi.fn(async () => ({ results: queryResults }));
    const bind = vi.fn(() => ({ run, all }));
    const prepare = vi.fn(() => ({ bind }));
    return { db: { prepare } as unknown as D1Database, prepare, bind, run, all };
}

describe("D1Session", () => {
    describe("getSessionId", () => {
        it("returns user-{id} format", async () => {
            const { db } = mockDb();
            const session = new D1Session(db, 42);
            expect(await session.getSessionId()).toBe("user-42");
        });

        it("works for different user IDs", async () => {
            const { db } = mockDb();
            const session = new D1Session(db, 999);
            expect(await session.getSessionId()).toBe("user-999");
        });
    });

    describe("getItems", () => {
        it("returns empty array for new user", async () => {
            const { db } = mockDb([]);
            const session = new D1Session(db, 42);
            const items = await session.getItems();
            expect(items).toEqual([]);
        });

        it("maps user messages to UserMessageItem format", async () => {
            const { db } = mockDb([
                { role: "user", content: "hello" },
            ]);
            const session = new D1Session(db, 42);
            const items = await session.getItems();
            expect(items).toEqual([
                { role: "user", content: "hello" },
            ]);
        });

        it("maps assistant messages to AssistantMessageItem format", async () => {
            const { db } = mockDb([
                { role: "assistant", content: "hi there" },
            ]);
            const session = new D1Session(db, 42);
            const items = await session.getItems();
            expect(items).toEqual([
                {
                    role: "assistant",
                    status: "completed",
                    content: [{ type: "output_text", text: "hi there" }],
                },
            ]);
        });

        it("maps mixed conversation correctly", async () => {
            const { db } = mockDb([
                { role: "user", content: "how much did I spend?" },
                { role: "assistant", content: "You spent $50." },
            ]);
            const session = new D1Session(db, 42);
            const items = await session.getItems();
            expect(items).toHaveLength(2);
            expect(items[0]).toEqual({ role: "user", content: "how much did I spend?" });
            expect(items[1]).toEqual({
                role: "assistant",
                status: "completed",
                content: [{ type: "output_text", text: "You spent $50." }],
            });
        });

        it("passes limit to DB query", async () => {
            const { db, bind } = mockDb([]);
            const session = new D1Session(db, 42);
            await session.getItems(5);
            expect(bind).toHaveBeenCalledWith(42, 5);
        });

        it("uses default limit when none provided", async () => {
            const { db, bind } = mockDb([]);
            const session = new D1Session(db, 42, 20);
            await session.getItems();
            expect(bind).toHaveBeenCalledWith(42, 20);
        });
    });

    describe("addItems", () => {
        it("inserts user messages", async () => {
            const { db, prepare, bind } = mockDb();
            const session = new D1Session(db, 42);
            await session.addItems([
                { role: "user", content: "spent $10 on coffee" },
            ]);
            expect(prepare).toHaveBeenCalledWith(
                expect.stringContaining("INSERT INTO chat_history")
            );
            expect(bind).toHaveBeenCalledWith(42, "user", "spent $10 on coffee");
        });

        it("inserts assistant messages with output_text content", async () => {
            const { db, bind } = mockDb();
            const session = new D1Session(db, 42);
            await session.addItems([
                {
                    role: "assistant",
                    status: "completed",
                    content: [{ type: "output_text", text: "Got it!" }],
                },
            ]);
            expect(bind).toHaveBeenCalledWith(42, "assistant", "Got it!");
        });

        it("inserts user messages with input_text array content", async () => {
            const { db, bind } = mockDb();
            const session = new D1Session(db, 42);
            await session.addItems([
                {
                    role: "user",
                    content: [{ type: "input_text", text: "hello from array" }],
                },
            ]);
            expect(bind).toHaveBeenCalledWith(42, "user", "hello from array");
        });

        it("skips non-text items (e.g., tool calls)", async () => {
            const { db, prepare } = mockDb();
            const session = new D1Session(db, 42);
            await session.addItems([
                { type: "function_call", name: "get_report", arguments: "{}", callId: "abc", id: "123" } as any,
            ]);
            expect(prepare).not.toHaveBeenCalled();
        });

        it("handles multiple items in order", async () => {
            const { db, bind } = mockDb();
            const session = new D1Session(db, 42);
            await session.addItems([
                { role: "user", content: "first" },
                {
                    role: "assistant",
                    status: "completed",
                    content: [{ type: "output_text", text: "second" }],
                },
            ]);
            expect(bind).toHaveBeenCalledTimes(2);
            expect(bind).toHaveBeenNthCalledWith(1, 42, "user", "first");
            expect(bind).toHaveBeenNthCalledWith(2, 42, "assistant", "second");
        });
    });

    describe("popItem", () => {
        it("returns undefined (not implemented for D1)", async () => {
            const { db } = mockDb();
            const session = new D1Session(db, 42);
            expect(await session.popItem()).toBeUndefined();
        });
    });

    describe("clearSession", () => {
        it("calls clearChatHistory with correct userId", async () => {
            const { db, prepare, bind } = mockDb();
            const session = new D1Session(db, 42);
            await session.clearSession();
            expect(prepare).toHaveBeenCalledWith(
                expect.stringContaining("DELETE FROM chat_history")
            );
            expect(bind).toHaveBeenCalledWith(42);
        });
    });
});
