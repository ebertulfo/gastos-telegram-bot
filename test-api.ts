import OpenAI from "openai";

const openai = new OpenAI();

async function main() {
    try {
        const completion = await openai.chat.completions.create({
            messages: [{ role: "system", content: "You are a helpful assistant." }],
            model: "gpt-5-mini",
        });
        console.log(completion.choices[0]);
    } catch (e: any) {
        console.log("Error:", e.message);
    }
}
main();
