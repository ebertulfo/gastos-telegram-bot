-- Migration: 0003_chat_history.sql
-- Description: Creates a table to store short-term conversational memory for the M10 Agentic Chat feature.
-- This table is designed to hold only recent messages to prevent LLM context window explosion.

CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at_utc DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Index the user_id and created_at_utc columns to quickly fetch the last N messages for context truncation
CREATE INDEX IF NOT EXISTS idx_chat_history_user_time ON chat_history (user_id, created_at_utc DESC);
