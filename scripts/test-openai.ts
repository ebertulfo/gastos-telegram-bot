import { extractAmountCurrencyFromText } from "../src/ai/openai";
import { Env } from "../src/types";
import { config } from "dotenv";

config({ path: ".dev.vars" });

// Mock env with actual API key
const env = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_VISION_MODEL: "gpt-4o-mini",
} as any as Env;

async function runTests() {
    console.log("---- Testing TEXT Extraction ----");

    const testCases = [
        { text: "spent five dollars on coffee", currency: "USD" },
        { text: "15.50 for lunch", currency: "PHP" },
        { text: "kfc 500", currency: "PHP" },
        { text: "bought some stuff", currency: "PHP" }, // Should gracefully fail/mark review
        { text: "50 dollars", currency: null } // No default currency provided
    ];

    for (const tc of testCases) {
        console.log(`\nInput: "${tc.text}" (Default: ${tc.currency})`);
        try {
            const result = await extractAmountCurrencyFromText(env, tc.text, tc.currency);
            console.log(JSON.stringify(result, null, 2));
        } catch (err: any) {
            console.error("Error:", err.message);
        }
    }
}

runTests().catch(console.error);
