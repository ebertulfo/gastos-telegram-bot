# Agents SDK Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the manual OpenAI Chat Completions agent loop with the OpenAI Agents JS SDK, unifying intent classification, expense logging, and financial querying into a single agent.

**Architecture:** Single `Agent` with 4 tools (`log_expense`, `edit_expense`, `delete_expense`, `get_financial_report`), D1-backed session, dynamic instructions. All message types (text/photo/voice) flow through one queue message type, media pre-processed before agent.

**Tech Stack:** `@openai/agents` v0.6.0, `zod` v4, `gpt-4.1-mini` (agent), `gpt-4.1-nano` (extraction/vision)

**Design doc:** `docs/plans/2026-03-10-agents-sdk-migration-design.md`

---

### Task 1: Upgrade Zod to v4

**Files:**
- Modify: `package.json:15` (zod dependency)
- Modify: `src/ai/openai.ts:2` (zod import)
- Modify: `src/routes/webhook.ts:3` (zod import)

**Step 1: Upgrade zod**

```bash
npm install zod@latest
```

**Step 2: Update zod imports**

Zod 4 provides a compatibility layer. Check if the existing import `import { z } from "zod"` still works. If not, update to `import { z } from "zod/v4"`.

The project uses basic Zod APIs (`z.object`, `z.string`, `z.number`, `z.array`, `z.enum`, `z.infer`, `.safeParse`, `.optional`, `.nullable`) — all compatible with Zod 4.

**Step 3: Run tests to verify no breakage**

```bash
npm run check && npm run test
```

Expected: All 21 tests pass, no type errors.

**Step 4: Commit**

```bash
git add package.json package-lock.json src/ai/openai.ts src/routes/webhook.ts
git commit -m "chore: upgrade zod from v3 to v4"
```

---

### Task 2: Install @openai/agents SDK

**Files:**
- Modify: `package.json` (add dependency)

**Step 1: Install the SDK**

```bash
npm install @openai/agents
```

**Step 2: Verify the SDK is importable in Workers**

Create a temporary test:

```bash
npm run check
```

