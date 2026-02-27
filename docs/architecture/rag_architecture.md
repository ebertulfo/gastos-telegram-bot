# Gastos AI & RAG Architecture Specification

This specification outlines the technical approach for upgrading the Gastos Telegram Bot with an Agentic AI capable of Retrieval-Augmented Generation (RAG).

## 1. Core Objectives
*   **Conversational Reporting**: Allow users to query their expense history using natural language (e.g., "How much did I spend on food this month?").
*   **Semantic Search**: Enable fuzzy matching of expenses (e.g., finding "Burger King" when asked about "fast food").
*   **Automated Tagging**: Use AI to automatically enrich parsed receipts and voice notes with structured categories.
*   **Cloudflare Native**: Leverage existing Cloudflare ecosystem tools (Workers AI, Vectorize, D1) to minimize external dependencies and latency.

## 2. Architecture Components

### 2.1. Cloudflare Vectorize (Vector Database)
To achieve semantic search, we need to convert expense text into mathematical vectors (embeddings) and store them in a database optimized for similarity searches.
*   **Resource**: Cloudflare Vectorize index (e.g., `gastos-expense-embeddings`).
*   **Embedding Model**: Cloudflare Workers AI `@cf/baai/bge-small-en-v1.5` (fast, native, cheap) or OpenAI `text-embedding-3-small`.
*   **Data Stored**: 
    *   **Vector**: The embedding of the `description` and `text_raw`.
    *   **Metadata**: `expense_id`, `user_id`, `amount_minor`, `currency`, `occurred_at_utc`.

### 2.2. Automated Tagging Pipeline (Ingestion)
When a new media file or text message is parsed by the `gastos-parse-queue`:
1.  **OpenAI Prompt Update**: Modify the existing `gpt-4o-mini` prompt to not only extract `amount`, `currency`, and `description`, but also an array of standard `tags` (e.g., `["food", "dining", "fast_food"]`).
2.  **D1 Storage**: Update the `expenses` table schema (or create a new `expense_tags` relational table) to store these structured tags.
3.  **Vectorization**: Immediately upon saving the expense, invoke the Embedding Model on the extracted `description` + `tags` and insert the resulting vector into the Vectorize index.

### 2.3. Conversational Agent (The "Brain")
Replace the static `handleOnboardingOrCommand` logic with an active LLM agent that routes user intents.
*   **Trigger**: Any text message sent to the bot that *doesn't* look like a raw expense logging attempt (e.g., questions ending in "?", or explicit reporting requests).
*   **Model**: OpenAI `gpt-4o` or `gpt-4o-mini` with **Function Calling** enabled.
*   **Tools Provided to the Agent**:
    1.  `query_database(sql_query)`: For exact aggregations (e.g., "Sum total spent in March 2026"). The Agent translates the user's intent into a safe SQLite query against the D1 DB.
    2.  `semantic_search(query_string, limit)`: The Agent generates a search string (e.g., "coffee shops"), embeds it, and queries the Vectorize index to find the top $N$ matching expenses.
    3.  `update_expense(id, changes)`: Allows the user to conversationally edit past mistakes.

## 3. The RAG Query Flow

When a user asks: *"Did I spend too much on coffee this week?"*

1.  **Intent Routing**: Telegram Webhook receives the text. The system determines it is a query, not an ingestion event.
2.  **Agent Invocation**: The text is sent to the Agent LLM along with the user's current context (timezone, currency).
3.  **Tool Selection**: The Agent realizes it needs data. It decides to call the `semantic_search` tool with the argument `"coffee"`.
4.  **Retrieval (RAG)**:
    *   The term "coffee" is embedded using the chosen model.
    *   Cloudflare Vectorize is queried for the top 10 expenses closest to the "coffee" vector for that specific `user_id` within the last 7 days.
    *   Vectorize returns the metadata (amounts, dates) for Starbucks, local cafes, etc.
5.  **Augmented Generation**: The Agent receives this structured financial data. It formulates a final, helpful response: *"You spent a total of $45 on coffee this week across 8 transactions. That's $10 more than last week!"*
6.  **Response Delivery**: The response is sent back to the user via the Telegram API.

## 4. Required Implementation Steps

*   [ ] **Phase 1: D1 Schema Upgrades** - Add `tags` storage and prepare D1 for dynamic querying.
*   [ ] **Phase 2: Cloudflare Vectorize Setup** - Provision the index via Wrangler and write the ingestion logic inside the queue worker to keep vectors synced with D1.
*   [ ] **Phase 3: Agentic Router** - Rearchitect `webhook.ts` to pass conversational messages to an OpenAI Assistant/Chat Completion loop with registered tools.
*   [ ] **Phase 4: Tool Implementation** - Write the actual TypeScript functions for `semantic_search` and secure `safe_sql_query` that the Agent can invoke.
