# M9: RAG Phase 1 (Vectorize Setup)

## 1. Intent
The goal of Milestone 9 is to implement the "Data Flywheel." We want the AI to learn from the user's past expenses—specifically their manual corrections in the Review Drawer—so it doesn't repeat categorization or parsing mistakes. 

To achieve this cleanly and cost-effectively, we will build a Retrieval-Augmented Generation (RAG) pipeline using **Cloudflare Vectorize** and OpenAI's `text-embedding-3-small` model.

## 2. Architecture & Data Contracts

### 2.1 The Vectorize Index
We will provision a Cloudflare Vectorize index named `gastos-vectors`.
- **Dimensions**: `1536` (matching OpenAI's `text-embedding-3-small`).
- **Metric**: `cosine`.

### 2.2 The Embedding Payload
When saving a vector, we must attach metadata so we can filter by the specific user.
```typescript
type VectorMetadata = {
  user_id: number;
  expense_id: number;
  category: string;
  tags: string; // JSON string
  currency: string;
}
```

### 2.3 The Sync Triggers (When do we learn?)
We will generate and upsert embeddings into Vectorize during two specific operations:
1. **Initial Log (High Confidence)**: If the Queue automatically marks an expense as `final` (confidence > 0.9), we immediately embed it.
2. **User Correction**: When the user edits an expense via `PUT /api/expenses/:id`, we fetch the updated row and generate a new embedding, overwriting the old one in Vectorize using the `expense_id` as the Vector ID.

### 2.4 The Context String
What text exactly are we passing to `text-embedding-3-small`? We will construct a "Memory String", for example:
*Target*: `Raw Text: "Grab 15" -> Parsed as: [Transport] Grab. Tags: ["taxi", "ride"]`

## 3. The Retrieval Flow (How do we learn?)

We will modify the Queue Parser (`src/ai/openai.ts`):
1. **Generate Query Embedding**: When a new message comes in (e.g. "Grab ride"), we first call `text-embedding-3-small` to embed the raw text.
2. **Query Vectorize**: We query `gastos-vectors` for the top 3 closest matches, strictly filtering for `metadata.user_id === currentUser.id`.
3. **Prompt Injection**: We take those 3 historical matches and inject them into the `gpt-4o-mini` System Prompt:

**New Prompt Addition:**
```text
Here is the user's exact geographical context: Timezone: {timezone}, Currency: {currency}.

Here are 3 of the user's most similar historical expenses. You MUST analyze these past decisions and align your current extraction (especially the Category and Tags) to match their historical precedent:
1. Raw Text: "Grab 15" -> Parsed as: [Transport] Grab. Tags: ["taxi"]
2. ...
```

## 4. Edge Cases & Constraints
- **Cold Start**: If querying Vectorize returns 0 results for a user, the prompt simply omits the Context block.
- **Latency**: Adding RAG introduces an extra async OpenAI call (`embeddings`) and a Vectorize query to our Queue Worker. Because this runs in a Queue (background), latency is not a critical UX blocker, but we must ensure we don't hit Cloudflare Worker timeout limits (currently 30 seconds for Queues).
- **Updates Deleting Memory**: If an expense is deleted via the Web App, we should ideally drop its Vector. We will add a vector delete call to `DELETE /api/expenses/:id`.
