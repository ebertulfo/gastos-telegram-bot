import { config } from "dotenv";

config({ path: ".dev.vars" });

const TELEGRAM_SECRET_TOKEN = process.env.TELEGRAM_SECRET_TOKEN || "";
const TARGET_URL = "https://gastos-telegram-bot.edrianbertulfo.workers.dev/webhook/telegram";

async function sendMockWebhook() {
    console.log("Sending mock Telegram webhook to:", TARGET_URL);

    const payload = {
        update_id: 123456789,
        message: {
            message_id: Math.floor(Math.random() * 100000),
            from: {
                id: 5626922312,
                is_bot: false,
                first_name: "MockUser",
                language_code: "en"
            },
            chat: {
                id: 5626922312,
                first_name: "MockUser",
                type: "private"
            },
            date: Math.floor(Date.now() / 1000),
            text: "five dollars for lunch"
        }
    };

    const response = await fetch(TARGET_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Telegram-Bot-Api-Secret-Token": TELEGRAM_SECRET_TOKEN
        },
        body: JSON.stringify(payload)
    });

    const text = await response.text();
    console.log(`HTTP ${response.status} ${response.statusText}`);
    console.log("Response Body:", text);
}

sendMockWebhook().catch(console.error);
