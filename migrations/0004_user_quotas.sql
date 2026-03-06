-- Migration: 0004_user_quotas.sql
-- Description: Creates a table to track daily OpenAI token usage per user to enforce budgeting guardrails.

CREATE TABLE IF NOT EXISTS user_quotas (
    user_id INTEGER PRIMARY KEY,
    tokens_used_today INTEGER NOT NULL DEFAULT 0,
    last_usage_date_utc DATE NOT NULL DEFAULT CURRENT_DATE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
