import * as dotenv from 'dotenv';
dotenv.config({ path: '.dev.vars' });

async function main() {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "gpt-5.2",
            messages: [{ role: "user", content: "Hello!" }],
            tools: [{
                type: "function",
                function: { name: "test_tool", description: "test", parameters: { type: "object", properties: {} } }
            }],
            tool_choice: "auto",
            max_completion_tokens: 500
        })
    });
    console.log(await response.json());
}
main();
