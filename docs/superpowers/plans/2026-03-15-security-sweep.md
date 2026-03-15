# Security Sweep Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 10 security vulnerabilities identified in the pre-softlaunch audit.

**Architecture:** Each fix is a self-contained task targeting specific files. Fixes are ordered by severity (critical first) and dependency (env var changes before code that uses them). All fixes share the same `Env` type update in Task 1.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers (KV, D1), Web Crypto API, Vitest

**Spec:** `docs/superpowers/specs/2026-03-15-security-sweep-design.md`

---

## Chunk 1: Environment & Critical Fixes

### Task 1: Add new env vars to Env type

**Files:**
- Modify: `src/types.ts:51-63`

- [ ] **Step 1: Add the three new env vars to the Env type**

```typescript
// In src/types.ts, add these three fields to the Env type:
TELEGRAM_WEBHOOK_SECRET: string;
ALLOWED_ORIGINS?: string;
DEBUG_SECRET?: string;
```

`TELEGRAM_WEBHOOK_SECRET` is required (webhook won't work without it). `ALLOWED_ORIGINS` and `DEBUG_SECRET` are optional (graceful fallback behavior when unset).

- [ ] **Step 2: Update the test helper createEnv in webhook.test.ts**

In `tests/webhook.test.ts`, add `TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret"` to the env object in `createEnv()` (line 91-99).

- [ ] **Step 3: Run type check**

Run: `npm run check`
Expected: PASS (or reveal other files that need the new field — fix them)

- [ ] **Step 4: Run tests**

Run: `npm run test`
Expected: All 142 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/webhook.test.ts
git commit -m "feat: add TELEGRAM_WEBHOOK_SECRET, ALLOWED_ORIGINS, DEBUG_SECRET to Env type"
```

---

### Task 2: Webhook signature validation (Fix 1 — CRITICAL)

**Files:**
- Modify: `src/app.ts:22`
- Create: `src/webhook-auth.ts`
- Modify: `tests/webhook.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/webhook.test.ts`:

```typescript
describe("webhook signature validation", () => {
  it("rejects requests without secret token header", async () => {
    const app = createApp();
    const { env } = createEnv();

    const response = await app.fetch(
      new Request("http://localhost/webhook/telegram", {
        method: "POST",
        body: buildTextUpdateBody(),
        headers: { "content-type": "application/json" }
      }),
      env
    );

    expect(response.status).toBe(401);
  });

  it("rejects requests with wrong secret token", async () => {
    const app = createApp();
    const { env } = createEnv();

    const response = await app.fetch(
      new Request("http://localhost/webhook/telegram", {
        method: "POST",
        body: buildTextUpdateBody(),
        headers: {
          "content-type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "wrong-secret"
        }
      }),
      env
    );

    expect(response.status).toBe(401);
  });

  it("accepts requests with correct secret token", async () => {
    vi.mocked(rateLimiter.checkRateLimit).mockResolvedValue(true);
    const app = createApp();
    const { env, send } = createEnv();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const response = await app.fetch(
      new Request("http://localhost/webhook/telegram", {
        method: "POST",
        body: buildTextUpdateBody(),
        headers: {
          "content-type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret"
        }
      }),
      env
    );

    expect(response.status).toBe(200);
    vi.mocked(globalThis.fetch).mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/webhook.test.ts`
Expected: The first two new tests PASS (no auth check yet, so 200 not 401 — actually they FAIL because they expect 401). The third passes. Good — first two are properly failing.

- [ ] **Step 3: Create `src/webhook-auth.ts` with the validation function**

```typescript
export function verifyWebhookSecret(
  incomingHeader: string | undefined,
  expectedSecret: string
): boolean {
  const encoder = new TextEncoder();
  const incoming = encoder.encode(incomingHeader ?? "");
  const expected = encoder.encode(expectedSecret);

  if (incoming.byteLength !== expected.byteLength) {
    return false;
  }

  return crypto.subtle.timingSafeEqual(incoming, expected);
}
```

- [ ] **Step 4: Add middleware in `src/app.ts` before the webhook route**

Insert before `app.post("/webhook/telegram", handleTelegramWebhook)` (line 22):

```typescript
import { verifyWebhookSecret } from "./webhook-auth";

// Webhook signature validation
app.use("/webhook/telegram", async (c, next) => {
  const secret = c.req.header("X-Telegram-Bot-Api-Secret-Token");
  if (!verifyWebhookSecret(secret, c.env.TELEGRAM_WEBHOOK_SECRET)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});
```

- [ ] **Step 5: Update existing webhook tests to include the secret header**

Add the `"X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret"` header to all 6 existing `new Request("http://localhost/webhook/telegram", ...)` calls in `tests/webhook.test.ts` (in the "queues text messages", "does not enqueue duplicates", "returns rate_limited on spam", "skips enqueueing content-duplicate messages", "queues photo messages with media upload", and "queues voice messages" tests). Without this header, all existing tests will get `401` after the middleware is added.

- [ ] **Step 6: Run tests**

Run: `npm run test -- tests/webhook.test.ts`
Expected: ALL tests pass (new + existing)

- [ ] **Step 7: Run full suite**

Run: `npm run check && npm run test`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add src/webhook-auth.ts src/app.ts tests/webhook.test.ts
git commit -m "feat: add webhook signature validation (security fix #1)"
```

---

### Task 3: initData expiration check (Fix 9 — HIGH)

**Files:**
- Modify: `src/telegram/auth.ts:44-48`
- Modify: `tests/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/auth.test.ts`:

```typescript
it("rejects expired auth_date (>24h old)", async () => {
  const botToken = "test_token";
  // auth_date from 48 hours ago
  const staleAuthDate = Math.floor(Date.now() / 1000) - 48 * 3600;

  // Compute valid hash for stale data
  const encoder = new TextEncoder();
  const botTokenKey = await crypto.subtle.importKey(
    "raw", encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const secretKeyBuffer = await crypto.subtle.sign("HMAC", botTokenKey, encoder.encode(botToken));
  const finalKey = await crypto.subtle.importKey(
    "raw", secretKeyBuffer,
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const dataCheckString = `auth_date=${staleAuthDate}\nquery_id=A\nuser=B`;
  const signatureBuffer = await crypto.subtle.sign("HMAC", finalKey, encoder.encode(dataCheckString));
  const hash = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0")).join("");

  const initData = `query_id=A&user=B&auth_date=${staleAuthDate}&hash=${hash}`;
  const result = await validateTelegramInitData(initData, botToken);
  expect(result).toBeNull();
});

it("accepts fresh auth_date (<24h old)", async () => {
  const botToken = "test_token";
  const freshAuthDate = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago

  const encoder = new TextEncoder();
  const botTokenKey = await crypto.subtle.importKey(
    "raw", encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const secretKeyBuffer = await crypto.subtle.sign("HMAC", botTokenKey, encoder.encode(botToken));
  const finalKey = await crypto.subtle.importKey(
    "raw", secretKeyBuffer,
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const dataCheckString = `auth_date=${freshAuthDate}\nquery_id=A\nuser=B`;
  const signatureBuffer = await crypto.subtle.sign("HMAC", finalKey, encoder.encode(dataCheckString));
  const hash = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0")).join("");

  const initData = `query_id=A&user=B&auth_date=${freshAuthDate}&hash=${hash}`;
  const result = await validateTelegramInitData(initData, botToken);
  expect(result).not.toBeNull();
});
```

- [ ] **Step 2: Run tests to verify the stale test fails**

Run: `npm run test -- tests/auth.test.ts`
Expected: "rejects expired auth_date" FAILS (currently no expiration check). "accepts fresh auth_date" PASSES.

- [ ] **Step 3: Update existing auth test to use fresh auth_date**

The existing test "validates correct signature using Web Crypto API" in `tests/auth.test.ts` uses `auth_date=1` (epoch timestamp 1 — year 1970). After adding the expiration check, this will be rejected as expired. Update it:
- Replace `const dataCheckString = "auth_date=1\nquery_id=A\nuser=B"` with a dynamic fresh timestamp: `const freshAuthDate = Math.floor(Date.now() / 1000) - 60;` and `const dataCheckString = \`auth_date=${freshAuthDate}\nquery_id=A\nuser=B\`;`
- Update the `initData` string to use `auth_date=${freshAuthDate}` instead of `auth_date=1`
- Update the assertion from `expect(result?.auth_date).toBe("1")` to `expect(result?.auth_date).toBe(String(freshAuthDate))`

- [ ] **Step 4: Add expiration check in `src/telegram/auth.ts`**

After the signature validation passes (line 44-46), before the `return` on line 48, add:

```typescript
// Check auth_date freshness — reject tokens older than 24 hours
const authDate = urlParams.get("auth_date");
if (!authDate || Date.now() / 1000 - parseInt(authDate, 10) > 86400) {
  return null;
}
```

- [ ] **Step 5: Run tests**

Run: `npm run test -- tests/auth.test.ts`
Expected: ALL pass (including the updated existing test)

- [ ] **Step 6: Run full suite**

Run: `npm run check && npm run test`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src/telegram/auth.ts tests/auth.test.ts
git commit -m "feat: add initData auth_date expiration check (security fix #9)"
```

---

### Task 4: CORS origin restriction (Fix 2 — HIGH)

**Files:**
- Modify: `src/app.ts:12-19`
- Modify: `wrangler.toml:34-37`

- [ ] **Step 1: Update CORS middleware in `src/app.ts`**

Replace lines 12-19:

```typescript
app.use(
  "/api/*",
  cors({
    origin: (origin, c) => {
      const allowed = c.env.ALLOWED_ORIGINS?.split(",").map((s: string) => s.trim()).filter(Boolean) ?? [];
      if (c.env.APP_ENV === "development") {
        allowed.push("http://localhost:5173", "http://localhost:4173");
      }
      return allowed.includes(origin) ? origin : null;
    },
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  })
);
```

Note: Hono's `cors()` `origin` can be a function that receives `(origin, c)`. Check the Hono docs — if the function signature is just `(origin)`, you'll need to access env via closure from a wrapping middleware instead. Verify during implementation.

- [ ] **Step 2: Add `ALLOWED_ORIGINS` to `wrangler.toml` [vars]**

```toml
ALLOWED_ORIGINS = ""
```

Leave empty for now — the production Mini App domain will be set after Pages deployment. The empty string means no origins allowed (secure default), plus dev mode auto-includes localhost.

- [ ] **Step 3: Run type check and tests**

Run: `npm run check && npm run test`
Expected: All pass. Existing tests use `APP_ENV: "test"` which won't auto-include localhost, but tests make direct requests (same-origin), so CORS middleware won't block them.

- [ ] **Step 4: Commit**

```bash
git add src/app.ts wrangler.toml
git commit -m "feat: restrict CORS to allowed origins (security fix #2)"
```

---

### Task 5: API rate limiting (Fix 3 — HIGH)

**Files:**
- Modify: `src/rate-limiter.ts`
- Modify: `src/routes/api.ts:17-57`

- [ ] **Step 1: Add `checkApiRateLimit` function in `src/rate-limiter.ts`**

```typescript
const MAX_API_REQUESTS_PER_HOUR = 100;

export async function checkApiRateLimit(env: Env, userId: number): Promise<boolean> {
  const now = new Date();
  const hourBucket = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}T${now.getUTCHours()}`;
  const key = `ratelimit:api:${userId}:${hourBucket}`;

  const currentCountStr = await env.RATE_LIMITER.get(key);
  const count = currentCountStr ? parseInt(currentCountStr, 10) : 0;

  if (count >= MAX_API_REQUESTS_PER_HOUR) {
    return false;
  }

  await env.RATE_LIMITER.put(key, (count + 1).toString(), { expirationTtl: 3600 });
  return true;
}
```

- [ ] **Step 2: Add rate limit middleware in `src/routes/api.ts` after auth middleware**

After the auth middleware `apiRouter.use("*", ...)` block (after line 57), add:

```typescript
import { checkApiRateLimit } from "../rate-limiter";

apiRouter.use("*", async (c, next) => {
  const allowed = await checkApiRateLimit(c.env, c.get("userId"));
  if (!allowed) {
    return c.json({ error: "Too many requests. Please try again later." }, 429);
  }
  await next();
});
```

- [ ] **Step 3: Update the rate-limiter mock in `tests/webhook.test.ts`**

The existing mock of `../src/rate-limiter` only mocks `checkRateLimit`. Update to also mock `checkApiRateLimit`:

```typescript
vi.mock("../src/rate-limiter", () => ({
  checkRateLimit: vi.fn(),
  checkApiRateLimit: vi.fn().mockResolvedValue(true)
}));
```

- [ ] **Step 4: Run type check and tests**

Run: `npm run check && npm run test`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/rate-limiter.ts src/routes/api.ts tests/webhook.test.ts
git commit -m "feat: add API rate limiting at 100 req/hour (security fix #3)"
```

---

## Chunk 2: Medium Severity Fixes

### Task 6: Security headers (Fix 4 — MEDIUM)

**Files:**
- Modify: `src/app.ts`
- Create: `webapp/public/_headers`

- [ ] **Step 1: Add security headers middleware in `src/app.ts`**

After the CORS middleware, before the routes, add:

```typescript
app.use("/api/*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
});
```

- [ ] **Step 2: Create `webapp/public/_headers` for Cloudflare Pages CSP**

```
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.workers.dev; img-src 'self' data:
```

- [ ] **Step 3: Run tests**

Run: `npm run check && npm run test`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/app.ts webapp/public/_headers
git commit -m "feat: add security headers and CSP (security fix #4)"
```

---

### Task 7: Column name whitelist in updateExpense (Fix 5 — MEDIUM)

**Files:**
- Modify: `src/db/expenses.ts:56-73`
- Modify: `tests/expenses.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/expenses.test.ts` in the `updateExpense` describe block:

```typescript
it("throws on invalid column names", async () => {
  const { db } = mockDb();
  await expect(
    updateExpense(db, 42, 7, { "malicious_column; DROP TABLE expenses": "oops" })
  ).rejects.toThrow("Invalid update column");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/expenses.test.ts`
Expected: FAIL — currently no validation, the query just runs

- [ ] **Step 3: Add whitelist in `src/db/expenses.ts`**

At the top of the file (after imports), add:

```typescript
const ALLOWED_UPDATE_COLUMNS = new Set([
  "amount_minor", "currency", "category", "tags", "occurred_at_utc", "status"
]);
```

At the top of `updateExpense()`, after `if (keys.length === 0) return;`, add:

```typescript
for (const key of keys) {
  if (!ALLOWED_UPDATE_COLUMNS.has(key)) {
    throw new Error(`Invalid update column: ${key}`);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test -- tests/expenses.test.ts`
Expected: ALL pass

- [ ] **Step 5: Commit**

```bash
git add src/db/expenses.ts tests/expenses.test.ts
git commit -m "feat: add column name whitelist to updateExpense (security fix #5)"
```

---

### Task 8: Currency validation in API (Fix 6 — MEDIUM)

**Files:**
- Modify: `src/onboarding.ts:6-7`
- Modify: `src/routes/api.ts:92-119`

- [ ] **Step 1: Export KNOWN_CURRENCIES from `src/onboarding.ts`**

Add after the existing `ASEAN_CURRENCIES` line (line 7):

```typescript
export const KNOWN_CURRENCIES = new Set([...PRIORITY_CURRENCIES, ...ASEAN_CURRENCIES]);
```

This combines both arrays into a single Set: `PHP, SGD, USD, EUR, BND, KHR, IDR, LAK, MYR, MMK, THB, VND`.

- [ ] **Step 2: Add validation in `src/routes/api.ts`**

In the PUT `/expenses/:id` handler, after the currency type check (line 108-109), add:

```typescript
import { KNOWN_CURRENCIES } from "../onboarding";

// Inside the PUT handler, after: if (currency !== undefined && typeof currency !== "string")
if (currency !== undefined && !KNOWN_CURRENCIES.has(currency.toUpperCase())) {
  return c.json({ error: "Unsupported currency code" }, 400);
}
```

- [ ] **Step 3: Run type check and tests**

Run: `npm run check && npm run test`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/onboarding.ts src/routes/api.ts
git commit -m "feat: validate currency against allowlist in API (security fix #6)"
```

---

### Task 9: Hono version upgrade (Fix 7 — MEDIUM)

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Upgrade Hono**

Run: `npm update hono`

- [ ] **Step 2: Run type check and tests**

Run: `npm run check && npm run test`
Expected: All pass. If any break, check Hono changelog for breaking changes.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: upgrade Hono to latest version (security fix #7)"
```

---

### Task 10: Debug endpoint secret (Fix 8 — MEDIUM)

**Files:**
- Modify: `src/app.ts:26-31`

- [ ] **Step 1: Update the debug guard in `src/app.ts`**

Replace lines 26-31:

```typescript
app.use("/debug/*", async (c, next) => {
  if (c.env.APP_ENV !== "development") {
    return c.json({ error: "Not found" }, 404);
  }
  if (!c.env.DEBUG_SECRET || c.req.query("secret") !== c.env.DEBUG_SECRET) {
    return c.json({ error: "Not found" }, 404);
  }
  await next();
});
```

- [ ] **Step 2: Update debug tests BEFORE running them**

In `tests/debug-traces.test.ts`, add `DEBUG_SECRET: "test-debug-secret"` to the test env object and append `?secret=test-debug-secret` to all debug endpoint request URLs. Without this, all debug tests will get `404` after Step 1.

- [ ] **Step 3: Run full suite**

Run: `npm run check && npm run test`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/app.ts tests/debug-traces.test.ts
git commit -m "feat: add DEBUG_SECRET as second factor for debug endpoints (security fix #8)"
```

---

### Task 11: IDOR fix in DELETE endpoint (Fix 10 — MEDIUM)

**Files:**
- Modify: `src/routes/api.ts:168-189`

- [ ] **Step 1: Fix the unscoped query in the DELETE handler**

In `src/routes/api.ts`, change line 174:

```typescript
// Before:
const expense = await c.env.DB.prepare(`SELECT source_event_id FROM expenses WHERE id = ?`).bind(expenseId).first<{ source_event_id: number }>();

// After:
const expense = await c.env.DB.prepare(`SELECT source_event_id FROM expenses WHERE id = ? AND user_id = ?`).bind(expenseId, c.get("userId")).first<{ source_event_id: number }>();
```

- [ ] **Step 2: Run tests**

Run: `npm run check && npm run test`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add src/routes/api.ts
git commit -m "fix: scope DELETE source_event_id lookup to authenticated user (security fix #10)"
```

---

## Chunk 3: Finalization

### Task 12: Full verification and manual checklist

- [ ] **Step 1: Run full type check and test suite**

Run: `npm run check && npm run test`
Expected: All pass

- [ ] **Step 2: Manual verification checklist**

Before deploying, these manual steps are needed (documented here, done by the human):

1. Set `TELEGRAM_WEBHOOK_SECRET` in Cloudflare dashboard (Workers > Settings > Variables)
2. Set `DEBUG_SECRET` in Cloudflare dashboard
3. Set `ALLOWED_ORIGINS` in `wrangler.toml` to the production Mini App domain
4. Re-register webhook with Telegram API:
   ```bash
   curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://gastos-telegram-bot.YOUR_SUBDOMAIN.workers.dev/webhook/telegram", "secret_token": "YOUR_WEBHOOK_SECRET"}'
   ```
5. Add `TELEGRAM_WEBHOOK_SECRET`, `DEBUG_SECRET` to `.dev.vars` for local development
6. Test Mini App CORS: verify requests from allowed origin succeed, others fail

- [ ] **Step 3: Commit any remaining changes**

Any test fixes or adjustments from the verification run.
