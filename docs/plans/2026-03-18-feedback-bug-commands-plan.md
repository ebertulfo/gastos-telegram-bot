# Feedback & Bug Report Commands — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users send `/feedback <text>` or `/bug <text>` to report issues, stored in D1 with chat context and surfaced as GitHub Issues.

**Architecture:** New D1 migration adds `feedback` table. New `src/db/feedback.ts` module handles inserts. New `src/github.ts` module creates GitHub Issues via REST API. Command handling added to existing `src/onboarding.ts`. Chat context fetched from existing `chat_history` table. GitHub Issue creation is fire-and-forget via `waitUntil`.

**Tech Stack:** Cloudflare Workers, D1, GitHub REST API, Vitest

**Spec:** `docs/specs/2026-03-18-feedback-bug-commands-design.md`

---

### File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `migrations/0009_add_feedback.sql` | Create | D1 migration: feedback table + indexes |
| `src/db/feedback.ts` | Create | `insertFeedback()`, `updateGithubIssueUrl()`, `getRecentErrorTraces()` |
| `src/db/chat-history.ts` | Modify | Add `getRecentChatMessages()` returning full rows with IDs |
| `src/github.ts` | Create | `createGithubIssue()` — POST to GitHub API |
| `src/onboarding.ts` | Modify | Add `/feedback` and `/bug` command branches |
| `src/types.ts` | Modify | Add `GITHUB_TOKEN` and `GITHUB_REPO` to `Env` |
| `tests/feedback.test.ts` | Create | Tests for feedback DB module |
| `tests/github.test.ts` | Create | Tests for GitHub issue creation |
| `tests/onboarding.test.ts` | Modify | Tests for `/feedback` and `/bug` commands |

---

### Task 1: D1 Migration

**Files:**
- Create: `migrations/0009_add_feedback.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- migrations/0009_add_feedback.sql
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  telegram_chat_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('feedback', 'bug')),
  text TEXT NOT NULL,
  chat_context TEXT,
  error_context TEXT,
  github_issue_url TEXT,
  created_at_utc TEXT NOT NULL
);

CREATE INDEX idx_feedback_user ON feedback(user_id);
CREATE INDEX idx_feedback_type ON feedback(type);
```

- [ ] **Step 2: Apply migration locally**

Run: `npx wrangler d1 migrations apply gastos-db --local`
Expected: Migration 0009 applied successfully

- [ ] **Step 3: Commit**

```bash
git add migrations/0009_add_feedback.sql
git commit -m "chore: add feedback table migration"
```

---

### Task 2: Feedback DB Module

**Files:**
- Create: `src/db/feedback.ts`
- Create: `tests/feedback.test.ts`

- [ ] **Step 1: Write failing tests for insertFeedback**

```typescript
// tests/feedback.test.ts
import { describe, it, expect, vi } from "vitest";
import { insertFeedback, updateGithubIssueUrl, getRecentErrorTraces } from "../src/db/feedback";

function mockDb() {
  return {
    prepare: vi.fn(),
  } as unknown as D1Database;
}

describe("feedback db module", () => {
  it("insertFeedback inserts row and returns id", async () => {
    const db = mockDb();
    const mockFirst = vi.fn().mockResolvedValue({ id: 7 });
    vi.mocked(db.prepare).mockReturnValue({
      bind: vi.fn().mockReturnValue({ first: mockFirst }),
    } as any);

    const id = await insertFeedback(db, {
      userId: 42,
      telegramChatId: 12345,
      type: "bug",
      text: "The bot ate my expense",
      chatContext: '[{"id":1,"role":"user","content":"test"}]',
      errorContext: null,
    });

    expect(id).toBe(7);
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO feedback"));
  });

  it("updateGithubIssueUrl updates the row", async () => {
    const db = mockDb();
    const mockRun = vi.fn().mockResolvedValue({});
    vi.mocked(db.prepare).mockReturnValue({
      bind: vi.fn().mockReturnValue({ run: mockRun }),
    } as any);

    await updateGithubIssueUrl(db, 7, "https://github.com/org/repo/issues/42");

    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE feedback"));
  });

  it("getRecentErrorTraces returns error spans for user", async () => {
    const db = mockDb();
    const mockAll = vi.fn().mockResolvedValue({
      results: [
        { trace_id: "abc", span_name: "ai.semantic_chat", error_message: "timeout", started_at_utc: "2026-03-18T04:00:00Z", duration_ms: 1000 },
      ],
    });
    vi.mocked(db.prepare).mockReturnValue({
      bind: vi.fn().mockReturnValue({ all: mockAll }),
    } as any);

    const traces = await getRecentErrorTraces(db, 42);

    expect(traces).toHaveLength(1);
    expect(traces[0].trace_id).toBe("abc");
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("status = 'error'"));
  });

  it("getRecentErrorTraces returns empty array when no errors", async () => {
    const db = mockDb();
    const mockAll = vi.fn().mockResolvedValue({ results: [] });
    vi.mocked(db.prepare).mockReturnValue({
      bind: vi.fn().mockReturnValue({ all: mockAll }),
    } as any);

    const traces = await getRecentErrorTraces(db, 42);
    expect(traces).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/feedback.test.ts`
