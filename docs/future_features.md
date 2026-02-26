# Gastos Telegram Bot - Future Feature Ideas

This document tracks brainstorming and feature ideas for taking the Gastos bot to the next level.

## 1. Conversational Agentic AI

Transition the bot from a traditional command-and-response system into a fully conversational financial assistant. Instead of relying purely on slash commands or the Mini App UI, the bot can understand intent and execute actions on the user's behalf.

* **Tool Use (Function Calling)**: Integrate OpenAI's function calling capabilities so the LLM can dynamically decide when to fetch or mutate data.
* **Potential Tools**:
  * `fetch_expenses(timeframe, category, max_limit)`: Allows the bot to answer "How much did I spend on food this week?"
  * `update_expense(id, field, new_value)`: Enables conversational corrections, e.g., "Wait, that coffee was actually 6 dollars, not 5."
  * `generate_report(month)`: Summarizes trends and formats them into a clean Telegram message.
* **Context Awareness**: Maintain short-term context (perhaps using Cloudflare KV or D1 conversational logs) so users can ask follow-up questions seamlessly ("What about last month?").

## 2. RAG Integration (Retrieval-Augmented Generation)

Deepen the Agentic AI's capabilities by allowing it to semantically search through the user's entire expense history.

* **Semantic Search**: Use a Vector database (like Cloudflare Vectorize) to embed and store expense descriptions, OCR text from receipts, and voice transcripts.
* **Complex Question Answering**: Users can ask hyper-specific questions that SQL struggles with, such as "How much did I spend at that dumpling place in Marina Bay last year?" or "What's the average price I pay for a latte?"
* **Proactive Insights**: The RAG system can feed historical context to the Agent, allowing it to proactively note trends (e.g., "Just logged $15 for lunch. You've spent 20% more on dining out this week compared to last week.").

## 3. Expense Tags & Categorization

Move beyond simple text descriptions to structured, queryable tags that tie directly into the RAG and Agentic systems.

* **Automated AI Tagging**: When recipes or voice notes are parsed in the queue, the OpenAI Vision/Text prompt automatically assigns categorical tags (e.g., `#food/dining`, `#transport/taxi`, `#subscription`).
* **User-Defined Tags**: Users can naturally inject tags into their messages ("Five dollar coffee #work_expense"), which the parser will strictly extract and respect.
* **Analytics Integration**: Tags will power pie charts, filtering, and deep analytics on the React Mini App dashboard.
* **Synergy with Agent**: The Agent can use tags as strict filters when calling the `fetch_expenses` tool, making its data retrieval much more accurate.
