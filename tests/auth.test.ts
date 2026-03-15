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
        const botToken = "test_token";
        const freshAuthDate = Math.floor(Date.now() / 1000) - 60;

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

        const dataCheckString = `auth_date=${freshAuthDate}\nquery_id=A\nuser=B`;
        const signatureBuffer = await crypto.subtle.sign("HMAC", finalKey, encoder.encode(dataCheckString));
        const expectedHash = Array.from(new Uint8Array(signatureBuffer))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");

        const initData = `query_id=A&user=B&auth_date=${freshAuthDate}&hash=${expectedHash}`;

        const result = await validateTelegramInitData(initData, botToken);

        expect(result).not.toBeNull();
        expect(result?.query_id).toBe("A");
        expect(result?.user).toBe("B");
        expect(result?.auth_date).toBe(String(freshAuthDate));
    });

    it("rejects expired auth_date (>24h old)", async () => {
        const botToken = "test_token";
        const expiredAuthDate = Math.floor(Date.now() / 1000) - 48 * 3600;

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

        const dataCheckString = `auth_date=${expiredAuthDate}\nquery_id=A\nuser=B`;
        const signatureBuffer = await crypto.subtle.sign("HMAC", finalKey, encoder.encode(dataCheckString));
        const hash = Array.from(new Uint8Array(signatureBuffer))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");

        const initData = `query_id=A&user=B&auth_date=${expiredAuthDate}&hash=${hash}`;

        const result = await validateTelegramInitData(initData, botToken);

        expect(result).toBeNull();
    });

    it("accepts fresh auth_date (<24h old)", async () => {
        const botToken = "test_token";
        const freshAuthDate = Math.floor(Date.now() / 1000) - 3600;

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

        const dataCheckString = `auth_date=${freshAuthDate}\nquery_id=A\nuser=B`;
        const signatureBuffer = await crypto.subtle.sign("HMAC", finalKey, encoder.encode(dataCheckString));
        const hash = Array.from(new Uint8Array(signatureBuffer))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");

        const initData = `query_id=A&user=B&auth_date=${freshAuthDate}&hash=${hash}`;

        const result = await validateTelegramInitData(initData, botToken);

        expect(result).not.toBeNull();
        expect(result?.auth_date).toBe(String(freshAuthDate));
    });
});
