-- Feedback and bug reports from users
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
