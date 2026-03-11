import { describe, expect, it } from "vitest";
import { getAckMessage, looksLikeQuestion } from "../src/ack-messages";

describe("looksLikeQuestion", () => {
    it("detects question marks", () => {
        expect(looksLikeQuestion("how much did I spend?")).toBe(true);
    });

    it("detects question words at start", () => {
        expect(looksLikeQuestion("How much did I spend today")).toBe(true);
        expect(looksLikeQuestion("Show me my expenses")).toBe(true);
        expect(looksLikeQuestion("List my expenses")).toBe(true);
        expect(looksLikeQuestion("What did I spend this week")).toBe(true);
        expect(looksLikeQuestion("Compare this week vs last week")).toBe(true);
    });

    it("does not flag expense logs", () => {
        expect(looksLikeQuestion("coffee 5")).toBe(false);
        expect(looksLikeQuestion("Lunch 12.50")).toBe(false);
        expect(looksLikeQuestion("grab 28")).toBe(false);
    });
});

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

    it("returns question-style ack for question text", () => {
        // Run multiple times to check we never get log-style acks
        for (let i = 0; i < 20; i++) {
            const msg = getAckMessage("text", "How much did I spend today?");
            expect(msg).not.toBe("Got it.");
            expect(msg).not.toBe("Noted!");
        }
    });

    it("returns log-style ack for expense text", () => {
        for (let i = 0; i < 20; i++) {
            const msg = getAckMessage("text", "coffee 5");
            expect(msg).not.toContain("check");
            expect(msg).not.toContain("look");
            expect(msg).not.toContain("pull");
        }
    });

    it("returns a string for unknown type (catchall)", () => {
        const msg = getAckMessage("other" as any);
        expect(typeof msg).toBe("string");
        expect(msg.length).toBeGreaterThan(0);
    });
});