Expected: FAIL — module `src/db/feedback` does not exist

- [ ] **Step 3: Implement the feedback DB module**

```typescript
// src/db/feedback.ts
type InsertFeedbackParams = {
  userId: number;
  telegramChatId: number;
  type: "feedback" | "bug";
  text: string;
  chatContext: string | null;
  errorContext: string | null;
};

type ErrorTrace = {
  trace_id: string;
  span_name: string;
  error_message: string | null;
  started_at_utc: string;
  duration_ms: number;
};

export async function insertFeedback(
  db: D1Database,
  params: InsertFeedbackParams,
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO feedback (user_id, telegram_chat_id, type, text, chat_context, error_context, created_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .bind(
      params.userId,
      params.telegramChatId,
      params.type,
      params.text,
      params.chatContext,
      params.errorContext,
      new Date().toISOString(),
    )
    .first<{ id: number }>();

  if (!result?.id) throw new Error("Failed to insert feedback");
  return result.id;
}

export async function updateGithubIssueUrl(
  db: D1Database,
  feedbackId: number,
  url: string,
): Promise<void> {
  await db
    .prepare(`UPDATE feedback SET github_issue_url = ? WHERE id = ?`)
    .bind(url, feedbackId)
    .run();
}

export async function getRecentErrorTraces(
  db: D1Database,
  userId: number,
  limit: number = 3,
): Promise<ErrorTrace[]> {
  const results = await db
    .prepare(
      `SELECT trace_id, span_name, error_message, started_at_utc, duration_ms
       FROM traces
       WHERE user_id = ? AND status = 'error'
       ORDER BY started_at_utc DESC
       LIMIT ?`,
    )
    .bind(userId, limit)
    .all<ErrorTrace>();

  return results.results ?? [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/feedback.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/db/feedback.ts tests/feedback.test.ts
git commit -m "feat: add feedback DB module with insert, update, and error trace queries"
```

---

### Task 3: Chat History — Add getRecentChatMessages

**Files:**
- Modify: `src/db/chat-history.ts`
- Existing test coverage in `tests/session.test.ts` covers chat-history indirectly; add a unit test here.

- [ ] **Step 1: Write failing test**

Add to existing test file or create a focused test. The function should return full rows (id, role, content, created_at_utc) ordered chronologically, unlike `getRecentChatHistory` which omits id and created_at_utc.

```typescript
// In tests/feedback.test.ts (append to the describe block)
import { getRecentChatMessages } from "../src/db/chat-history";

describe("getRecentChatMessages", () => {
  it("returns full chat rows with IDs ordered chronologically", async () => {
    const db = mockDb();
    const mockAll = vi.fn().mockResolvedValue({
      results: [
        { id: 100, role: "user", content: "hello", created_at_utc: "2026-03-18T04:00:00Z" },
        { id: 101, role: "assistant", content: "hi", created_at_utc: "2026-03-18T04:00:01Z" },
      ],
    });
    vi.mocked(db.prepare).mockReturnValue({
      bind: vi.fn().mockReturnValue({ all: mockAll }),
    } as any);

    const messages = await getRecentChatMessages(db, 42, 20);

    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe(100);
    expect(messages[1].id).toBe(101);
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("chat_history"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/feedback.test.ts`
Expected: FAIL — `getRecentChatMessages` is not exported

- [ ] **Step 3: Implement getRecentChatMessages**

Add to `src/db/chat-history.ts`:

