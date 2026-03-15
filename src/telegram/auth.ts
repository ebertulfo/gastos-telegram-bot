export async function validateTelegramInitData(initData: string, botToken: string): Promise<Record<string, string> | null> {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get("hash");

    if (!hash) {
        return null;
    }

    urlParams.delete("hash");

    // Sort keys alphabetically
    const keys = Array.from(urlParams.keys()).sort();
    const dataCheckString = keys.map((key) => `${key}=${urlParams.get(key)}`).join("\n");

    // Web Crypto API for HMAC-SHA-256
    // 1. Create a secret key from the bot token using "WebAppData" as the key
    const encoder = new TextEncoder();

    const botTokenKey = await crypto.subtle.importKey(
        "raw",
        encoder.encode("WebAppData"),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const secretKeyBuffer = await crypto.subtle.sign("HMAC", botTokenKey, encoder.encode(botToken));

    // 2. Compute HMAC of dataCheckString using the generated secret key
    const finalKey = await crypto.subtle.importKey(
        "raw",
        secretKeyBuffer,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const signatureBuffer = await crypto.subtle.sign("HMAC", finalKey, encoder.encode(dataCheckString));

    // Convert ArrayBuffer to hex string
    const signatureArray = Array.from(new Uint8Array(signatureBuffer));
    const hexSignature = signatureArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    if (hexSignature !== hash) {
        return null;
    }

    // Check auth_date freshness — reject tokens older than 24 hours
    const authDate = urlParams.get("auth_date");
    if (!authDate || Date.now() / 1000 - parseInt(authDate, 10) > 86400) {
        return null;
    }

    return Object.fromEntries(urlParams.entries());
}
