# Security Sweep — Softlaunch Hardening

**Date:** 2026-03-15
**Status:** Approved
**Approach:** B — Fix all critical, high, and medium findings before public launch

## Context

Gastos is preparing for public softlaunch. A comprehensive security audit identified 8 actionable vulnerabilities across authentication, authorization, input validation, and defense-in-depth. This spec covers all fixes needed to launch with a clean security posture.

The app handles financial data (expense tracking) and will be open to any Telegram user, making security a non-negotiable prerequisite.

## Threat Model

- **Attacker profile:** Internet-facing bot, any Telegram user or web visitor
- **Assets:** User expense data, Telegram user IDs, OpenAI API quota
- **Trust boundaries:** Telegram webhook, Mini App API, queue messages, debug endpoints

## Findings & Fixes

### Fix 1: Webhook Signature Validation (CRITICAL)

**Problem:** `POST /webhook/telegram` accepts any HTTP request without verifying it originated from Telegram. An attacker who discovers the webhook URL can forge messages as any user, trigger AI processing, and enumerate user IDs.

**Design:**
- Add `TELEGRAM_WEBHOOK_SECRET` env var (new secret in `.dev.vars` and Cloudflare dashboard)
- Add middleware on `/webhook/telegram` that validates `X-Telegram-Bot-Api-Secret-Token` header against `env.TELEGRAM_WEBHOOK_SECRET` using `crypto.subtle.timingSafeEqual()` for constant-time comparison
- Return `401 Unauthorized` if the header is missing or doesn't match
- Re-register the webhook with Telegram's `setWebhook` API passing the `secret_token` parameter

**Files:** `src/routes/webhook.ts`, `src/types.ts`, `.dev.vars`

### Fix 2: CORS Origin Restriction (HIGH)

**Problem:** CORS is configured with `origin: "*"` on `/api/*`. Any website can make cross-origin API requests using a user's Mini App authorization token.

**Design:**
- Add `ALLOWED_ORIGINS` env var (comma-separated list of allowed origins)
- Change `cors()` middleware in `src/app.ts` to use an origin function that checks against the allowlist
- In development mode, `http://localhost:5173` is automatically included
- Returns `null` (blocks request) for non-matching origins

**Files:** `src/app.ts`, `src/types.ts`, `.dev.vars`

### Fix 3: API Rate Limiting (HIGH)

**Problem:** Rate limiting only covers the webhook endpoint. Mini App API endpoints (`PUT /expenses/:id`, `DELETE /expenses/:id`) have no rate limiting — an authenticated user could fire unlimited requests.

**Design:**
- Create reusable API rate limit middleware in `src/rate-limiter.ts`
- Apply to `/api/*` routes after auth middleware (needs `userId`)
- Limit: 100 requests/hour per user (vs 20/hr for webhook — API ops are cheaper than AI processing)
- Same KV bucket pattern, different prefix: `ratelimit:api:{userId}:{hourBucket}`
- Returns `429` with descriptive message when exceeded

**Files:** `src/rate-limiter.ts`, `src/routes/api.ts`, `src/types.ts`

### Fix 4: Security Headers & CSP (MEDIUM)

**Problem:** No security headers on API responses. No CSP on the Mini App. Missing defense-in-depth against XSS and clickjacking.

**Design:**
- Add security headers middleware on `/api/*` in `src/app.ts`:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
- Add `webapp/public/_headers` file for Cloudflare Pages with CSP:
  - `default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.workers.dev; img-src 'self' data:`
  - Allows Telegram SDK script injection, inline styles (Tailwind), and API connections to Workers

**Files:** `src/app.ts`, `webapp/public/_headers`

### Fix 5: Column Name Whitelist in updateExpense() (MEDIUM)

**Problem:** `updateExpense()` interpolates `Object.keys(updates)` as SQL column names. While current callers pass safe keys, any future caller passing user-controlled keys would create SQL injection.

**Design:**
- Add `ALLOWED_UPDATE_COLUMNS` set in `src/db/expenses.ts`:
  ```
  ["amount_minor", "currency", "category", "tags", "occurred_at_utc", "status"]
  ```
- Filter and throw on invalid keys at the top of `updateExpense()`
- No caller changes needed

**Files:** `src/db/expenses.ts`

### Fix 6: Currency Validation in API (MEDIUM)

**Problem:** `PUT /expenses/:id` only validates `currency` is a string. Doesn't check against the `KNOWN_CURRENCIES` allowlist used elsewhere.

**Design:**
- Import and reuse the existing `KNOWN_CURRENCIES` set
- Add validation after the type check: reject if currency is not in the allowlist
- Return `400` with `"Unsupported currency code"` message

**Files:** `src/routes/api.ts`

### Fix 7: Hono Version Upgrade (MEDIUM)

**Problem:** Current Hono version has multiple known CVEs (cookie injection, SSE injection, serveStatic path traversal, prototype pollution). Although the vulnerable features aren't used, upgrading is cheap insurance.

**Design:**
- Run `npm update hono`
- Verify with `npm run check && npm run test`
- No code changes expected

**Files:** `package.json`, `package-lock.json`

### Fix 8: Debug Endpoint Secret (MEDIUM)

**Problem:** Debug endpoints are gated only by `APP_ENV !== "development"`. A misconfigured environment variable would expose raw expense data, chat history, and traces to the public.

**Design:**
- Add `DEBUG_SECRET` env var as a second factor
- Debug endpoints require `?secret=<DEBUG_SECRET>` query parameter even in development mode
- If either check fails, return `404` (don't reveal debug endpoints exist)
- Add `DEBUG_SECRET` to `Env` type and `.dev.vars`

**Files:** `src/app.ts`, `src/types.ts`, `.dev.vars`

## New Environment Variables

| Variable | Purpose | Where to Set |
|----------|---------|--------------|
| `TELEGRAM_WEBHOOK_SECRET` | Webhook signature validation | `.dev.vars` + Cloudflare dashboard secrets |
| `ALLOWED_ORIGINS` | CORS origin allowlist | `.dev.vars` + `wrangler.toml` [vars] |
| `DEBUG_SECRET` | Debug endpoint second factor | `.dev.vars` + Cloudflare dashboard secrets |

## Out of Scope

- **API call timeouts:** Workers runtime enforces ~30s timeout. Adding explicit `AbortController` timeouts is marginal value for this launch.
- **Text input size limits:** Telegram enforces message size limits. Adding server-side limits is defense-in-depth but low priority.
- **Full penetration testing:** Covered by Approach C, deferred to post-launch.
- **HSTS/X-Frame-Options on Pages:** Cloudflare Pages handles this at the CDN level.

## Testing Strategy

- Unit tests for webhook secret validation (valid, missing, wrong secret)
- Unit tests for API rate limiting (under limit, at limit, over limit)
- Unit tests for column whitelist (valid columns, invalid column throws)
- Existing test suite as regression guard for all other changes
- Manual verification: re-register webhook with secret_token, test Mini App CORS
