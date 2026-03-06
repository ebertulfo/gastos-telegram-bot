# M11: Agentic AI Phase 2 (Granular Analytics)

## 1. Intent
The Phase 1 Agentic Chat (M10) successfully established a secure, memory-bound conversation pipeline. However, the AI's internal tooling is currently too blunt. When a user asks "What did I spend mostly on this week?", the AI only has access to a generic `get_spending_summary` tool which returns a single total number. The AI then guesses or generically replies "You've spent a total of $X. Ask me for categories".

To make the AI genuinely insightful, we need to provide it with SQL-level grouping and aggregation capabilities, specifically empowering it to answer comparative and categorical questions.

## 2. Advanced Analytics Tools

### 2.1 Tool: `get_spending_by_category`
We will introduce a new tool that performs a `GROUP BY category` aggregation across a given time period.

**LLM Arguments:**
*   `period` (string, required): Enum matching our established periods (`today`, `thisweek`, `thismonth`, `thisyear`).

**Backend Override & Execution:**
*   **Privacy Guardrail**: Hardcode the `userId` and `timezone` from the authenticated request payload. The LLM cannot specify a target user.
*   **Database Query**: Connect to `expenses` and aggregate `SUM(amount_minor)` mapped against `category`.
*   **Result Formatting**: Convert `amount_minor` to major currencies. Return a string mapping describing every category and its total spend within that period (e.g. `Food: $45.30, Transport: $12.00`). By feeding the LLM the entire breakdown, it can use its reasoning engine to determine the "highest" or "most" based on the user's natural language question.

## 3. Flagship Model Upgrade (`gpt-4o`)
Even with advanced SQL aggregation tools, the `gpt-4o-mini` model occasionally struggles with complex contextual reasoning or misinterprets comparative user questions.
*   **The Upgrade**: We will transition the `runSemanticChat` function (the core interactive agent) from `gpt-4o-mini` to OpenAI's flagship `gpt-4o` model. This will massively boost the bot's intelligence, allowing it to provide highly articulate, accurate, and deeply reasoned financial advice.
*   **Cost Optimization Strategy**: We will **NOT** upgrade the `classifyIntent` function. The intent router (running on every single incoming Telegram message) will remain on the ultra-cheap `gpt-4o-mini` because simple routing logic does not require flagship reasoning. We only pay for the premium `gpt-4o` model when the user is explicitly having a conversation.

## 4. Implementation Steps
1.  **Tool Definition**: Add `GetSpendingByCategoryTool` object schema to `src/ai/tools.ts`.
2.  **Database Execution**: Write `executeGetSpendingByCategory` in `src/ai/tools.ts` utilizing `getExpenses` and JavaScript `reduce` to group the dataset by category.
3.  **Agent Wiring**: Update `src/ai/agent.ts` to include the new tool in the `tools` array passed to OpenAI, and add the routing execution logic when the `functionName === "get_spending_by_category"`.
4.  **Model Upgrade**: In `src/ai/agent.ts`, change the `model` parameter inside `runSemanticChat` to `gpt-4o` (for both the tool-calling call and the final generative call).
5.  **Testing**: Verify the Agent correctly infers when to use the new group-by tool versus the vanilla summary tool and provides significantly smarter answers.
