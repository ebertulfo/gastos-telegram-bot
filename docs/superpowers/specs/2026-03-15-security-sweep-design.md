# Security Sweep — Softlaunch Hardening

**Date:** 2026-03-15
**Status:** Approved
**Approach:** B — Fix all critical, high, and medium findings before public launch

## Context

Gastos is preparing for public softlaunch. A comprehensive security audit identified 10 actionable vulnerabilities across authentication, authorization, input validation, and defense-in-depth. This spec covers all fixes needed to launch with a clean security posture.

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
- Add middleware on `/webhook/telegram` that validates `X-Telegram-Bot-Api-Secret-Token` header against `env.TELEGRAM_WEBHOOK_SECRET`
- Both strings must be encoded to `Uint8Array` via `TextEncoder` before comparison
- If byte lengths differ, short-circuit to `401` immediately (don't call `timingSafeEqual` — it throws on length mismatch)
- Use `crypto.subtle.timingSafeEqual()` only when byte lengths match, for constant-time comparison
- Return `401 Unauthorized` if the header is missing, wrong length, or doesn't match
- Re-register the webhook with Telegram's `setWebhook` API passing the `secret_token` parameter

```typescript
const encoder = new TextEncoder();
const incoming = encoder.encode(c.req.header("X-Telegram-Bot-Api-Secret-Token") ?? "");
const expected = encoder.encode(env.TELEGRAM_WEBHOOK_SECRET);
if (incoming.byteLength !== expected.byteLength) return c.json({}, 401);
if (!crypto.subtle.timingSafeEqual(incoming, expected)) return c.json({}, 401);
```

**Files:** `src/routes/webhook.ts`, `src/types.ts`, `.dev.vars`

### Fix 2: CORS Origin Restriction (HIGH)

**Problem:** CORS is configured with `origin: "*"` on `/api/*`. Any website can make cross-origin API requests using a user's Mini App authorization token.

**Design:**
- Add `ALLOWED_ORIGINS` env var (comma-separated list of allowed origins)
- Change `cors()` middleware in `src/app.ts` to use an origin function that checks against the allowlist
- In development mode, `http://localhost:5173` is automatically included
- Returns `null` (blocks request) for non-matching origins

**Note:** `ALLOWED_ORIGINS` is a non-secret config value (just domain names). It goes in `wrangler.toml` `[vars]` for production and `.dev.vars` for local dev. Unlike the other two new secrets, it does NOT need Cloudflare dashboard secrets.

**Files:** `src/app.ts`, `src/types.ts`, `.dev.vars`, `wrangler.toml`

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

**Problem:** `PUT /expenses/:id` only validates `currency` is a string. No allowlist validation against known currency codes.

**Design:**
- **Create** a `KNOWN_CURRENCIES` Set — it does not currently exist in the codebase. Export it from `src/onboarding.ts` by combining the existing `PRIORITY_CURRENCIES` and `ASEAN_CURRENCIES` arrays into a single exported Set
- Import `KNOWN_CURRENCIES` in `src/routes/api.ts`
- Add validation after the type check: reject if `currency.toUpperCase()` is not in the allowlist
- Return `400` with `"Unsupported currency code"` message

**Files:** `src/onboarding.ts`, `src/routes/api.ts`

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
- **Guard logic:** Both `APP_ENV === "development"` AND valid `DEBUG_SECRET` must be true. If `DEBUG_SECRET` is falsy/unset, deny unconditionally — treat unset secret as "debug disabled"
- Return `404` on failure (don't reveal debug endpoints exist)
- Add `DEBUG_SECRET` to `Env` type and `.dev.vars`

```typescript
app.use("/debug/*", async (c, next) => {
  if (c.env.APP_ENV !== "development") return c.json({ error: "Not found" }, 404);
  if (!c.env.DEBUG_SECRET || c.req.query("secret") !== c.env.DEBUG_SECRET) {
    return c.json({ error: "Not found" }, 404);
  }
  await next();
});
```

**Files:** `src/app.ts`, `src/types.ts`, `.dev.vars`

### Fix 9: initData Expiration Check (HIGH)

**Problem:** `validateTelegramInitData()` in `src/telegram/auth.ts` verifies the HMAC signature but never checks the `auth_date` field. A captured `initData` string is valid indefinitely, enabling replay attacks against all `/api/*` endpoints. For an app handling financial data, this is a significant gap.

**Design:**
- After signature validation succeeds, parse `auth_date` from the validated params
- Reject if `auth_date` is more than 86400 seconds (24 hours) old: `Date.now() / 1000 - parseInt(authDate) > 86400`
- Return `null` (same as signature failure) to trigger the existing `401` response in the API middleware

**Files:** `src/telegram/auth.ts`

### Fix 10: IDOR in DELETE Endpoint (MEDIUM)

**Problem:** `DELETE /expenses/:id` in `src/routes/api.ts:174` queries `SELECT source_event_id FROM expenses WHERE id = ?` without a `user_id` filter. An authenticated user can probe any expense ID and learn its `source_event_id`. While `deleteExpense()` itself is safe (includes `AND user_id = ?`), the pre-query leaks cross-user data and the subsequent Vectorize cleanup could delete another user's vector.

**Design:**
- Add `AND user_id = ?` to the `SELECT source_event_id` query, binding the authenticated user's ID
- This ensures both the lookup and the delete are scoped to the authenticated user

**Files:** `src/routes/api.ts`

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

- Unit tests for webhook secret validation (valid, missing, wrong secret, wrong length)
- Unit tests for API rate limiting (under limit, at limit, over limit)
- Unit tests for column whitelist (valid columns, invalid column throws)
- Unit tests for initData expiration (fresh auth_date passes, stale auth_date rejected)
- Unit tests for DELETE IDOR fix (ensure source_event_id query scoped to user)
- Existing test suite as regression guard for all other changes
- Manual verification: re-register webhook with secret_token, test Mini App CORS
