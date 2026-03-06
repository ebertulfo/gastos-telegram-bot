# Gastos Telegram Bot

## Commands
- `npm run test` — run full test suite (vitest, 7 files, 21 tests)
- `npm run check` — TypeScript type check only (tsc --noEmit)
- `npm run dev` — local dev server (wrangler dev)
- `npm run deploy` — deploy to Cloudflare Workers

## Architecture
- Cloudflare Workers (Hono) + D1 + R2 + KV + Queues + Vectorize
- Webhook returns 200 immediately; all heavy AI work goes to INGEST_QUEUE
- Two queue message types: `"receipt"` (expense ingestion) and `"chat"` (semantic AI)
- `APP_ENV` is `"prod"` in wrangler.toml; use `"development"` locally via `.dev.vars`

## Code Patterns
- Hono middleware must be `async (c, next) => { await next(); }` — sync middleware returning `c.json()` causes a TS overload error
- `Env` type lives in `src/types.ts` — add new Cloudflare bindings/env vars there first
- All DB queries inject `user_id` from auth context — LLM tools must never accept userId from user input
- `response_format: { type: "json_object" }` used on all OpenAI extraction calls

## Testing
- Tests use `@cloudflare/vitest-pool-workers` — runs in a Miniflare Workers environment
- OpenAI, Vectorize, agent, and rate-limiter are mocked in tests — not integration tested
- Pure deletion/cleanup tasks don't need new tests; existing suite is sufficient as regression guard
