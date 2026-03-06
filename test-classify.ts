import * as dotenv from 'dotenv';
dotenv.config({ path: '.dev.vars' });

async function main() {
    const text = "what did I spend on the most htis week";
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "gpt-5-mini",
            messages: [
                {
                    role: "system",
                    content: `You are a strict text classification router. You only output exactly one word: "log" or "question".
If the user says "15 food", "lunch 20$", "grab 6", or provides a receipt-like entry, output "log".
If the user asks "How much did I spend?", "What's my biggest expense?", "Show me my recent food", output "question".`
                },
                {
                    role: "user",
                    content: text
                }
            ],
            max_completion_tokens: 5
        })
    });
    
    if (!response.ok) {
        console.log("Response failed:", await response.text());
        return;
    }
    
    const data = await response.json() as any;
    console.log("Raw answer:", data.choices?.[0]?.message?.content);
}
main();
