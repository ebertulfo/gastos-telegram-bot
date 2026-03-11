import { describe, expect, it } from "vitest";
import { getAckMessage } from "../src/ack-messages";

describe("getAckMessage", () => {
    it("returns a string for text type", () => {
        const msg = getAckMessage("text");
        expect(typeof msg).toBe("string");
        expect(msg.length).toBeGreaterThan(0);
    });

    it("returns a string for photo type", () => {
        const msg = getAckMessage("photo");
        expect(typeof msg).toBe("string");
        expect(msg.length).toBeGreaterThan(0);
    });

    it("returns a string for voice type", () => {
        const msg = getAckMessage("voice");
        expect(typeof msg).toBe("string");
        expect(msg.length).toBeGreaterThan(0);
    });

    it("returns a string for unknown/other type (catchall)", () => {
        const msg = getAckMessage("other" as any);
        expect(typeof msg).toBe("string");
        expect(msg.length).toBeGreaterThan(0);
    });
});
