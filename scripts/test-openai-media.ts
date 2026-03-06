import fs from "fs";
import path from "path";
import { extractAmountCurrencyFromR2Image, extractAmountCurrencyFromText, transcribeR2Audio } from "../src/ai/openai";
import { Env } from "../src/types";
import { config } from "dotenv";

config({ path: ".dev.vars" });

const mockBucket = {
    get: async (key: string) => {
        const localPath = path.join(process.cwd(), "tests", "fixtures", path.basename(key));
        if (!fs.existsSync(localPath)) {
            console.error(`MockBucket missing file: ${localPath}`);
            return null;
        }
        const buffer = fs.readFileSync(localPath);
        // return a mocked R2 object structure
        return {
            arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
            httpMetadata: {
                contentType: key.endsWith(".jpg") ? "image/jpeg" : "audio/ogg",
            },
        };
    },
};

const env = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_VISION_MODEL: "gpt-4o-mini",
    MEDIA_BUCKET: mockBucket,
} as any as Env;

async function runMediaTests() {
    console.log("---- Testing VOICE Extraction ----");
    const voiceKeys = [
        "source-events/1/voice/file_0.oga",
        "source-events/4/voice/file_1.oga",
        "source-events/9/voice/file_6.oga"
    ];

    for (const key of voiceKeys) {
        console.log(`\nTesting Voice File: ${key}`);
        try {
            const transcript = await transcribeR2Audio(env, key);
            console.log(`Transcript: "${transcript}"`);
            if (transcript) {
                const textResult = await extractAmountCurrencyFromText(env, transcript, "PHP");
                console.log("Extraction:", textResult);
            }
        } catch (err: any) {
            console.error("Voice Error:", err.message);
        }
    }

    console.log("\n---- Testing PHOTO Extraction ----");
    const photoKeys = [
        "source-events/8/photos/file_5.jpg",
        "source-events/10/photos/file_7.jpg",
        "source-events/14/photos/file_8.jpg"
    ];

    for (const key of photoKeys) {
        console.log(`\nTesting Photo File: ${key}`);
        try {
            const photoResult = await extractAmountCurrencyFromR2Image(env, key, "PHP");
            console.log("Extraction:", photoResult);
        } catch (err: any) {
            console.error("Photo Error:", err.message);
        }
    }
}

runMediaTests().catch(console.error);