If there are type conflicts between the SDK's `openai` transitive dep and Workers types, resolve by checking `tsconfig.json` types array.

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @openai/agents SDK dependency"
```

---

### Task 3: Update model strings to gpt-4.1 family

**Files:**
- Modify: `src/ai/openai.ts:239` — change default from `"gpt-4o-mini"` to `"gpt-4.1-nano"`
- Modify: `src/ai/openai.ts:37` — change transcription model default
- Modify: `src/notifications.ts:170` — change insight model from `"gpt-4o-mini"` to `"gpt-4.1-nano"`
- Modify: `wrangler.toml` — update `OPENAI_VISION_MODEL` env var if set

**Step 1: Update model defaults in openai.ts**

In `callOpenAIExtraction()` (line 239), change:
```typescript
model: env.OPENAI_VISION_MODEL ?? "gpt-4.1-nano",
```

In `transcribeR2Audio()` (line 37), change:
```typescript
form.append("model", env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe");
```
Keep transcription model as-is — Whisper/transcribe models haven't changed.

In `notifications.ts` (line 170), change:
```typescript
model: "gpt-4.1-nano",
```

**Step 2: Run tests**

```bash
npm run check && npm run test
```

Expected: All pass (OpenAI calls are mocked in tests).

**Step 3: Commit**

```bash
git add src/ai/openai.ts src/notifications.ts
git commit -m "chore: update model strings to gpt-4.1 family"
```

---

### Task 4: Implement D1Session

**Files:**
- Create: `src/ai/session.ts`
- Test: `tests/session.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/session.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { D1Session } from "../src/ai/session";

function createMockDb() {
  const rows: Array<{ role: string; content: string; created_at_utc: string }> = [];
  const all = vi.fn(async () => ({ results: rows }));
  const run = vi.fn(async () => ({}));
  const first = vi.fn(async () => rows[rows.length - 1] ?? null);
  const prepare = vi.fn(() => ({
    bind: vi.fn(() => ({ all, run, first })),
  }));
  return { db: { prepare } as unknown as D1Database, rows, run, all };
}

describe("D1Session", () => {
  it("getItems returns empty array for new user", async () => {
    const { db } = createMockDb();
    const session = new D1Session(db, 1);
    const items = await session.getItems();
    expect(items).toEqual([]);
  });

  it("addItems inserts messages", async () => {
    const { db, run } = createMockDb();
    const session = new D1Session(db, 1);
    await session.addItems([
      { role: "user", content: [{ type: "input_text", text: "hello" }] },
    ]);
    expect(run).toHaveBeenCalled();
  });

  it("clear deletes all history", async () => {
    const { db, run } = createMockDb();
    const session = new D1Session(db, 1);
    await session.clear();
    expect(run).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/session.test.ts
```

Expected: FAIL — `D1Session` not found.

**Step 3: Implement D1Session**

```typescript
// src/ai/session.ts
import type { Session, SessionItem } from "@openai/agents";
import { getRecentChatHistory, insertChatMessage, clearChatHistory } from "../db/chat-history";

export class D1Session implements Session {
  constructor(
    private db: D1Database,
    private userId: number,
    private limit: number = 10
  ) {}

  async getItems(): Promise<SessionItem[]> {
    const history = await getRecentChatHistory(this.db, this.userId, this.limit);
    return history.map((h) => ({
      role: h.role as "user" | "assistant",
      content: [{ type: h.role === "user" ? "input_text" : "output_text", text: h.content }],
    }));
  }

  async addItems(items: SessionItem[]): Promise<void> {
    for (const item of items) {
      const role = item.role === "user" ? "user" : "assistant";
      const text = this.extractText(item);
      if (text) {
        await insertChatMessage(this.db, this.userId, role, text);
      }
    }
  }

  async popItem(): Promise<SessionItem | undefined> {
    // Not critical for our flow — return undefined
    return undefined;
  }

  async updateItem(_index: number, _item: SessionItem): Promise<void> {
    // Not critical for our flow — no-op
  }

  async clear(): Promise<void> {
    await clearChatHistory(this.db, this.userId);
  }

  private extractText(item: SessionItem): string | null {
    if (typeof item.content === "string") return item.content;
    if (Array.isArray(item.content)) {
      for (const block of item.content) {
        if ("text" in block && typeof block.text === "string") return block.text;
      }
    }
    return null;
  }
}
```

> **Note:** The exact `Session` and `SessionItem` types depend on the SDK's actual exports. The implementing engineer MUST check `node_modules/@openai/agents/dist/index.d.ts` for the real interface and adapt accordingly. The SDK may use different names (e.g., `ConversationSession`, `AgentInputItem`). Import what exists.

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/session.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/ai/session.ts tests/session.test.ts
git commit -m "feat: add D1Session for Agents SDK conversation memory"
```

---

### Task 5: Rewrite tools with SDK tool() definitions

**Files:**
- Modify: `src/ai/tools.ts` (rewrite)
- Test: `tests/tools.test.ts` (new)

**Step 1: Write the failing test**

```typescript
// tests/tools.test.ts
import { describe, expect, it, vi } from "vitest";
import { createAgentTools } from "../src/ai/tools";

describe("createAgentTools", () => {
  it("returns 4 tools", () => {
    const mockEnv = {} as any;
    const tools = createAgentTools(mockEnv, 1, "Asia/Manila", "PHP");
    expect(tools).toHaveLength(4);
  });

  it("tool names match expected", () => {
    const mockEnv = {} as any;
    const tools = createAgentTools(mockEnv, 1, "Asia/Manila", "PHP");
    const names = tools.map((t: any) => t.name);
    expect(names).toContain("log_expense");
    expect(names).toContain("edit_expense");
    expect(names).toContain("delete_expense");
    expect(names).toContain("get_financial_report");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/tools.test.ts
```

Expected: FAIL — `createAgentTools` not found.

**Step 3: Rewrite tools.ts**

Replace the current `GetFinancialReportTool` schema and `executeGetFinancialReport` with SDK `tool()` definitions using a closure factory pattern.

```typescript
// src/ai/tools.ts
import { tool } from "@openai/agents";
import { z } from "zod";
import type { Env } from "../types";
import { getExpenses, insertExpense, updateExpense, deleteExpense as dbDeleteExpense } from "../db/expenses";
import { parseTotalsPeriod } from "../totals";
import { searchExpensesBySemantic, extractAmountCurrencyFromText, getHistoricalContext, generateEmbedding } from "./openai";

const CATEGORIES = ["Food", "Transport", "Housing", "Shopping", "Entertainment", "Health", "Other"] as const;
const PERIODS = ["today", "yesterday", "thisweek", "lastweek", "thismonth", "lastmonth", "thisyear", "lastyear"] as const;

export function createAgentTools(env: Env, userId: number, timezone: string, currency: string) {
  const logExpense = tool({
    name: "log_expense",
    description: "Log a new expense. Use when the user mentions spending money, buying something, or provides a receipt-like entry with a number.",
    parameters: z.object({
      amount: z.number().describe("Amount in major units (e.g., 12.50 not 1250)"),
      currency: z.string().length(3).describe("3-letter ISO currency code").default(currency),
      description: z.string().max(50).describe("Short description, max 3 words"),
      category: z.enum(CATEGORIES).describe("Expense category"),
      tags: z.array(z.string()).max(3).describe("1-3 lowercase context tags"),
    }),
    async execute({ amount, currency: cur, description, category, tags }) {
      const amountMinor = Math.round(amount * 100);
      const now = new Date().toISOString();
      // Insert expense — sourceEventId is 0 for agent-created expenses
      await insertExpense(env.DB, userId, 0, amountMinor, cur, category, tags, now, false);

      // Background: vectorize for semantic search
      if (description.trim()) {
        const embedding = await generateEmbedding(env, `${description} ${tags.join(" ")}`);
        if (embedding.length > 0) {
          await env.VECTORIZE.upsert([{
            id: `agent_expense_${Date.now()}`,
            values: embedding,
            metadata: { user_id: userId, category, tags: JSON.stringify(tags), currency: cur, raw_text: description },
          }]);
        }
      }

      return `Logged: ${cur} ${amount.toFixed(2)} | ${category} | ${description} [${tags.join(", ")}]`;
    },
  });

  const editExpense = tool({
    name: "edit_expense",
    description: "Edit a recent expense. Use when the user says 'sorry, it was 6 not 7' or wants to correct a logged expense.",
    parameters: z.object({
      expense_id: z.number().describe("ID of the expense to edit"),
      amount: z.number().optional().describe("New amount in major units"),
      category: z.enum(CATEGORIES).optional().describe("New category"),
      description: z.string().max(50).optional().describe("New description"),
    }),
    async execute({ expense_id, amount, category, description }) {
      const updates: Record<string, unknown> = {};
      if (amount !== undefined) updates.amount_minor = Math.round(amount * 100);
      if (category !== undefined) updates.category = category;
      if (description !== undefined) updates.parsed_description = description;

      await updateExpense(env.DB, expense_id, userId, updates);
      return `Updated expense #${expense_id}`;
    },
  });

  const deleteExpenseTool = tool({
    name: "delete_expense",
    description: "Delete a mistaken expense. Use when the user wants to remove a logged expense.",
    parameters: z.object({
      expense_id: z.number().describe("ID of the expense to delete"),
    }),
    async execute({ expense_id }) {
      await dbDeleteExpense(env.DB, expense_id, userId);
      return `Deleted expense #${expense_id}`;
    },
  });

  // Keep existing executeGetFinancialReport logic — it's complex and well-tested
  const getFinancialReport = tool({
    name: "get_financial_report",
    description: "Returns a comprehensive financial report. This is your database query tool. Returns total spend, category breakdown, and recent transactions. Use for ANY spending question.",
    parameters: z.object({
      period: z.enum(PERIODS).describe("Time boundary to query"),
      category: z.enum(CATEGORIES).optional().describe("Filter by category"),
      tag_query: z.string().optional().describe("Freeform text to search expenses semantically"),
    }),
    async execute({ period, category, tag_query }) {
      return executeGetFinancialReportInternal(env, userId, timezone, period, category, tag_query);
    },
  });

  return [logExpense, editExpense, deleteExpenseTool, getFinancialReport];
}

// Keep the existing report logic as an internal function — copy from current executeGetFinancialReport
async function executeGetFinancialReportInternal(
  env: Env,
  secureUserId: number,
  secureTimezone: string,
  period: string,
  category?: string,
  tagQuery?: string
): Promise<string> {
  // ... (copy entire body of current executeGetFinancialReport from tools.ts)
  // This function stays exactly the same — it's well-tested and complex
}
```

> **IMPORTANT:** The engineer MUST copy the full body of `executeGetFinancialReport()` (lines 63-209 of current `src/ai/tools.ts`) into `executeGetFinancialReportInternal()`. Do not rewrite it.

> **IMPORTANT:** The `updateExpense` and `deleteExpense` functions may not exist in `src/db/expenses.ts` yet. If they don't, create them following the project's db module pattern (see `gastos:new-db-module` skill). They need:
> - `updateExpense(db, expenseId, userId, updates)` — UPDATE with WHERE user_id = ? guard
> - `deleteExpense(db, expenseId, userId)` — DELETE with WHERE user_id = ? guard

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/tools.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/ai/tools.ts tests/tools.test.ts
git commit -m "feat: rewrite tools with SDK tool() definitions and closure factory"
```

---

### Task 6: Rewrite agent.ts with SDK Agent

**Files:**
- Rewrite: `src/ai/agent.ts`
- Test: `tests/agent.test.ts` (new)

**Step 1: Write the failing test**

```typescript
// tests/agent.test.ts
import { describe, expect, it, vi } from "vitest";
import { createGastosAgent, buildSystemPrompt } from "../src/ai/agent";

vi.mock("@openai/agents", () => ({
  Agent: vi.fn().mockImplementation((config: any) => config),
  tool: vi.fn().mockImplementation((config: any) => config),
}));

describe("createGastosAgent", () => {
  it("creates agent with correct model", () => {
    const mockEnv = { OPENAI_API_KEY: "test" } as any;
    const agent = createGastosAgent(mockEnv, 1, "Asia/Manila", "PHP");
    expect(agent.model).toBe("gpt-4.1-mini");
  });

  it("has 4 tools", () => {
    const mockEnv = { OPENAI_API_KEY: "test" } as any;
    const agent = createGastosAgent(mockEnv, 1, "Asia/Manila", "PHP");
    expect(agent.tools).toHaveLength(4);
  });
});

describe("buildSystemPrompt", () => {
  it("includes timezone and currency", () => {
    const prompt = buildSystemPrompt("Asia/Manila", "PHP");
    expect(prompt).toContain("Asia/Manila");
    expect(prompt).toContain("PHP");
  });

  it("includes tool usage instructions", () => {
    const prompt = buildSystemPrompt("UTC", "USD");
    expect(prompt).toContain("log_expense");
    expect(prompt).toContain("get_financial_report");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/agent.test.ts
```

Expected: FAIL — functions not found.

**Step 3: Rewrite agent.ts**

```typescript
// src/ai/agent.ts
import { Agent } from "@openai/agents";
import type { Env } from "../types";
import { createAgentTools } from "./tools";

export function buildSystemPrompt(timezone: string, currency: string): string {
  const today = new Date().toLocaleDateString("en-US", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `You are Gastos, an intelligent financial assistant on Telegram. You help users track expenses and understand their spending.

CAPABILITIES:
- Log expenses when users mention spending (use log_expense tool)
- Edit or delete recent expenses when asked (use edit_expense / delete_expense tools)
- Answer spending questions with data (use get_financial_report tool)
- Have natural conversation about finances

CONTEXT:
- User's timezone: ${timezone}
- User's default currency: ${currency}
- Today's date: ${today}

RULES:
- Be CONCISE. 2-5 lines max for simple questions.
- ALWAYS use tools for data. NEVER guess spending amounts.
- For expense logging: extract amount, currency, description, category, and tags from the user's message. If amount is clear, log it immediately. If ambiguous, ask for clarification.
- For comparisons ("this week vs last week"), call get_financial_report twice with different periods.
- Use tag_query for item-level search (e.g. "drinks", "coffee").
- NEVER end with "Let me know if you want..." or offer follow-ups. Just answer.
- NEVER withhold useful info, but also NEVER pad with unnecessary extras.
- When the user sends a simple number with a word (e.g. "coffee 5", "lunch 12.50", "grab 6"), log it as an expense immediately.`;
}

export function createGastosAgent(env: Env, userId: number, timezone: string, currency: string) {
  const tools = createAgentTools(env, userId, timezone, currency);

  return new Agent({
    name: "gastos",
    model: "gpt-4.1-mini",
    instructions: buildSystemPrompt(timezone, currency),
    tools,
  });
}
```

> **Note:** The `Agent` constructor may require an `apiKey` option on Workers since there's no `process.env`. Check SDK docs. If so, pass `env.OPENAI_API_KEY` via the `model` config or a client option.

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/agent.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/ai/agent.ts tests/agent.test.ts
git commit -m "feat: rewrite agent.ts with SDK Agent definition"
```

---

### Task 7: Simplify ParseQueueMessage type

**Files:**
- Modify: `src/types.ts:64-78`

**Step 1: Replace the discriminated union**

```typescript
// In src/types.ts, replace the ParseQueueMessage type:
export type ParseQueueMessage = {
  userId: number;
  telegramId: number;
  timezone: string;
  currency: string;
  tier: "free" | "premium";
  text?: string;
  r2ObjectKey?: string;
  mediaType?: "photo" | "voice";
};
```

**Step 2: Run type check to see what breaks**

```bash
npm run check
```

Expected: Type errors in `src/queue.ts`, `src/routes/webhook.ts`, `tests/queue.test.ts`, `tests/webhook.test.ts` — these will be fixed in subsequent tasks.

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "refactor: simplify ParseQueueMessage to single type"
```

---

### Task 8: Rewrite queue.ts with SDK runner

**Files:**
- Rewrite: `src/queue.ts`
- Test: `tests/queue.test.ts` (rewrite)

**Step 1: Write the failing test**

```typescript
// tests/queue.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { handleParseQueueBatch } from "../src/queue";
import type { Env, ParseQueueMessage } from "../src/types";

// Mock the agents SDK
vi.mock("@openai/agents", () => ({
  run: vi.fn().mockResolvedValue({ finalOutput: "Logged: PHP 150.00 | Food | lunch" }),
  Agent: vi.fn().mockImplementation((config: any) => config),
  tool: vi.fn().mockImplementation((config: any) => config),
  getGlobalTraceProvider: vi.fn(() => ({ forceFlush: vi.fn().mockResolvedValue(undefined) })),
}));

vi.mock("../src/ai/agent", () => ({
  createGastosAgent: vi.fn().mockReturnValue({}),
  buildSystemPrompt: vi.fn().mockReturnValue("test prompt"),
}));

vi.mock("../src/ai/session", () => ({
  D1Session: vi.fn().mockImplementation(() => ({
    getItems: vi.fn().mockResolvedValue([]),
    addItems: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../src/telegram/messages", () => ({
  sendTelegramChatMessage: vi.fn().mockResolvedValue({}),
  sendChatAction: vi.fn().mockResolvedValue({}),
}));

vi.mock("../src/db/quotas", () => ({
  checkAndRefreshTokenQuota: vi.fn().mockResolvedValue(true),
  incrementTokenUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/ai/openai", () => ({
  transcribeR2Audio: vi.fn().mockResolvedValue("lunch 15"),
  extractAmountCurrencyFromR2Image: vi.fn(),
  extractAmountCurrencyFromText: vi.fn(),
  generateEmbedding: vi.fn().mockResolvedValue([]),
}));

function createMockEnv(): Env {
  return {
    APP_ENV: "test",
    TELEGRAM_BOT_TOKEN: "token",
    OPENAI_API_KEY: "test-key",
    DB: { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ run: vi.fn(), first: vi.fn(), all: vi.fn() })) })) } as unknown as D1Database,
    MEDIA_BUCKET: { get: vi.fn() } as unknown as R2Bucket,
    VECTORIZE: { upsert: vi.fn(), query: vi.fn() } as unknown as VectorizeIndex,
    RATE_LIMITER: {} as unknown as KVNamespace,
    INGEST_QUEUE: {} as Queue,
  };
}

describe("handleParseQueueBatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("processes text message through agent", async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    const env = createMockEnv();
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;

    await handleParseQueueBatch(
      {
        messages: [{
          body: { userId: 1, telegramId: 100, timezone: "UTC", currency: "USD", tier: "free", text: "lunch 15" } as ParseQueueMessage,
          ack,
          retry,
        }],
      } as unknown as MessageBatch<ParseQueueMessage>,
      env,
      ctx
    );

    expect(ack).toHaveBeenCalled();
  });

  it("retries on failure", async () => {
    const { run } = await import("@openai/agents");
    vi.mocked(run).mockRejectedValueOnce(new Error("API error"));

    const ack = vi.fn();
    const retry = vi.fn();
    const env = createMockEnv();
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;

    await handleParseQueueBatch(
      {
        messages: [{
          body: { userId: 1, telegramId: 100, timezone: "UTC", currency: "USD", tier: "free", text: "hello" } as ParseQueueMessage,
          ack,
          retry,
        }],
      } as unknown as MessageBatch<ParseQueueMessage>,
      env,
      ctx
    );

    expect(retry).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/queue.test.ts
```

Expected: FAIL — current queue.ts has different exports/signatures.

**Step 3: Rewrite queue.ts**

```typescript
// src/queue.ts
import { run, getGlobalTraceProvider } from "@openai/agents";
import { createGastosAgent } from "./ai/agent";
import { D1Session } from "./ai/session";
import { sendTelegramChatMessage, sendChatAction } from "./telegram/messages";
import { checkAndRefreshTokenQuota, incrementTokenUsage } from "./db/quotas";
import { transcribeR2Audio } from "./ai/openai";
import type { Env, ParseQueueMessage } from "./types";

export async function handleParseQueueBatch(
  batch: MessageBatch<ParseQueueMessage>,
  env: Env,
  ctx: ExecutionContext
) {
  for (const message of batch.messages) {
    try {
      await processMessage(env, ctx, message.body);
      message.ack();
    } catch (error) {
      console.error("Queue message processing failed", {
        userId: message.body.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      message.retry();
    }
  }
}

async function processMessage(env: Env, ctx: ExecutionContext, body: ParseQueueMessage): Promise<void> {
  const { userId, telegramId, timezone, currency, tier } = body;

  // 1. Quota check
  const hasQuota = await checkAndRefreshTokenQuota(env.DB, userId, telegramId, tier);
  if (!hasQuota) {
    await sendTelegramChatMessage(env, telegramId, "⏳ You have reached your daily AI assistant limit. Please try again tomorrow!");
    return;
  }

  // 2. Typing indicator
  await sendChatAction(env, telegramId, "typing");

  // 3. Pre-process media into agent input
  let agentInput: string | Array<Record<string, unknown>>;

  if (body.mediaType === "voice" && body.r2ObjectKey) {
    const transcript = await transcribeR2Audio(env, body.r2ObjectKey);
    if (!transcript) {
      await sendTelegramChatMessage(env, telegramId, "❌ Could not transcribe voice message. Please try again.");
      return;
    }
    agentInput = transcript;
  } else if (body.mediaType === "photo" && body.r2ObjectKey) {
    const object = await env.MEDIA_BUCKET.get(body.r2ObjectKey);
    if (!object) {
      await sendTelegramChatMessage(env, telegramId, "❌ Could not load image. Please try again.");
      return;
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    const mime = object.httpMetadata?.contentType ?? "image/jpeg";
    const base64 = arrayBufferToBase64(bytes);
    const dataUrl = `data:${mime};base64,${base64}`;

    agentInput = [{
      role: "user",
      content: [
        { type: "input_text", text: body.text ?? "Extract expenses from this receipt." },
        { type: "input_image", image_url: dataUrl },
      ],
    }];
  } else {
    agentInput = body.text ?? "";
  }

  // 4. Create agent and session
  const agent = createGastosAgent(env, userId, timezone, currency);
  const session = new D1Session(env.DB, userId);

  // 5. Run agent with retry
  let result;
  try {
    result = await run(agent, agentInput, { session, maxTurns: 10 });
  } catch (err: unknown) {
    const agentErr = err as { state?: unknown };
    if (agentErr.state) {
      // Retry once from saved state
      try {
        result = await run(agent, agentErr.state);
      } catch {
        await sendTelegramChatMessage(env, telegramId, "Something went wrong, please try again.");
        return;
      }
    } else {
      await sendTelegramChatMessage(env, telegramId, "Something went wrong, please try again.");
      return;
    }
  }

  // 6. Send response to user
  const responseText = result.finalOutput ?? "I couldn't process that. Please try again.";
  await sendTelegramChatMessage(env, telegramId, responseText);

  // 7. Flush traces (token tracking)
  ctx.waitUntil(getGlobalTraceProvider().forceFlush());
}

function arrayBufferToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i += 32768) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768) as unknown as number[]);
  }
  return btoa(binary);
}
```

> **IMPORTANT:** The `run()` function signature, `result.finalOutput`, and state resumption API depend on the actual SDK exports. The engineer MUST check `@openai/agents` types and adapt. Key things to verify:
> - Does `run()` accept `(agent, input, options)` or different?
> - Is the output `result.finalOutput` or `result.output` or something else?
> - Does the SDK `run()` accept a `session` option, or is session passed differently?
> - How does `input_image` work — is it `input_image` or `image_url`?

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/queue.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/queue.ts tests/queue.test.ts
git commit -m "feat: rewrite queue.ts with SDK Agent runner"
```

---

### Task 9: Simplify webhook.ts

**Files:**
- Modify: `src/routes/webhook.ts`
- Test: `tests/webhook.test.ts` (update)

**Step 1: Remove classifyIntent and simplify routing**

The webhook no longer classifies intent — everything goes to the queue. Remove:
- Import of `classifyIntent` from `../ai/agent`
- The entire `if (update.message.text && !update.message.photo && !update.message.voice)` block (lines 93-127)
- Import of `sendChatAction` (typing indicator moves to queue)

Replace with unified queueing:

```typescript
// After onboarding/command handling and ban check:

const user = await upsertUserForIngestion(c.env, telegramUserId, chatId);

// Rate limit all messages (not just text)
const allowed = await checkRateLimit(c.env, telegramUserId);
if (!allowed) {
  await sendTelegramChatMessage(c.env, chatId, "⏳ Too many messages. Please wait a bit.");
  return c.json({ status: "rate_limited" }, 429);
}

// Persist source event and upload media
const sourceEvent = await persistSourceEvent(c.env, user.id, update);
let uploadedR2ObjectKey: string | null = null;

if (!sourceEvent.duplicate) {
  try {
    uploadedR2ObjectKey = await uploadTelegramMediaToR2(c.env, update, sourceEvent.id);
    if (uploadedR2ObjectKey) {
      await setSourceEventR2ObjectKey(c.env, sourceEvent.id, uploadedR2ObjectKey);
    }
  } catch (error) {
    console.error("Media upload failed", {
      sourceEventId: sourceEvent.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

if (sourceEvent.duplicate) {
  return c.json({ status: "duplicate" }, 200);
}

// Determine media type
let mediaType: "photo" | "voice" | undefined;
if (update.message.photo) mediaType = "photo";
else if (update.message.voice) mediaType = "voice";

// Queue for agent processing
const queueMessage: ParseQueueMessage = {
  userId: user.id,
  telegramId: chatId,
  timezone: user.timezone ?? "UTC",
  currency: user.currency ?? "PHP",
  tier: user.tier,
  text: update.message.text,
  r2ObjectKey: uploadedR2ObjectKey ?? undefined,
  mediaType,
};
await c.env.INGEST_QUEUE.send(queueMessage);

return c.json({ status: "queued" }, 200);
```

**Step 2: Update webhook tests**

Remove all `classifyIntent` mock setup and assertions. Update queue message assertions to match new `ParseQueueMessage` shape. Remove "intent" branching tests — add a test that all message types get queued.

**Step 3: Run tests**

```bash
npm run check && npm run test
```

Expected: All pass.

**Step 4: Commit**

```bash
git add src/routes/webhook.ts tests/webhook.test.ts
git commit -m "refactor: simplify webhook to unified queue dispatch"
```

---

### Task 10: Add missing DB functions (updateExpense, deleteExpense)

**Files:**
- Modify: `src/db/expenses.ts`
- Test: Add tests in existing test file or create `tests/expenses.test.ts`

**Step 1: Check if these functions exist**

Read `src/db/expenses.ts` and check for `updateExpense` and `deleteExpense`. If they don't exist:

**Step 2: Write failing tests**

```typescript
// tests/expenses.test.ts
import { describe, expect, it, vi } from "vitest";
import { updateExpense, deleteExpense } from "../src/db/expenses";

function mockDb() {
  const run = vi.fn(async () => ({ meta: { changes: 1 } }));
  return { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ run })) })) } as unknown as D1Database;
}

