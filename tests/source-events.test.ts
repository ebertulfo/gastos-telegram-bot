import { describe, expect, it, vi } from "vitest";
import { classifyMessageType, findRecentDuplicateContent } from "../src/db/source-events";

describe("classifyMessageType", () => {
  it("classifies text updates", () => {
    const result = classifyMessageType({
      update_id: 1,
      message: {
        message_id: 2,
        date: 1730000000,
        text: "Lunch 12.50",
        chat: { id: 100 }
      }
    });

    expect(result).toBe("text");
  });

  it("classifies photo updates", () => {
    const result = classifyMessageType({
      update_id: 1,
      message: {
        message_id: 2,
        date: 1730000000,
        chat: { id: 100 },
        photo: [{ file_id: "id", file_unique_id: "uniq", width: 100, height: 100 }]
      }
    });

    expect(result).toBe("photo");
  });

  it("classifies voice updates", () => {
    const result = classifyMessageType({
      update_id: 1,
      message: {
        message_id: 2,
        date: 1730000000,
        chat: { id: 100 },
        voice: { file_id: "id", file_unique_id: "uniq", duration: 4 }
      }
    });

    expect(result).toBe("voice");
  });
});

describe("findRecentDuplicateContent", () => {
  it("returns null when no recent duplicate exists", async () => {
    const mockDb = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => null),
        })),
      })),
    } as unknown as D1Database;
    const result = await findRecentDuplicateContent(mockDb, 1, "unique text", 30);
    expect(result).toBeNull();
  });

  it("returns source_event_id when duplicate found", async () => {
    const mockDb = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => ({ id: 42 })),
        })),
      })),
    } as unknown as D1Database;
    const result = await findRecentDuplicateContent(mockDb, 1, "duplicate text", 30);
    expect(result).toBe(42);
  });
});
