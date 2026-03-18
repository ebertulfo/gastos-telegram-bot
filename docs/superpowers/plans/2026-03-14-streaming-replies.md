# Streaming Agent Replies Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream agent responses progressively to Telegram using `sendMessageDraft` so users see text as it generates instead of waiting 10-20s for a wall of text.

**Architecture:** New `StreamingReplyManager` class manages draft lifecycle (send → update → finalize). Queue processor switches from `run()` to `run({ stream: true })` and feeds stream events into the manager. Draft updates throttled to 1s, plain text during streaming, MarkdownV2 only on final `sendMessage`.

**Tech Stack:** OpenAI Agents SDK streaming (`run` with `stream: true`), Telegram Bot API 9.3+ (`sendMessageDraft`), Cloudflare Workers

**Spec:** `docs/superpowers/specs/2026-03-14-streaming-replies-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/telegram/messages.ts` | Add `sendMessageDraft` function |
| Create | `src/telegram/streaming.ts` | `StreamingReplyManager` class + `getToolStatusText` helper |
| Modify | `src/queue.ts` | Switch to streaming `run()`, integrate `StreamingReplyManager` |
| Create | `tests/streaming.test.ts` | Unit tests for `StreamingReplyManager` |
| Modify | `tests/queue.test.ts` | Update mocks for streaming flow |

---

## Task 1: Add `sendMessageDraft` to Telegram messages

**Files:**
- Modify: `src/telegram/messages.ts`
- Modify: `tests/webhook.test.ts` (mock update)

### Steps

- [ ] **Step 1: Add `sendMessageDraft` function**

Add to `src/telegram/messages.ts` after the existing `sendChatAction` function:

```typescript
export async function sendMessageDraft(
  env: Env,
  chatId: number,
  draftId: number,
  text: string,
): Promise<void> {
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessageDraft`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, draft_id: draftId, text }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Telegram sendMessageDraft failed with status ${response.status}`,
    );
  }
}
```

No `parse_mode` — plain text only during streaming. No response body parsing — API returns `true`, not a Message object.

- [ ] **Step 2: Update webhook test mock**

In `tests/webhook.test.ts`, the mock for `src/telegram/messages` needs `sendMessageDraft` added. Find the existing mock block:

```typescript
vi.mock("../src/telegram/messages", () => ({
  sendTelegramChatMessage: vi.fn().mockResolvedValue(undefined),
  sendChatAction: vi.fn().mockResolvedValue(undefined),
}));
```

Add `sendMessageDraft`:

```typescript
vi.mock("../src/telegram/messages", () => ({
  sendTelegramChatMessage: vi.fn().mockResolvedValue(undefined),
  sendChatAction: vi.fn().mockResolvedValue(undefined),
  sendMessageDraft: vi.fn().mockResolvedValue(undefined),
}));
```

- [ ] **Step 3: Run tests**

Run: `npm run check && npm run test`
Expected: All tests pass, no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/telegram/messages.ts tests/webhook.test.ts
git commit -m "feat: add sendMessageDraft for Telegram streaming drafts"
```

---

## Task 2: Create `StreamingReplyManager`

**Files:**
- Create: `src/telegram/streaming.ts`
- Create: `tests/streaming.test.ts`

### Steps

- [ ] **Step 1: Write failing tests for `StreamingReplyManager`**

Create `tests/streaming.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { StreamingReplyManager, getToolStatusText } from "../src/telegram/streaming";
import type { Env, ParseQueueMessage } from "../src/types";

// Mock telegram messages module
vi.mock("../src/telegram/messages", () => ({
  sendMessageDraft: vi.fn().mockResolvedValue(undefined),
  sendTelegramChatMessage: vi.fn().mockResolvedValue(undefined),
}));

