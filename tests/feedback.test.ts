import { describe, expect, it, vi } from "vitest";
import { getRecentChatMessages } from "../src/db/chat-history";

function mockDb() {
  return { prepare: vi.fn() } as unknown as D1Database;
}

describe("getRecentChatMessages", () => {
  it("returns empty array when no messages exist", async () => {
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          all: vi.fn(async () => ({ results: [] })),
        })),
      })),
    } as unknown as D1Database;

    const result = await getRecentChatMessages(db, 1);
    expect(result).toEqual([]);
  });

  it("returns full row data including id and created_at_utc", async () => {
    const rows = [
      { id: 1, role: "user", content: "Spent 10 on coffee", created_at_utc: "2026-03-18T08:00:00Z" },
      { id: 2, role: "assistant", content: "Logged 10 for coffee", created_at_utc: "2026-03-18T08:00:01Z" },
    ];

    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          all: vi.fn(async () => ({ results: rows })),
        })),
      })),
    } as unknown as D1Database;

    const result = await getRecentChatMessages(db, 42);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 1, role: "user", content: "Spent 10 on coffee" });
    expect(result[1]).toMatchObject({ id: 2, role: "assistant", content: "Logged 10 for coffee" });
  });

  it("passes correct userId and limit to the query", async () => {
    const bindMock = vi.fn(() => ({
      all: vi.fn(async () => ({ results: [] })),
    }));
    const db = {
      prepare: vi.fn(() => ({ bind: bindMock })),
    } as unknown as D1Database;

    await getRecentChatMessages(db, 99, 5);
    expect(bindMock).toHaveBeenCalledWith(99, 5);
  });

  it("uses default limit of 20 when not specified", async () => {
    const bindMock = vi.fn(() => ({
      all: vi.fn(async () => ({ results: [] })),
    }));
    const db = {
      prepare: vi.fn(() => ({ bind: bindMock })),
    } as unknown as D1Database;

    await getRecentChatMessages(db, 7);
    expect(bindMock).toHaveBeenCalledWith(7, 20);
  });

  it("handles null results gracefully", async () => {
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          all: vi.fn(async () => ({ results: null })),
        })),
      })),
    } as unknown as D1Database;

    const result = await getRecentChatMessages(db, 1);
    expect(result).toEqual([]);
  });
});
