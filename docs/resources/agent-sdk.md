# **Technical Brief: Gastos Telegram Bot Upgrades (Cloudflare-Native)**

**Focus:** UX improvements, concurrency handling, LLM latency optimization, and context memory within a Cloudflare Workers environment.

## **1\. Overview**

Gastos is a Telegram-based expense tracker that accepts text, voice messages (.ogg), and images (receipts). Currently, the bot suffers from UX issues during high-latency LLM processing (dead air causing users to spam inputs, leading to duplicate database entries) and lacks contextual memory for continuous conversational queries (e.g., "Gimme a list of these items").

This document outlines the architecture upgrades required to solve these issues natively using the **Cloudflare Infra Stack**.

## **2\. Phase 1: UX, Concurrency & The Webhook Timeout**

**Goal:** Prevent users from double-submitting expenses and prevent Telegram from infinitely retrying webhooks due to LLM processing times.

### **A. The "Dead Air" & Timeout Mitigation**

Because Cloudflare Workers are serverless edge functions, we cannot hold the Telegram webhook connection open indefinitely while OpenAI processes multimodal inputs.

* **Immediate Acknowledgment:** The primary Fetch Worker receives the Telegram webhook, immediately fires a Telegram API call for a placeholder message (e.g., *"⏳ Processing receipt..."*), and then strictly returns an HTTP 200 OK to close the Telegram connection and prevent retries.  
* **Background Processing (ctx.waitUntil):** The heavy lifting (OpenAI SDK execution) must be wrapped in ctx.waitUntil(), allowing the Worker to continue executing the LLM call *after* the HTTP response is sent.  
* **Cloudflare Queues (Optional/Recommended):** For processing heavy audio files, the Fetch Worker should pass the data payload to a Cloudflare Queue. A secondary Queue Consumer Worker executes the OpenAI SDK and uses editMessageText to swap the placeholder with the final structured data.

### **B. Idempotency & Duplicate Prevention**

Cloudflare KV is eventually consistent and unsuitable for strict race-condition locking.

* **Processing Lock (Durable Objects or Upstash):** Use a **Cloudflare Durable Object** instantiated by the user\_id to act as a strict, single-threaded queue manager for that specific user. Alternatively, use an external REST-based fast cache like Upstash Redis.  
* **Idempotency Window (Cloudflare D1):** Before inserting a parsed expense, query the **Cloudflare D1** database for the last 5 minutes of the user's history. If an identical amount and category exist, pause the insert and prompt the user via Telegram Inline Keyboard to confirm if it is a duplicate.

## **3\. Phase 2: LLM Processing Pipeline**

**Goal:** Minimize end-to-end latency for multimodal inputs (voice notes and receipt images) while ensuring predictable, structured data extraction.

* **Framework & Model:** We are utilizing the **OpenAI Agents SDK** powered by **GPT-4o** (and **GPT-4o-mini** for lighter background tasks).  
* **Environment Configuration:** Because Cloudflare Workers run on V8 Isolates, the nodejs\_compat flag **MUST** be enabled in the wrangler.jsonc file to ensure full compatibility with the OpenAI Agents SDK.  
* **Rationale:** The OpenAI Agents SDK provides a production-ready abstraction with built-in agent loops and memory tracking. Because gpt-4o is natively multimodal, we can process raw Telegram audio buffers and receipt images directly.  
* **Output Strategy:** We will utilize the SDK's native output\_type parameter coupled with Pydantic/Zod models. This leverages OpenAI's Structured Outputs feature, guaranteeing 100% adherence to our required JSON schema (e.g., {amount: number, category: string}) for reliable Cloudflare D1 database insertions.

## **4\. Phase 3: Contextual Memory & Auto-Compaction**

**Goal:** Allow users to have continuous conversations with pronoun resolution (e.g., referring back to "these items" or "that lunch") without bloating the context window and skyrocketing token costs.

### **A. Two-Tiered Memory Architecture**

We will implement a hybrid memory approach leveraging the SDK's native features:

1. **Short-Term Context via SDK Sessions:** We will utilize the OpenAI Agents SDK's built-in Sessions to maintain the history of recent interactions. The session state can be serialized and temporarily persisted in **Cloudflare KV** or **D1** keyed by the Telegram chat\_id.  
2. **Intent Parsing Update:** Define clear instructions on the Agent object, explicitly directing it to review the session history to contextualize vague user queries before generating a database query payload.  
   * *User:* "Gimme a list of these items."  
   * *Agent parses as:* {"intent": "fetch\_expenses", "category": "drinks", "timeframe": "last\_month"}.

### **B. Background Auto-Compaction (Rolling Summary)**

To prevent the session memory from growing infinitely:

* **The Trigger:** Monitor the token count or message count of the active session array. Once it hits a threshold (e.g., 8 messages), trigger a background summarization job using ctx.waitUntil() or a Cloudflare Queue.  
* **The Compaction:** Send the session history to a lightweight gpt-4o-mini summarizer agent with the prompt: *"Summarize the key facts, extracted entities, and intents of this conversation in under 50 words."*  
* **The Replacement:** Update the Cloudflare KV/D1 session state by clearing the older messages and injecting the newly generated summary as a system context message at the top of the session.

## **5\. Next Steps for Antigravity**

1. **Configure the Cloudflare Environment:** Ensure nodejs\_compat is enabled in Wrangler. Decide between Durable Objects or D1 for the strict user-level processing locks.  
2. **Establish the Async Pattern:** Implement the ctx.waitUntil() or Cloudflare Queues architecture to guarantee Telegram receives its 200 OK instantly, decoupling the webhooks from the LLM execution time.  
3. **Set up the OpenAI Agents SDK Pipeline:** Initialize the SDK within the worker, accepting Telegram buffers (audio/images), and defining the Zod/Pydantic schemas for the output\_type constraints.