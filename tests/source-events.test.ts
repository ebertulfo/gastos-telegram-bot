import { describe, expect, it } from "vitest";
import { classifyMessageType } from "../src/db/source-events";

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
