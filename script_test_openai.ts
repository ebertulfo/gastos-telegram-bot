import { extractAmountCurrencyFromText, extractAmountCurrencyFromR2Image } from "./src/ai/openai";
import type { Env } from "./src/types";

// Provide a mock environment with the actual API key from local environment
const env: Env = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY as string,
    OPENAI_VISION_MODEL: "gpt-4o-mini",
    VECTORIZE: {
        query: async () => ({ matches: [] }),
        upsert: async () => ({})
    } as any,
    MEDIA_BUCKET: {} as any
} as any;

async function run() {
    console.log("Testing '13 grab'...");
    const res1 = await extractAmountCurrencyFromText(env, "13 grab", "SGD", "Asia/Singapore", "");
    console.log("Result for '13 grab':", JSON.stringify(res1, null, 2));

    console.log("\\nTesting '6 lunch'...");
    const res2 = await extractAmountCurrencyFromText(env, "6 lunch", "SGD", "Asia/Singapore", "");
    console.log("Result for '6 lunch':", JSON.stringify(res2, null, 2));
}

run().catch(console.error);