describe("updateExpense", () => {
  it("updates amount_minor with user_id guard", async () => {
    const db = mockDb();
    await updateExpense(db, 42, 7, { amount_minor: 1500 });
    expect(db.prepare).toHaveBeenCalled();
  });
});

describe("deleteExpense", () => {
  it("deletes with user_id guard", async () => {
    const db = mockDb();
    await deleteExpense(db, 42, 7);
    expect(db.prepare).toHaveBeenCalled();
  });
});
```

**Step 3: Implement**

```typescript
// Add to src/db/expenses.ts

export async function updateExpense(
  db: D1Database,
  expenseId: number,
  userId: number,
  updates: Record<string, unknown>
): Promise<void> {
  const fields = Object.keys(updates);
  if (fields.length === 0) return;

  const setClauses = fields.map((f) => `${f} = ?`).join(", ");
  const values = fields.map((f) => updates[f]);

  await db
    .prepare(`UPDATE expenses SET ${setClauses} WHERE id = ? AND user_id = ?`)
    .bind(...values, expenseId, userId)
    .run();
}

export async function deleteExpense(
  db: D1Database,
  expenseId: number,
  userId: number
): Promise<void> {
  await db
    .prepare(`DELETE FROM expenses WHERE id = ? AND user_id = ?`)
    .bind(expenseId, userId)
    .run();
}
```

> **CRITICAL:** Both functions include `AND user_id = ?` — this is the privacy wall. The agent cannot delete/update other users' data.

**Step 4: Run tests**

```bash
npm run check && npm run test
```

**Step 5: Commit**

```bash
git add src/db/expenses.ts tests/expenses.test.ts
git commit -m "feat: add updateExpense and deleteExpense with user_id guard"
```

---

### Task 11: Clean up dead code

**Files:**
- Modify: `src/ai/agent.ts` — remove old exports if any remain
- Modify: `src/queue.ts` — remove `extractForSourceEvent` export
- Modify: `src/ai/openai.ts` — keep all functions (still used by tools and notifications)
- Check: `src/routes/webhook.ts` — ensure no dead imports

**Step 1: Search for references to deleted functions**

```bash
grep -r "classifyIntent\|runSemanticChat\|looksLikeLeakedToolCall\|handleReceiptMessage\|extractForSourceEvent\|GetFinancialReportTool" src/ tests/
```

Remove any remaining references.

**Step 2: Remove unused imports and exports**

Clean up any orphaned imports across modified files.

**Step 3: Run full verification**

```bash
npm run check && npm run test
```

Expected: All pass, no type errors, no unused imports.

**Step 4: Commit**

```bash
git add -u
git commit -m "chore: remove dead code from pre-SDK migration"
```

---

### Task 12: Integration smoke test

**Files:** None — manual testing only

**Step 1: Local dev test**

```bash
npm run dev
```

Send test messages via Telegram:
1. Text expense: "coffee 5" → should log via agent
2. Question: "how much did I spend this week?" → should query via agent
3. Voice message → should transcribe then process via agent
4. Photo receipt → should extract via agent
5. Conversation: "hello" → should chat naturally

**Step 2: Check logs**

Watch `wrangler tail` for:
- Agent run completing without errors
- Tool calls being made correctly
- Token usage being tracked

**Step 3: Run full test suite one final time**

```bash
npm run check && npm run test
```

Expected: All pass.

---

## Task Dependency Graph

```
Task 1 (Zod 4) ──┐
Task 2 (SDK)   ──┼──→ Task 4 (D1Session) ──→ Task 8 (queue.ts)  ──┐
Task 3 (models)──┘    Task 5 (tools)      ──→ Task 8             ──┼──→ Task 11 (cleanup) ──→ Task 12 (smoke test)
                       Task 6 (agent.ts)   ──→ Task 8             ──┤
                       Task 7 (types)      ──→ Task 8 + Task 9    ──┤
                       Task 10 (DB funcs)  ──→ Task 5             ──┘
                                              Task 9 (webhook)   ──┘
```

**Critical path:** 1 → 2 → 10 → 5 → 6 → 4 → 7 → 8 → 9 → 11 → 12

**Parallelizable:** Tasks 1, 2, 3 can run in parallel. Tasks 4, 5, 6, 10 can run in parallel after 1+2.
