---
name: gastos-debug
description: Debug Gastos bot issues using D1 traces and KV error index. Use when investigating user-reported problems, failed interactions, or slow performance.
---

# Gastos Debug Playbook

Debug issues using the observability traces in D1 and KV.

## Quick Triage: Recent Errors (KV)

Run this first to see what broke recently (last 7 days auto-expire):

```bash
npx wrangler kv key list --binding=TRACES_KV --prefix="error:"
```

To read a specific error:
```bash
npx wrangler kv key get --binding=TRACES_KV "error:<trace-id>:<span-name>"
```

## D1 Queries

### Recent failures (last 24h)
```bash
npx wrangler d1 execute gastos-db --command="SELECT trace_id, span_name, user_id, error_message, created_at_utc FROM traces WHERE status = 'error' AND created_at_utc > datetime('now', '-1 day') ORDER BY created_at_utc DESC;"
```

### Full trace timeline for a specific trace
```bash
npx wrangler d1 execute gastos-db --command="SELECT span_name, duration_ms, status, error_message, metadata FROM traces WHERE trace_id = '<TRACE_ID>' ORDER BY started_at_utc;"
```

### Average latency by step (last 7 days)
```bash
npx wrangler d1 execute gastos-db --command="SELECT span_name, ROUND(AVG(duration_ms)) as avg_ms, MAX(duration_ms) as max_ms, COUNT(*) as count FROM traces WHERE created_at_utc > datetime('now', '-7 days') GROUP BY span_name ORDER BY avg_ms DESC;"
```

### Error-prone users
```bash
npx wrangler d1 execute gastos-db --command="SELECT user_id, COUNT(*) as error_count FROM traces WHERE status = 'error' AND created_at_utc > datetime('now', '-7 days') GROUP BY user_id ORDER BY error_count DESC;"
```

### Slowest traces (last 24h)
```bash
npx wrangler d1 execute gastos-db --command="SELECT trace_id, SUM(duration_ms) as total_ms, GROUP_CONCAT(span_name, ' -> ') as flow FROM traces WHERE created_at_utc > datetime('now', '-1 day') GROUP BY trace_id ORDER BY total_ms DESC LIMIT 10;"
```

### Traces for a specific user
```bash
npx wrangler d1 execute gastos-db --command="SELECT trace_id, span_name, duration_ms, status, error_message, created_at_utc FROM traces WHERE user_id = <USER_ID> ORDER BY created_at_utc DESC LIMIT 20;"
```

## Specialist Dispatch

Based on error patterns, dispatch the relevant specialist agent for deeper research:
- Errors in `ai.*` spans → dispatch `openai-specialist`
- Errors in `queue.*` or `webhook.media_upload` spans → dispatch `cloudflare-specialist`
- Errors in `telegram.*` spans → dispatch `telegram-specialist`

## Debugging Workflow

1. **Start with KV** -- `kv key list` to see recent errors
2. **Get trace details** -- use the trace_id from KV to pull the full D1 timeline
3. **Check latency** -- run the avg latency query to spot systemic slowdowns
4. **Check error patterns** -- look for repeated span_names in errors (e.g., all errors on `ai.semantic_chat` suggests OpenAI issue)
5. **Check user patterns** -- if one user has many errors, check their specific traces

## Span Reference

| Span Name | Layer | What It Measures |
|-----------|-------|-----------------|
| `webhook.receive` | Webhook | Full webhook handler duration |
| `webhook.media_upload` | Webhook | R2 media upload |
| `queue.receipt` | Queue | Full queue message processing |
| `queue.media_fetch` | Queue | R2 media fetch for base64 conversion |
| `ai.transcribe` | AI | Voice transcription via Whisper |
| `ai.semantic_chat` | AI | Agent run (intent + extraction + chat) |
| `telegram.send_reply` | Telegram | Sending response to user |

## Schema Reference

Table: `traces`
- `trace_id` TEXT -- correlation ID (UUID), links webhook to queue to result
- `span_name` TEXT -- layer.operation format
- `user_id` INTEGER -- nullable (for system spans)
- `started_at_utc` TEXT -- ISO 8601 with ms precision
- `duration_ms` INTEGER
- `status` TEXT -- `ok` or `error`
- `error_message` TEXT -- null if ok
- `metadata` TEXT -- JSON string with span-specific context (model, tokens, r2Key, etc.)

KV namespace: `TRACES_KV`
- Key format: `error:{trace_id}:{span_name}`
- Value: JSON with `{traceId, spanName, userId, errorMessage, timestamp}`
- TTL: 7 days (auto-expires)