```typescript
export type ChatMessageRow = {
  id: number;
  role: ChatRole;
  content: string;
  created_at_utc: string;
};

/**
 * Fetches the most recent N messages for a user with full row data (including IDs).
 * Used for feedback/bug context — returns chronological order.
 */
export async function getRecentChatMessages(
  db: D1Database,
  userId: number,
  limit: number = 20,
): Promise<ChatMessageRow[]> {
  const results = await db
    .prepare(
      `SELECT id, role, content, created_at_utc FROM (
         SELECT id, role, content, created_at_utc
         FROM chat_history
         WHERE user_id = ?
         ORDER BY created_at_utc DESC
         LIMIT ?
       ) ORDER BY created_at_utc ASC`,
    )
    .bind(userId, limit)
    .all<ChatMessageRow>();

  return results.results ?? [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/feedback.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/chat-history.ts tests/feedback.test.ts
git commit -m "feat: add getRecentChatMessages for feedback context"
```

---

### Task 4: GitHub Issue Creation Module

**Files:**
- Create: `src/github.ts`
- Create: `tests/github.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/github.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createGithubIssue } from "../src/github";

describe("createGithubIssue", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates issue and returns URL on success", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ html_url: "https://github.com/org/repo/issues/42" }), { status: 201 }),
    );

    const url = await createGithubIssue("test-token", "org/repo", {
      title: "[bug] User 12345: something broke",
      body: "## User Report\nSomething broke",
      labels: ["bug"],
    });

    expect(url).toBe("https://github.com/org/repo/issues/42");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/org/repo/issues",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
    fetchMock.mockRestore();
  });

  it("returns null on API failure", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );

    const url = await createGithubIssue("bad-token", "org/repo", {
      title: "test",
      body: "test",
      labels: [],
    });

    expect(url).toBeNull();
    fetchMock.mockRestore();
  });

  it("returns null on network error", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const url = await createGithubIssue("token", "org/repo", {
      title: "test",
      body: "test",
      labels: [],
    });

    expect(url).toBeNull();
    fetchMock.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/github.test.ts`
Expected: FAIL — module `src/github` does not exist

- [ ] **Step 3: Implement createGithubIssue**

```typescript
// src/github.ts
type IssueParams = {
  title: string;
  body: string;
  labels: string[];
};

/**
 * Creates a GitHub Issue via REST API. Returns the issue URL on success, null on failure.
 * Designed for fire-and-forget usage inside waitUntil — never throws.
 */
export async function createGithubIssue(
  token: string,
  repo: string,
  params: IssueParams,
): Promise<string | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "gastos-telegram-bot",
      },
      body: JSON.stringify({
        title: params.title,
        body: params.body,
        labels: params.labels,
      }),
    });

    if (!response.ok) {
      console.error("GitHub issue creation failed", { status: response.status, body: await response.text() });
      return null;
    }

    const data = (await response.json()) as { html_url?: string };
    return data.html_url ?? null;
  } catch (error) {
    console.error("GitHub issue creation error", { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/github.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/github.ts tests/github.test.ts
git commit -m "feat: add GitHub issue creation module"
```

---

### Task 5: Add Env Vars to Types and Wrangler

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add GITHUB_TOKEN and GITHUB_REPO to Env type**

In `src/types.ts`, add to the `Env` type:

```typescript
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
```

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "chore: add GITHUB_TOKEN and GITHUB_REPO to Env type"
```

Note: The actual secrets are set via `wrangler secret put GITHUB_TOKEN` and `GITHUB_REPO` is set as a `[vars]` entry in wrangler.toml at deploy time.

---

### Task 6: Wire Commands in Onboarding

**Files:**
- Modify: `src/onboarding.ts`
- Modify: `tests/onboarding.test.ts`

This is the integration task — wires together feedback DB, chat history, GitHub issue creation, and the command handler.

- [ ] **Step 1: Write failing tests for /feedback and /bug commands**

Add to `tests/onboarding.test.ts`:

```typescript
it("handles /feedback command and responds with confirmation", async () => {
  const app = createApp();
  const { env, send } = createOnboardingEnv({
    id: 1, telegram_user_id: 88, telegram_chat_id: 77,
    timezone: "Asia/Manila", currency: "PHP", onboarding_step: "completed",
  });
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );

  const response = await app.fetch(requestForText("/feedback the bot is great"), env);
  const json = (await response.json()) as { status: string };

  expect(response.status).toBe(200);
  expect(json.status).toBe("handled");
  expect(send).not.toHaveBeenCalled();
  // Should send a confirmation message via Telegram
  expect(fetchMock).toHaveBeenCalled();

  fetchMock.mockRestore();
});

