# Feedback & Bug Report Commands

## Problem

Users have no way to report bugs or give feedback from within the bot. When something goes wrong (e.g., silent failures, leaked reasoning, wrong categorization), we only discover issues by manually querying production data — as we did with user 152.

## Solution

Add `/feedback <text>` and `/bug <text>` commands. Both follow the same flow with a type label. Each submission is stored in D1 for queryable history and creates a GitHub Issue for actionable tracking.

## Command Flow

1. User sends `/feedback <text>` or `/bug <text>`
2. If no text provided, reply "Please include a message: `/feedback your message here`" and return
3. Insert record into `feedback` D1 table
4. Reply instantly: "Thanks for your feedback!" or "Thanks for reporting this bug!"
5. Background (`waitUntil`): create GitHub Issue via GitHub API

## D1 Schema

New `feedback` table:

```sql
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  telegram_chat_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('feedback', 'bug')),
  text TEXT NOT NULL,
  chat_context TEXT,          -- JSON: last 20 chat messages
  error_context TEXT,         -- JSON: recent error traces (bug only)
  github_issue_url TEXT,      -- backfilled after async creation
  created_at_utc TEXT NOT NULL
);

CREATE INDEX idx_feedback_user ON feedback(user_id);
CREATE INDEX idx_feedback_type ON feedback(type);
```

## Chat Context

Fetch last 20 messages from `chat_history` for the user. Serialize as JSON array:

```json
[
  {"role": "user", "content": "Add tada transport 17.22", "created_at_utc": "2026-03-18T04:08:23"},
  {"role": "assistant", "content": "Logged SGD 17.22 — tada transport (Transport)", "created_at_utc": "2026-03-18T04:08:30"}
]
```

## Error Context (bug reports only)

Fetch last 3 error trace spans for the user from the `traces` table:

```sql
SELECT trace_id, span_name, error_message, started_at_utc, duration_ms
FROM traces
WHERE user_id = ? AND status = 'error'
ORDER BY started_at_utc DESC
LIMIT 3
```

Serialize as JSON. If no errors found, set to `null`.

## GitHub Issue Creation

POST to `https://api.github.com/repos/{owner}/{repo}/issues` via `fetch()` inside `waitUntil`.

**Environment variables needed:**
- `GITHUB_TOKEN` — personal access token with `repo` scope
- `GITHUB_REPO` — e.g., `ebertulfo/gastos-telegram-bot`

**Issue format:**

```
Title: [type] User {telegram_chat_id}: {text truncated to 60 chars}

Labels: ["feedback"] or ["bug"]

Body:
## User Report
{full text}

## User Context
- Telegram Chat ID: {telegram_chat_id}
- Timezone: {timezone} | Currency: {currency} | Tier: {tier}
- Reported at: {created_at_utc}

## Recent Chat History
```
{formatted chat messages, role: content, one per line}
```

## Recent Errors
{formatted error traces or "No recent errors"}
```

**Error handling:** If GitHub API fails, log the error but don't retry or notify the user. The D1 record is the source of truth; the GitHub Issue is best-effort.

**Backfill:** After successful creation, UPDATE the feedback row with `github_issue_url`.

## File Changes

| File | Change |
|------|--------|
| `migrations/NNNN_add_feedback.sql` | New migration: feedback table |
| `src/db/feedback.ts` | New module: `insertFeedback()`, `updateGithubIssueUrl()` |
| `src/db/chat-history.ts` | Add `getRecentChatMessages(db, userId, limit)` returning raw rows |
| `src/onboarding.ts` | Add `/feedback` and `/bug` command handling |
| `src/github.ts` | New module: `createGithubIssue()` |
| `src/types.ts` | Add `GITHUB_TOKEN` and `GITHUB_REPO` to `Env` |
| `wrangler.toml` | Document new env vars (secrets via `wrangler secret put`) |

## User-Facing Messages

- `/feedback <text>` → "Thanks for your feedback!"
- `/bug <text>` → "Thanks for reporting this bug!"
- `/feedback` (no text) → "Please include a message: `/feedback your message here`"
- `/bug` (no text) → "Please include a message: `/bug describe what went wrong`"

## Out of Scope

- Media attachments (photos, voice) — can be reconstructed from source_events if needed
- Feedback status tracking — GitHub Issues handles this
- Admin dashboard — use wrangler D1 CLI and GitHub Issues UI
- Auto-categorization of feedback
- Rate limiting on feedback commands (low volume expected)
