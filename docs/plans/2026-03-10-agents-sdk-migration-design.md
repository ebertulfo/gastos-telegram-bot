# Agents SDK Migration — Design Document

**Date:** 2026-03-10
**Status:** Approved

## Overview

Replace the manual OpenAI Chat Completions agent loop with the OpenAI Agents JS SDK (`@openai/agents` v0.6.0). This unifies intent classification, expense logging, financial querying, and conversational chat into a single agent.

## Architecture

### Before
```
webhook → classifyIntent() (gpt-4o-mini)
  ├→ "log"      → queue as "receipt" → extractForSourceEvent() → DB
  ├→ "question"  → queue as "chat"   → runSemanticChat() (gpt-4o, manual tool loop)
  └→ "unclear"   → send guidance message
```

### After
```
webhook → pre-process media → queue single message type → runAgent()
  └→ Agent (gpt-4.1-mini) decides intent, calls tools, responds
```

## Decisions

| Topic | Decision | Rationale |
|-------|----------|-----------|
| Session | D1-backed custom `Session` | Data stays local, builds on existing `chat_history` table, 10-message guard preserved |
| Intent classification | Deleted — agent handles intent | Simpler routing, one brain for everything |
| Media flow | Pre-processed before agent | Voice transcribed via Whisper, photos base64'd from R2, passed as agent input. Fewer round-trips than tool-based approach |
| Token quotas | SDK tracing hooks | `getGlobalTraceProvider()` captures token counts per run |
| Error handling | Retry once with state resumption | SDK errors include `.state` for resumption; one retry, then graceful failure message |
| Zod | Full upgrade to v4 | SDK hard-requires `zod ^4.0.0`; avoid dual-install complexity |
| Instructions | Dynamic function | `instructions: async (context) => buildSystemPrompt(context)` — fetches user context per-run |
| Agent model | `gpt-4.1-mini` | 84% cheaper than gpt-4o, designed for agentic tool-calling, $0.40/$1.60 per 1M tokens |
| Extraction/vision model | `gpt-4.1-nano` | 33% cheaper than gpt-4o-mini, 4x faster, sufficient for structured extraction |

## Agent Design

### Single Agent
```typescript
const agent = new Agent({
  name: 'gastos',
  model: 'gpt-4.1-mini',
  instructions: async (context) => buildSystemPrompt(context),
  tools: [logExpense, editExpense, deleteExpense, getFinancialReport],
})
```

### Tools
| Tool | Purpose |
|------|---------|
| `log_expense` | Log expense from text — wraps extraction + DB insert |
| `edit_expense` | Modify recent expense ("sorry, 6 not 7") |
| `delete_expense` | Remove mistaken expense |
| `get_financial_report` | Query spending by period with category breakdown |

Tools defined via closure factory pattern to inject `env`, `userId`, `timezone` without exposing them to the LLM.

### D1 Session
Implements SDK's `Session` interface against existing `chat_history` table:
- `getItems()` — last 10 messages as `AgentInputItem[]`
- `addItems()` — insert into `chat_history`
- `popItem()` — remove last message
- `updateItem()` — update message in place
- `clear()` — delete all history for user

New file: `src/ai/session.ts`

## Queue Changes

### Simplified `ParseQueueMessage`
```typescript
type ParseQueueMessage = {
  userId: number;
  telegramId: number;
  timezone: string;
  currency: string;
  tier: "free" | "premium";
  text?: string;           // text or voice transcript
  r2ObjectKey?: string;    // photo key in R2
  mediaType?: "photo" | "voice";
};
```

Single message type — no more `"receipt"` / `"chat"` discriminator.

### Queue Processing Flow
1. Pre-process media (voice → Whisper transcript, photo → base64 from R2)
2. Check token quota — short-circuit if exceeded
3. Build input: string for text, `AgentInputItem[]` for images
4. `run(agent, input, { session, maxTurns: 10 })`
5. Extract token usage from traces, increment quota
6. Send `result.finalOutput` to Telegram
7. `ctx.waitUntil(getGlobalTraceProvider().forceFlush())`

### Error Handling
```typescript
try {
  result = await run(agent, input, { session, maxTurns: 10 })
} catch (err) {
  if (err.state && retryCount === 0) {
    result = await run(agent, err.state)
  } else {
    sendTelegramChatMessage(env, chatId, "Something went wrong, please try again.")
    console.error("Agent run failed", err)
  }
}
```

## Files Changed

### New
- `src/ai/session.ts` — D1Session implementation

### Rewritten
- `src/ai/agent.ts` — Agent definition + `runAgent()` entry point
- `src/ai/tools.ts` — SDK `tool()` definitions with closure factory
- `src/queue.ts` — Unified queue processing

### Modified
- `src/routes/webhook.ts` — Remove `classifyIntent()`, simplify queue dispatch
- `src/types.ts` — Simplified `ParseQueueMessage`, new Env bindings if needed
- `package.json` — Add `@openai/agents`, upgrade `zod` to v4

### Deleted
- `classifyIntent()` function
- `runSemanticChat()` function
- `looksLikeLeakedToolCall()` function
- `handleReceiptMessage()` / `extractForSourceEvent()` — logic moves into agent tools
- `GetFinancialReportTool` schema object

### Unchanged
- `src/ai/openai.ts` — Extraction/embedding helpers (model strings updated to gpt-4.1-nano)
- `src/db/*` — All DB modules stay as-is
- `src/telegram/*` — Message sending stays
- `src/notifications.ts` — Independent system
- `src/totals.ts` — Period calculations stay
- `src/onboarding.ts` — /start flow stays

## Zod 4 Migration

- Bump `zod` from `^3.24.2` to `^4.0.0`
- Audit all schemas for breaking changes (error formatting, `z.input`/`z.output` types)
- `z.infer` unchanged — most schemas should work as-is
- Run full test suite after upgrade

## Model Updates

| Current | New | Used for |
|---------|-----|----------|
| `gpt-4o` | `gpt-4.1-mini` | Agent (chat + tools) |
| `gpt-4o-mini` | `gpt-4.1-nano` | Extraction, vision, notifications AI insight |

## CF Workers Notes

- No `process.env` — pass API key explicitly to SDK/client
- Trace flushing mandatory: `ctx.waitUntil(getGlobalTraceProvider().forceFlush())`
- Queue handler's 15min timeout is sufficient for agent runs
- `@openai/agents-extensions` NOT needed (only for realtime voice agents)
