import { describe, expect, it } from "vitest";
import { validateTelegramInitData } from "../src/telegram/auth";

const encoder = new TextEncoder();

async function buildInitData(
    botToken: string,
    authDate: number,
    params: Record<string, string> = { query_id: "A", user: "B" }
): Promise<string> {
    const botTokenKey = await crypto.subtle.importKey(
        "raw", encoder.encode("WebAppData"),
        { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const secretKeyBuffer = await crypto.subtle.sign("HMAC", botTokenKey, encoder.encode(botToken));
    const finalKey = await crypto.subtle.importKey(
        "raw", secretKeyBuffer,
        { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );

    const allParams = { ...params, auth_date: String(authDate) };
    const dataCheckString = Object.keys(allParams).sort()
        .map((k) => `${k}=${allParams[k as keyof typeof allParams]}`).join("\n");
    const signatureBuffer = await crypto.subtle.sign("HMAC", finalKey, encoder.encode(dataCheckString));
    const hash = Array.from(new Uint8Array(signatureBuffer))
        .map((b) => b.toString(16).padStart(2, "0")).join("");

    return new URLSearchParams({ ...allParams, hash }).toString();
}

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
        const freshAuthDate = Math.floor(Date.now() / 1000) - 60;
        const initData = await buildInitData("test_token", freshAuthDate);

        const result = await validateTelegramInitData(initData, "test_token");

        expect(result).not.toBeNull();
        expect(result?.query_id).toBe("A");
        expect(result?.user).toBe("B");
        expect(result?.auth_date).toBe(String(freshAuthDate));
    });

    it("rejects expired auth_date (>24h old)", async () => {
        const expiredAuthDate = Math.floor(Date.now() / 1000) - 48 * 3600;
        const initData = await buildInitData("test_token", expiredAuthDate);

        const result = await validateTelegramInitData(initData, "test_token");
        expect(result).toBeNull();
    });

    it("accepts fresh auth_date (<24h old)", async () => {
        const freshAuthDate = Math.floor(Date.now() / 1000) - 3600;
        const initData = await buildInitData("test_token", freshAuthDate);

        const result = await validateTelegramInitData(initData, "test_token");

        expect(result).not.toBeNull();
        expect(result?.auth_date).toBe(String(freshAuthDate));
    });
});