function createEnv(): Env {
  return {
    APP_ENV: "test",
    TELEGRAM_BOT_TOKEN: "token",
    OPENAI_API_KEY: "test-key",
    DB: {} as D1Database,
    MEDIA_BUCKET: {} as R2Bucket,
    VECTORIZE: {} as VectorizeIndex,
    RATE_LIMITER: {} as KVNamespace,
    INGEST_QUEUE: {} as Queue<ParseQueueMessage>,
  };
}

describe("StreamingReplyManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sendDraft sends a draft and sets started to true", async () => {
    const { sendMessageDraft } = await import("../src/telegram/messages");
    const manager = new StreamingReplyManager(createEnv(), 12345);

    expect(manager.started).toBe(false);
    await manager.sendDraft("Hello");
    expect(manager.started).toBe(true);
    expect(sendMessageDraft).toHaveBeenCalledWith(
      expect.objectContaining({ TELEGRAM_BOT_TOKEN: "token" }),
      12345,
      expect.any(Number),
      "Hello",
    );
  });

  it("sendDraft skips API call when text matches lastSentText", async () => {
    const { sendMessageDraft } = await import("../src/telegram/messages");
    const manager = new StreamingReplyManager(createEnv(), 12345);

    await manager.sendDraft("Hello");
    await manager.sendDraft("Hello");

    expect(sendMessageDraft).toHaveBeenCalledTimes(1);
  });

  it("appendText accumulates buffer and sends after throttle window", async () => {
    const { sendMessageDraft } = await import("../src/telegram/messages");
    const manager = new StreamingReplyManager(createEnv(), 12345);

    // First append should send immediately (no prior send)
    await manager.appendText("Hello ");
    expect(sendMessageDraft).toHaveBeenCalledTimes(1);
    expect(sendMessageDraft).toHaveBeenCalledWith(
      expect.anything(),
      12345,
      expect.any(Number),
      "Hello ",
    );

    // Second append within throttle window should NOT send
    await manager.appendText("world");
    expect(sendMessageDraft).toHaveBeenCalledTimes(1);

    // After 1 second, next append should send accumulated buffer
    vi.advanceTimersByTime(1000);
    await manager.appendText("!");
    expect(sendMessageDraft).toHaveBeenCalledTimes(2);
    expect(sendMessageDraft).toHaveBeenLastCalledWith(
      expect.anything(),
      12345,
      expect.any(Number),
      "Hello world!",
    );
  });

  it("finalize sends final message via sendTelegramChatMessage when draft was started", async () => {
    const { sendTelegramChatMessage } = await import("../src/telegram/messages");
    const manager = new StreamingReplyManager(createEnv(), 12345);

    await manager.sendDraft("draft text");
    await manager.finalize("Final formatted text");

    expect(sendTelegramChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ TELEGRAM_BOT_TOKEN: "token" }),
      12345,
      "Final formatted text",
    );
  });

  it("finalize sends directly when no draft was ever sent", async () => {
    const { sendTelegramChatMessage, sendMessageDraft } = await import("../src/telegram/messages");
    const manager = new StreamingReplyManager(createEnv(), 12345);

    await manager.finalize("Direct message");

    expect(sendMessageDraft).not.toHaveBeenCalled();
    expect(sendTelegramChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ TELEGRAM_BOT_TOKEN: "token" }),
      12345,
      "Direct message",
    );
  });

  it("finalize uses fallback text when given empty string", async () => {
    const { sendTelegramChatMessage } = await import("../src/telegram/messages");
    const manager = new StreamingReplyManager(createEnv(), 12345);

    await manager.finalize("");

    expect(sendTelegramChatMessage).toHaveBeenCalledWith(
      expect.anything(),
      12345,
      "I couldn't process that. Please try again.",
    );
  });

  it("finalize truncates text exceeding 4096 characters", async () => {
    const { sendTelegramChatMessage } = await import("../src/telegram/messages");
    const manager = new StreamingReplyManager(createEnv(), 12345);

    const longText = "a".repeat(5000);
    await manager.finalize(longText);

    const sentText = vi.mocked(sendTelegramChatMessage).mock.calls[0][2];
    expect(sentText.length).toBe(4096);
    expect(sentText.endsWith("...")).toBe(true);
  });

  it("sendDraft logs warning and does not throw on HTTP 429", async () => {
    const { sendMessageDraft } = await import("../src/telegram/messages");
    vi.mocked(sendMessageDraft).mockRejectedValueOnce(
      new Error("Telegram sendMessageDraft failed with status 429"),
    );

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const manager = new StreamingReplyManager(createEnv(), 12345);

    // Should not throw
    await manager.sendDraft("Hello");

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("429"),
    );
    consoleSpy.mockRestore();
  });

  it("sendDraft logs and does not throw on other errors", async () => {
    const { sendMessageDraft } = await import("../src/telegram/messages");
    vi.mocked(sendMessageDraft).mockRejectedValueOnce(
      new Error("Telegram sendMessageDraft failed with status 500"),
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const manager = new StreamingReplyManager(createEnv(), 12345);

    await manager.sendDraft("Hello");

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("getToolStatusText", () => {
  it("returns specific text for known tools", () => {
    expect(getToolStatusText("log_expense")).toBe("Logging your expense...");
    expect(getToolStatusText("edit_expense")).toBe("Updating your expense...");
    expect(getToolStatusText("delete_expense")).toBe("Deleting your expense...");
    expect(getToolStatusText("get_financial_report")).toBe("Looking up your expenses...");
  });

  it("returns default text for unknown tools", () => {
    expect(getToolStatusText("unknown_tool")).toBe("Working on it...");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/streaming.test.ts`
Expected: FAIL — `src/telegram/streaming` module not found.

- [ ] **Step 3: Implement `StreamingReplyManager` and `getToolStatusText`**

Create `src/telegram/streaming.ts`:

```typescript
import { sendMessageDraft, sendTelegramChatMessage } from "./messages";
import type { Env } from "../types";

const THROTTLE_MS = 1000;
const MAX_MESSAGE_LENGTH = 4096;
const FALLBACK_TEXT = "I couldn't process that. Please try again.";

const TOOL_STATUS_MAP: Record<string, string> = {
  log_expense: "Logging your expense...",
  edit_expense: "Updating your expense...",
  delete_expense: "Deleting your expense...",
  get_financial_report: "Looking up your expenses...",
};

export function getToolStatusText(toolName: string): string {
  return TOOL_STATUS_MAP[toolName] ?? "Working on it...";
}

export class StreamingReplyManager {
  private readonly env: Env;
  private readonly chatId: number;
  private readonly draftId: number;
  private buffer = "";
  private lastSentText = "";
  private lastSendTime = 0;
  started = false;

  constructor(env: Env, chatId: number) {
    this.env = env;
    this.chatId = chatId;
    this.draftId = Math.floor(Math.random() * 2_147_483_647);
  }

  async sendDraft(text: string): Promise<void> {
    if (text === this.lastSentText) return;

    try {
      await sendMessageDraft(this.env, this.chatId, this.draftId, text);
      this.lastSentText = text;
      this.lastSendTime = Date.now();
      this.started = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("429")) {
        console.warn(`Draft throttled (429) for chat ${this.chatId}`);
      } else {
        console.error(`Draft send error for chat ${this.chatId}:`, message);
      }
    }
  }

  async appendText(delta: string): Promise<void> {
    this.buffer += delta;

    const elapsed = Date.now() - this.lastSendTime;
    if (elapsed >= THROTTLE_MS && this.buffer !== this.lastSentText) {
      await this.sendDraft(this.buffer);
    }
  }

  async finalize(text?: string): Promise<void> {
    let finalText = text || FALLBACK_TEXT;

    if (finalText.length > MAX_MESSAGE_LENGTH) {
      finalText = finalText.slice(0, MAX_MESSAGE_LENGTH - 3) + "...";
    }

    await sendTelegramChatMessage(this.env, this.chatId, finalText);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run check && npm run test -- tests/streaming.test.ts`
Expected: All tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/telegram/streaming.ts tests/streaming.test.ts
git commit -m "feat: add StreamingReplyManager for progressive Telegram responses"
```

---

## Task 3: Integrate streaming into queue processor

**Files:**
- Modify: `src/queue.ts:125-169` (agent run + reply sections)
- Modify: `tests/queue.test.ts` (update mocks for streaming)

### Steps

- [ ] **Step 1: Update queue test mocks for streaming**

The `@openai/agents` mock in `tests/queue.test.ts` needs to return a `StreamedRunResult`-like object when `stream: true` is passed. Replace the existing `run` mock (lines 6-14):

```typescript
// Mock the SDK
vi.mock("@openai/agents", () => {
  // Create a mock stream that yields events and has completed/finalOutput/rawResponses
  function createMockStream() {
    const events: any[] = [];
    return {
      [Symbol.asyncIterator]: async function* () {
        for (const event of events) {
          yield event;
        }
      },
      completed: Promise.resolve(),
      finalOutput: "Logged: PHP 150.00 | Food | lunch",
      rawResponses: [{ usage: { totalTokens: 500 } }],
    };
  }

  return {
    run: vi.fn().mockImplementation(() => Promise.resolve(createMockStream())),
    setDefaultModelProvider: vi.fn(),
    getGlobalTraceProvider: vi.fn(() => ({
      forceFlush: vi.fn().mockResolvedValue(undefined),
    })),
    addTraceProcessor: vi.fn(),
  };
});
```

Also add a mock for `src/telegram/streaming`:

```typescript
vi.mock("../src/telegram/streaming", () => ({
  StreamingReplyManager: vi.fn().mockImplementation(() => ({
    started: false,
    sendDraft: vi.fn().mockResolvedValue(undefined),
    appendText: vi.fn().mockResolvedValue(undefined),
    finalize: vi.fn().mockResolvedValue(undefined),
  })),
  getToolStatusText: vi.fn().mockReturnValue("Working on it..."),
}));
```

- [ ] **Step 2: Update test assertions**

The existing test `"processes a text message through the agent and acks"` asserts that `run` is called without `stream: true` and that `sendTelegramChatMessage` is called for the reply. Update these:

For the `run` call assertion, change:

```typescript
expect(run).toHaveBeenCalledWith(
  expect.objectContaining({ name: "gastos" }),
  "coffee 150",
  expect.objectContaining({ maxTurns: 10 }),
);
```

To:

```typescript
expect(run).toHaveBeenCalledWith(
  expect.objectContaining({ name: "gastos" }),
  "coffee 150",
  expect.objectContaining({ maxTurns: 10, stream: true }),
);
```

Remove the `sendTelegramChatMessage` assertion from this test — the streaming manager now handles message sending via `finalize()`. Instead, verify the streaming manager was used:

```typescript
const { StreamingReplyManager } = await import("../src/telegram/streaming");
expect(StreamingReplyManager).toHaveBeenCalledWith(env, 12345);

const managerInstance = vi.mocked(StreamingReplyManager).mock.results[0].value;
expect(managerInstance.finalize).toHaveBeenCalledWith(
  "Logged: PHP 150.00 | Food | lunch",
);
```

Update the voice and photo tests similarly — change `maxTurns: 10` to `maxTurns: 10, stream: true`.

The quota test (`"sends quota exceeded message without running the agent"`) should NOT change — quota check happens before streaming starts and still uses `sendTelegramChatMessage` directly.

The retry test (`"retries on agent failure"`) should still work — `vi.mocked(run).mockRejectedValueOnce(new Error("model error"))` rejects the `run()` promise before any stream is created, so the error propagates to `message.retry()` as before. Verify this test still passes without changes.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test -- tests/queue.test.ts`
Expected: FAIL — `src/queue.ts` still uses non-streaming `run()`.

- [ ] **Step 4: Modify `src/queue.ts` to use streaming**

Add the streaming import at the top of `src/queue.ts` (after existing imports):

```typescript
import { StreamingReplyManager, getToolStatusText } from "./telegram/streaming";
```

Replace sections 6-8 (lines 121-169) — the agent creation through reply sending. The `manager` must be created before `runAgent` so `finalize` can be called after. The existing `agentTraceProcessor.setContext/clearContext` wrapper around `tracer.span` must be preserved. Here is the complete replacement from `// 5. Create agent` through end of function:

```typescript
  // 5. Create agent and session
  const agent = createGastosAgent(env, userId, telegramId, timezone, currency);
  const session = new D1Session(env.DB, userId);

  // 6. Run the agent (streaming)
  let result;
  const manager = new StreamingReplyManager(env, telegramId);

  const runAgent = async () => {
    try {
      const stream = await run(agent, agentInput, { session, maxTurns: 10, stream: true });

      for await (const event of stream) {
        if (event.type === "run_item_stream_event" && event.name === "tool_called") {
          const rawItem = (event.item as any).rawItem;
          const toolName = rawItem?.name ?? "";
          await manager.sendDraft(getToolStatusText(toolName));
        }
        if (event.type === "raw_model_stream_event" && event.data.type === "output_text_delta") {
          if (!manager.started) {
            await manager.sendDraft("...");
          }
          await manager.appendText(event.data.delta);
        }
      }

      await stream.completed;
      return stream;
    } catch (err: unknown) {
      // Error resumption falls back to non-streaming run() — no double-complexity on retry
      if (err && typeof err === "object" && "state" in err && err.state) {
        try {
          return await run(agent, err.state as any);
        } catch {
          await sendTelegramChatMessage(env, telegramId, "Something went wrong, please try again.");
          return null;
        }
      } else {
        throw err;
      }
    }
  };

  // IMPORTANT: Preserve agentTraceProcessor context — this wraps the span so
  // ai.turn and ai.tool sub-spans from AgentTraceProcessor are attributed correctly
  agentTraceProcessor.setContext(traceId, userId, tracer);
  try {
    result = await tracer.span(traceId, "ai.semantic_chat", userId, runAgent, { model: "gpt-5-mini" });
  } finally {
    agentTraceProcessor.clearContext();
  }

  if (!result) return;

  // 7. Increment token quota from actual usage
  const totalTokens = result.rawResponses.reduce(
    (sum: number, r: any) => sum + (r.usage?.totalTokens ?? 0),
    0,
  );
  if (totalTokens > 0) {
    await tracer.span(traceId, "queue.token_increment", userId, async () => {
      await incrementTokenUsage(env.DB, userId, totalTokens);
    });
  }

  // 8. Finalize streaming reply (replaces old sendTelegramChatMessage step)
  const reply = result.finalOutput || "";
  await tracer.span(traceId, "telegram.send_reply", userId, async () => {
    await manager.finalize(reply);
  });

  // 9. Flush traces in background
  ctx.waitUntil(getGlobalTraceProvider().forceFlush());
```

**Note on `sendTelegramChatMessage` import:** Keep the existing import — it's still used for quota-exceeded messages (line 62) and the retry error fallback inside `runAgent`.

- [ ] **Step 5: Run tests and type check**

Run: `npm run check && npm run test`
Expected: All tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/queue.ts tests/queue.test.ts
git commit -m "feat: stream agent responses to Telegram via sendMessageDraft"
```

---

## Verification Checklist

After all tasks are complete:

- [ ] `npm run check` passes with zero type errors
- [ ] `npm run test` passes — all test files, all tests
- [ ] Manually verify `src/telegram/streaming.ts` exports `StreamingReplyManager` and `getToolStatusText`
- [ ] Manually verify `src/telegram/messages.ts` exports `sendMessageDraft`
- [ ] Manually verify `src/queue.ts` imports and uses streaming flow
- [ ] Verify error handling: retry path uses non-streaming `run()` (no double-complexity)
- [ ] Verify `agentTraceProcessor.setContext/clearContext` still wraps the `tracer.span`
