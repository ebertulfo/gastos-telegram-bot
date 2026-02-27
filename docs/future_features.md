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

## 4. Scheduled AI Summaries & Alerts

Proactive, automated messages that keep the user informed about their spending velocity without them having to ask.

* **Automated Rollups**: "Cron triggers" running on Cloudflare that generate a natural language summary at the end of the day, week, or month (e.g., "🎯 **Weekly Wrap-Up**: You spent $150 this week. Your biggest category was Dining ($80).").
* **Budget Pacing & Alerts**: The bot can alert the user if they're burning through their monthly "food" tag budget unusually fast based on the RAG history context.
* **Custom Send Times**: Allow users to configure when they receive these (e.g., Every Sunday at 8 PM, or every day at 9 PM).

## 5. Interactive Budget Coaching & Goal Setting

Since the system leverages RAG, it fundamentally understands the user's velocity of spending.
* **"What If" Projections**: Users can ask, "If I stop buying coffee every day, how much will I save this year?" The Agent runs the math based on actual historical indexed coffee expenses.
* **Contextual Goal Setting**: Users can say "Set a limit of $200 for dining this month." As future receipts are processed, the agent monitors the "dining" tag and proactively drops a Telegram message if they hit 80% or 100% of the threshold.

## 6. Conversational Receipt Splitter & Group Debts

Instead of just tracking personal expenses, leverage Vision and the Agent to handle awkward group bills.
* **Line-Item Analysis**: Feed a long group dinner receipt into the parser. The bot extracts every single line item into RAG memory.
* **Agentic Split Allocation**: "Split this receipt with Alice and Bob. Alice had the Pasta, Bob had the Burger, and split tax evenly." The agent calculates debts accurately and spits out a formatted template you can immediately forward to your friends for Venmo/PayNow.

## 7. Warranty & Subscription Auditing

* **Asset Memory**: The agent identifies and flags high-value purchases (e.g. "MacBook Pro") and recurring monthly charges (e.g., "Spotify Premium").
* **Temporal Queries**: Users can later ask: "When does the warranty expire for my laptop?" The RAG agent retrieves the exact date of purchase and calculates the remaining warranty window.
* **Subscription Check**: "How many active subscriptions am I paying for right now?" The agent can list them out and calculate the monthly burn rate.