it("handles /bug command and responds with confirmation", async () => {
  const app = createApp();
  const { env, send } = createOnboardingEnv({
    id: 1, telegram_user_id: 88, telegram_chat_id: 77,
    timezone: "Asia/Manila", currency: "PHP", onboarding_step: "completed",
  });
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );

  const response = await app.fetch(requestForText("/bug expenses disappear"), env);
  const json = (await response.json()) as { status: string };

  expect(response.status).toBe(200);
  expect(json.status).toBe("handled");
  expect(send).not.toHaveBeenCalled();

  fetchMock.mockRestore();
});

it("prompts for text when /feedback has no message", async () => {
  const app = createApp();
  const { env, send } = createOnboardingEnv({
    id: 1, telegram_user_id: 88, telegram_chat_id: 77,
    timezone: "Asia/Manila", currency: "PHP", onboarding_step: "completed",
  });
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );

  const response = await app.fetch(requestForText("/feedback"), env);
  const json = (await response.json()) as { status: string };

  expect(response.status).toBe(200);
  expect(json.status).toBe("handled");
  // Should prompt user to include a message
  const [, requestInit] = fetchMock.mock.calls[0];
  const body = JSON.parse(String(requestInit?.body ?? "{}")) as { text?: string };
  expect(body.text).toContain("/feedback your message here");

  fetchMock.mockRestore();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/onboarding.test.ts`
Expected: FAIL — `/feedback` and `/bug` commands not handled (status will be something other than "handled")

- [ ] **Step 3: Implement command handling in onboarding.ts**

Add these imports to `src/onboarding.ts`:

```typescript
import { insertFeedback, getRecentErrorTraces, updateGithubIssueUrl } from "./db/feedback";
import { getRecentChatMessages } from "./db/chat-history";
import { createGithubIssue } from "./github";
```

Add this block after the `parseTotalsPeriod` check (before the `if (!user || user.onboarding_step === "completed")` line):

```typescript
  // /feedback and /bug commands
  const feedbackMatch = text.match(/^\/(feedback|bug)\s*(.*)/s);
  if (feedbackMatch) {
    if (!user || user.onboarding_step !== "completed") {
      await sendTelegramChatMessage(env, chatId, "Set up first — send /start");
      return true;
    }

    const type = feedbackMatch[1] as "feedback" | "bug";
    const feedbackText = feedbackMatch[2].trim();

    if (!feedbackText) {
      const hint = type === "bug"
        ? "Please include a message: `/bug describe what went wrong`"
        : "Please include a message: `/feedback your message here`";
      await sendTelegramChatMessage(env, chatId, hint);
      return true;
    }

    // Gather context
    const chatMessages = await getRecentChatMessages(env.DB, user.id, 20);
    const chatContext = chatMessages.length > 0 ? JSON.stringify(chatMessages) : null;
    const errorTraces = type === "bug" ? await getRecentErrorTraces(env.DB, user.id) : [];
    const errorContext = errorTraces.length > 0 ? JSON.stringify(errorTraces) : null;

    // Insert to D1
    const feedbackId = await insertFeedback(env.DB, {
      userId: user.id,
      telegramChatId: chatId,
      type,
      text: feedbackText,
      chatContext,
      errorContext,
    });

    // Reply immediately
    const reply = type === "bug"
      ? "Thanks for reporting this bug!"
      : "Thanks for your feedback!";
    await sendTelegramChatMessage(env, chatId, reply);

    // Fire-and-forget GitHub Issue creation
    if (env.GITHUB_TOKEN && env.GITHUB_REPO) {
      const minId = chatMessages.length > 0 ? chatMessages[0].id : 0;
      const maxId = chatMessages.length > 0 ? chatMessages[chatMessages.length - 1].id : 0;

      const title = `[${type}] User ${chatId}: ${feedbackText.slice(0, 60)}`;
      const body = [
        `## User Report`,
        feedbackText,
        ``,
        `## User Context`,
        `- Telegram Chat ID: ${chatId}`,
        `- Timezone: ${user.timezone} | Currency: ${user.currency} | Tier: ${user.tier}`,
        `- Reported at: ${new Date().toISOString()}`,
        `- Feedback row ID: ${feedbackId}`,
        ``,
        `## Recent Chat History`,
        `${chatMessages.length} messages (IDs: ${minId}-${maxId})`,
        "```",
        `npx wrangler d1 execute gastos-db --remote --command "SELECT id, role, content, created_at_utc FROM chat_history WHERE user_id = ${user.id} ORDER BY created_at_utc DESC LIMIT 20"`,
        "```",
        ``,
        `## Recent Errors`,
        `${errorTraces.length} error traces found.`,
        "```",
        `npx wrangler d1 execute gastos-db --remote --command "SELECT trace_id, span_name, error_message, started_at_utc FROM traces WHERE user_id = ${user.id} AND status = 'error' ORDER BY started_at_utc DESC LIMIT 3"`,
        "```",
      ].join("\n");

      try {
        const ctx = (globalThis as any).__executionContext as ExecutionContext | undefined;
        const createIssue = async () => {
          const issueUrl = await createGithubIssue(env.GITHUB_TOKEN!, env.GITHUB_REPO!, {
            title,
            body,
            labels: [type],
          });
          if (issueUrl) {
            await updateGithubIssueUrl(env.DB, feedbackId, issueUrl);
          }
        };
        if (ctx) {
          ctx.waitUntil(createIssue());
        } else {
          // No execution context (tests) — run inline but don't block
          createIssue().catch(() => {});
        }
      } catch {
        // GitHub issue creation is best-effort
      }
    }

    return true;
  }
```

Note: The `waitUntil` handling depends on how the execution context is available in `onboarding.ts`. Looking at the existing code, `onboarding.ts` doesn't have direct access to `ExecutionContext`. The simplest approach is to pass `ctx` through from the webhook handler, OR use the Hono context's `executionCtx`. Check how `webhook.ts` line 114 accesses `c.executionCtx.waitUntil()`. The cleanest approach: add an optional `ctx?: ExecutionContext` parameter to `handleOnboardingOrCommand` and pass it from `webhook.ts`.

Update the function signature in `src/onboarding.ts`:

```typescript
export async function handleOnboardingOrCommand(env: Env, update: TelegramUpdate, ctx?: ExecutionContext): Promise<boolean> {
```

And the waitUntil becomes:

```typescript
if (ctx) {
  ctx.waitUntil(createIssue());
} else {
  createIssue().catch(() => {});
}
```

Update the call site in `src/routes/webhook.ts` (line ~76):

```typescript
return handleOnboardingOrCommand(c.env, update, c.executionCtx);
```

Wrap the `c.executionCtx` access in a try/catch since tests don't have it:

```typescript
let execCtx: ExecutionContext | undefined;
try { execCtx = c.executionCtx; } catch { /* tests */ }
return handleOnboardingOrCommand(c.env, update, execCtx);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/onboarding.test.ts`
Expected: PASS (7 tests — 4 existing + 3 new)

- [ ] **Step 5: Run full test suite**

Run: `npm run check && npm run test`
Expected: All tests pass, types clean

- [ ] **Step 6: Commit**

```bash
git add src/onboarding.ts src/routes/webhook.ts tests/onboarding.test.ts
git commit -m "feat: add /feedback and /bug commands with GitHub issue creation"
```

---

### Task 7: Set Secrets and Deploy

- [ ] **Step 1: Add GITHUB_REPO to wrangler.toml vars**

```toml
GITHUB_REPO = "ebertulfo/gastos-telegram-bot"
```

- [ ] **Step 2: Set GITHUB_TOKEN secret**

Run: `wrangler secret put GITHUB_TOKEN`
Enter: (paste personal access token with `repo` scope)

- [ ] **Step 3: Apply migration to prod**

Run: `npx wrangler d1 migrations apply gastos-db --remote`
Expected: Migration 0009 applied

- [ ] **Step 4: Deploy**

Run: `npm run deploy`

- [ ] **Step 5: Test in production**

Send `/feedback test feedback message` and `/bug test bug report` to the bot. Verify:
- Bot responds with confirmation
- D1 feedback table has rows (check via wrangler)
- GitHub Issues appear in the repo

- [ ] **Step 6: Commit wrangler.toml**

```bash
git add wrangler.toml
git commit -m "chore: add GITHUB_REPO to wrangler vars"
```
