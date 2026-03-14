# Streaming Agent Replies to Telegram

**Date:** 2026-03-14
**Status:** Approved

## Problem

The agent's `run()` call takes 7-20 seconds (avg ~11s). During this time the user sees only a "typing..." indicator, then a wall of text appears all at once. This feels sluggish. We want to stream the response progressively so the user can read as the agent generates.

## Design

### New File: `src/telegram/streaming.ts`

A `StreamingReplyManager` class that manages the lifecycle of a single streamed reply to one Telegram chat.

**Constructor:** `new StreamingReplyManager(env: Env, chatId: number)`

**State:**
- `messageId: number | null` — set after the first message is sent
- `buffer: string` — accumulated text from stream tokens
- `lastSentText: string` — text from the most recent edit (to avoid "not modified" errors)
- `lastEditTime: number` — timestamp of the most recent edit (for throttling)

**Methods:**

- `sendInitial(text: string): Promise<void>` — sends the first message via `sendTelegramChatMessage` (which now returns `message_id`), stores the message_id. If a message was already sent, this is a no-op.

- `appendText(delta: string): Promise<void>` — appends `delta` to the internal buffer. If at least 2 seconds have elapsed since the last edit and the buffer differs from `lastSentText`, calls `editTelegramMessageText` with `buffer + "▍"` (cursor). No `parse_mode` — plain text during streaming. Updates `lastSentText` and `lastEditTime`. Deltas arriving between throttle windows accumulate in the buffer and are sent on the next throttle tick — no intermediate progress is lost.

- `finalize(): Promise<void>` — if no message was ever sent (agent produced no output), does nothing. Otherwise calls `editTelegramMessageText` with the final buffer text, MarkdownV2 formatting via `escapeMarkdown`, no cursor. If buffer is empty, edits to fallback: "I couldn't process that. Please try again." If buffer exceeds 4096 characters, truncates to 4093 + "...".

**Error handling in edit calls:**
- HTTP 400 "message is not modified" → silently ignored
- HTTP 429 → log warning, skip this edit (next throttle tick will catch up)
- Other errors → log but don't throw (never crash the stream loop)

### Modified File: `src/telegram/messages.ts`

**`sendTelegramChatMessage`:** Change return type from `Promise<void>` to `Promise<number>`. Parse the response body to extract `result.message_id` and return it. Update type:

```typescript
type TelegramSendMessageResponse = {
  ok: boolean;
  result?: { message_id: number };
};
```

Existing callers that ignore the return value need no changes.

**`editTelegramMessageText`:** Add resilience for streaming use. Catch HTTP 400 with "message is not modified" and return silently instead of throwing. This avoids callers needing to handle this common streaming edge case.

### Modified File: `src/queue.ts`

Replace the current `run()` + `sendMessage` flow with streaming:

**Current flow (lines ~124-167):**
```
const runAgent = async () => run(agent, input, { session, maxTurns: 10 });
result = await tracer.span(traceId, "ai.semantic_chat", userId, runAgent);
const reply = result.finalOutput;
await sendTelegramChatMessage(env, telegramId, reply);
```

**New flow:**
```typescript
const manager = new StreamingReplyManager(env, telegramId);

const runAgent = async () => {
  const stream = await run(agent, agentInput, { session, maxTurns: 10, stream: true });

  for await (const event of stream) {
    if (event.type === "run_item_stream_event" && event.name === "tool_called") {
      const statusText = getToolStatusText(event.item.rawItem.name);
      await manager.sendInitial(statusText);
    }
    if (event.type === "raw_model_stream_event" && event.data.type === "output_text_delta") {
      if (!manager.messageId) {
        await manager.sendInitial("...");
      }
      await manager.appendText(event.data.delta);
    }
  }

  await stream.completed;
  await manager.finalize();

  return stream;
};
```

**Tool status messages:** A simple map from tool name to user-friendly text:
- `log_expense` → "Logging your expense..."
- `edit_expense` → "Updating your expense..."
- `delete_expense` → "Deleting your expense..."
- `get_financial_report` → "Looking up your expenses..."
- Default → "Working on it..."

**Error resumption:** The current `err.state` retry logic falls back to non-streaming `run()` — no double-complexity on the retry path. On retry failure, sends error message directly (no streaming manager).

**Token counting:** After `stream.completed`, token usage is available via `stream.rawResponses` — same reduction logic as before.

**Tracing:** The `tracer.span("ai.semantic_chat", ...)` wraps the entire `runAgent()` closure, so the `ai.semantic_chat` span duration includes the full streaming time. `agentTraceProcessor` context stays active throughout the stream until `clearContext()` is called after the span completes. No per-delta tracing — that would be too noisy.

**Reply step removal:** The current `sendTelegramChatMessage` reply step (section 8 in processMessage) is removed — the streaming manager handles all message sending.

### Constraints

- **Telegram edit throttle:** 2 seconds between edits (safe floor). Faster edits risk 429 responses.
- **Telegram identical content:** Editing with unchanged text returns HTTP 400. The manager tracks `lastSentText` to avoid this.
- **MarkdownV2 mid-stream:** Partial text with unmatched formatting markers causes Telegram parse errors. Stream edits use plain text (no `parse_mode`). MarkdownV2 applied only on the final `finalize()` edit.
- **Workers execution window:** `await stream.completed` must resolve before the queue handler returns. The stream is fully consumed in the handler, not fire-and-forget.
- **Message length:** Telegram caps messages at 4096 characters. If the buffer exceeds this, `finalize()` truncates to 4096. In practice our agent responses are well under this limit.

### Files Changed

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/telegram/streaming.ts` | StreamingReplyManager class |
| Modify | `src/telegram/messages.ts` | Return message_id from sendMessage, resilient editMessage |
| Modify | `src/queue.ts` | Switch to streaming run(), integrate StreamingReplyManager |
| Create | `tests/streaming.test.ts` | Unit tests for StreamingReplyManager |
| Modify | `tests/queue.test.ts` | Update for streaming flow |

### Expected UX Timeline

For a message that triggers `get_financial_report`:

```
User sends: "how much did I spend this month?"

0.0s  → "typing..." indicator (existing sendChatAction)
3.2s  → Message appears: "Looking up your expenses..."     (tool_called)
3.6s  → Tool completes, Turn 1 starts generating
5.6s  → Message edited: "This month you spent a total▍"    (first throttled edit)
7.6s  → Message edited: "This month you spent a total of SGD 308.62 across 17 expenses. Here's the breakdo▍"
9.6s  → Message edited: "This month you spent a total of SGD 308.62 across 17 expenses. Here's the breakdown:..."▍"
...
20.0s → Final edit: full formatted response with MarkdownV2, no cursor
```

vs. current: nothing for 20 seconds, then wall of text.
