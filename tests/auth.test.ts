import { describe, expect, it } from "vitest";
import { validateTelegramInitData } from "../src/telegram/auth";

describe("validateTelegramInitData", () => {
    it("returns null when hash is missing", async () => {
        const result = await validateTelegramInitData("user=%7B%22id%22%3A123%7D", "fake-token");
        expect(result).toBeNull();
    });

    it("returns null for invalid signature", async () => {
        const initData = "query_id=AA&user=%7B%22id%22%3A123%7D&auth_date=1710000000&hash=invalid_hash";
        const result = await validateTelegramInitData(initData, "fake-token");
        expect(result).toBeNull();
    });

    it("validates correct signature using Web Crypto API", async () => {
        // This is a synthetically generated valid combination based on the algorithm
        // bot_token: "test_token"
        // payload: "auth_date=1&query_id=A&user=B"
        // secret_key = HMAC_SHA256("WebAppData", "test_token")
        // hash = HEX(HMAC_SHA256(secret_key, "auth_date=1\nquery_id=A\nuser=B"))

        // Test values:
        const botToken = "test_token";

        // We manually compute the expected hash for this test to avoid circular logic
        const encoder = new TextEncoder();
        const botTokenKey = await crypto.subtle.importKey(
            "raw",
            encoder.encode("WebAppData"),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        );
        const secretKeyBuffer = await crypto.subtle.sign("HMAC", botTokenKey, encoder.encode(botToken));
        const finalKey = await crypto.subtle.importKey(
            "raw",
            secretKeyBuffer,
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        );

        const dataCheckString = "auth_date=1\nquery_id=A\nuser=B";
        const signatureBuffer = await crypto.subtle.sign("HMAC", finalKey, encoder.encode(dataCheckString));
        const expectedHash = Array.from(new Uint8Array(signatureBuffer))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");

        // Create the incoming initData string
        const initData = `query_id=A&user=B&auth_date=1&hash=${expectedHash}`;

        const result = await validateTelegramInitData(initData, botToken);

        expect(result).not.toBeNull();
        expect(result?.query_id).toBe("A");
        expect(result?.user).toBe("B");
        expect(result?.auth_date).toBe("1");
    });
});
