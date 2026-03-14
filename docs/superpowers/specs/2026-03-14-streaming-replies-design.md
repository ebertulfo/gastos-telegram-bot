# Streaming Agent Replies to Telegram

**Date:** 2026-03-14
**Status:** Approved

## Problem

The agent's `run()` call takes 7-20 seconds (avg ~11s). During this time the user sees only a "typing..." indicator, then a wall of text appears all at once. This feels sluggish. We want to stream the response progressively so the user can read as the agent generates.

## Design

Uses Telegram's `sendMessageDraft` API (Bot API 9.3+) — designed specifically for streaming partial messages. Call it repeatedly with the same `draft_id` to update the text in place, then finalize with `sendMessage`.

### New File: `src/telegram/streaming.ts`

A `StreamingReplyManager` class that manages the lifecycle of a single streamed reply to one Telegram chat.

**Constructor:** `new StreamingReplyManager(env: Env, chatId: number)`

**State:**
- `draftId: number` — random integer generated in constructor, identifies this draft
- `buffer: string` — accumulated text from stream tokens
- `lastSentText: string` — text from the most recent draft update (for throttling dedup)
- `lastSendTime: number` — timestamp of the most recent API call (for throttling)
- `started: boolean` — whether a draft has been sent yet

**Methods:**

- `sendDraft(text: string): Promise<void>` — sends or updates the draft via `sendMessageDraft(chat_id, draft_id, text)`. Sets `started = true`. If called with same text as `lastSentText`, skips the API call.

- `appendText(delta: string): Promise<void>` — appends `delta` to the internal buffer. If at least 1 second has elapsed since the last API call and the buffer differs from `lastSentText`, calls `sendDraft(buffer)`. Deltas arriving between throttle windows accumulate in the buffer and are sent on the next throttle tick — no intermediate progress is lost.

- `finalize(text?: string): Promise<void>` — if no draft was ever sent (agent produced no output), sends the final text directly via `sendTelegramChatMessage`. Otherwise sends `sendTelegramChatMessage` with the final text (MarkdownV2 formatted), which converts the draft into a permanent message. If text is empty, uses fallback: "I couldn't process that. Please try again." If text exceeds 4096 characters, truncates to 4093 + "...".

**Error handling in draft calls:**
- HTTP 429 → log warning, skip this update (next throttle tick will catch up)
- Other errors → log but don't throw (never crash the stream loop)

### New function in `src/telegram/messages.ts`

**`sendMessageDraft`:** New function calling the Telegram `sendMessageDraft` API:

```typescript
async function sendMessageDraft(
  env: Env,
  chatId: number,
  draftId: number,
  text: string,
): Promise<void>
```

Calls `https://api.telegram.org/bot{token}/sendMessageDraft` with `{ chat_id, draft_id, text }`. No `parse_mode` during streaming — plain text only. Returns void (API returns `true`, not a Message object).

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
      await manager.sendDraft(statusText);
    }
    if (event.type === "raw_model_stream_event" && event.data.type === "output_text_delta") {
      if (!manager.started) {
        await manager.sendDraft("...");
      }
      await manager.appendText(event.data.delta);
    }
  }

  await stream.completed;
  const finalText = stream.finalOutput || "I couldn't process that. Please try again.";
  await manager.finalize(finalText);

  return stream;
};
```

**Tool status messages:** A `getToolStatusText` helper mapping tool names to user-friendly text:
- `log_expense` → "Logging your expense..."
- `edit_expense` → "Updating your expense..."
- `delete_expense` → "Deleting your expense..."
- `get_financial_report` → "Looking up your expenses..."
- Default → "Working on it..."

**Error resumption:** The current `err.state` retry logic falls back to non-streaming `run()` — no double-complexity on the retry path. On retry failure, sends error message directly (no streaming manager).

**Token counting:** After `stream.completed`, token usage is available via `stream.rawResponses` — same reduction logic as before.

**Tracing:** The `tracer.span("ai.semantic_chat", ...)` wraps the entire `runAgent()` closure, so the `ai.semantic_chat` span duration includes the full streaming time. `agentTraceProcessor` context stays active throughout the stream until `clearContext()` is called after the span completes. No per-delta tracing — that would be too noisy.

**Reply step removal:** The current `sendTelegramChatMessage` reply step (section 8 in processMessage) is removed — the streaming manager handles all message sending via `finalize()`.

### Constraints

- **Throttle:** 1 second between draft updates. `sendMessageDraft` is designed for streaming cadence, so 1s is safe.
- **No "message not modified" errors:** Unlike `editMessageText`, `sendMessageDraft` accepts identical content without erroring. We still skip identical-text calls to avoid unnecessary API traffic.
- **MarkdownV2 mid-stream:** Partial text with unmatched formatting markers causes parse errors. Draft updates use plain text (no `parse_mode`). MarkdownV2 applied only on the final `sendMessage` call in `finalize()`.
- **Workers execution window:** `await stream.completed` must resolve before the queue handler returns. The stream is fully consumed in the handler, not fire-and-forget.
- **Message length:** Telegram caps messages at 4096 characters. `finalize()` truncates if needed. In practice our agent responses are well under this limit.
- **Draft finalization:** The final `sendMessage` call converts the draft to a permanent message. If the handler crashes before `finalize()`, the draft disappears — no orphaned messages.

### Files Changed

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/telegram/streaming.ts` | StreamingReplyManager class + getToolStatusText helper |
| Modify | `src/telegram/messages.ts` | Add sendMessageDraft function |
| Modify | `src/queue.ts` | Switch to streaming run(), integrate StreamingReplyManager |
| Create | `tests/streaming.test.ts` | Unit tests for StreamingReplyManager |
| Modify | `tests/queue.test.ts` | Update for streaming flow |

### Expected UX Timeline

For a message that triggers `get_financial_report`:

```
User sends: "how much did I spend this month?"

0.0s  → "typing..." indicator (existing sendChatAction)
3.2s  → Draft appears: "Looking up your expenses..."        (tool_called)
3.6s  → Tool completes, Turn 1 starts generating
4.6s  → Draft updated: "This month you spent a total"       (first throttled update)
5.6s  → Draft updated: "This month you spent a total of SGD 308.62 across 17 expenses. Here's the breakdo"
6.6s  → Draft updated: "This month you spent a total of SGD 308.62 across 17 expenses. Here's the breakdown:..."
...
20.0s → Final message: full formatted response with MarkdownV2 (draft replaced)
```

vs. current: nothing for 20 seconds, then wall of text.
