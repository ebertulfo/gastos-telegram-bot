-- Initial schema based on tprd.md

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id INTEGER NOT NULL UNIQUE,
  telegram_chat_id INTEGER NOT NULL,
  timezone TEXT,
  currency TEXT,
  onboarding_step TEXT,
  created_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  telegram_chat_id INTEGER NOT NULL,
  telegram_message_id INTEGER NOT NULL,
  file_unique_id TEXT,
  message_type TEXT NOT NULL CHECK (message_type IN ('text', 'photo', 'voice')),
  text_raw TEXT,
  r2_object_key TEXT,
  received_at_utc TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_events_chat_message
ON source_events (telegram_chat_id, telegram_message_id);

CREATE TABLE IF NOT EXISTS parse_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_event_id INTEGER NOT NULL,
  parser_version TEXT NOT NULL,
  parsed_json TEXT NOT NULL,
  confidence REAL,
  needs_review INTEGER NOT NULL DEFAULT 0,
  created_at_utc TEXT NOT NULL,
  FOREIGN KEY (source_event_id) REFERENCES source_events(id)
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source_event_id INTEGER NOT NULL UNIQUE,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  occurred_at_utc TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('final', 'needs_review')),
  created_at_utc TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (source_event_id) REFERENCES source_events(id)
);

CREATE TABLE IF NOT EXISTS corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id INTEGER NOT NULL,
  field TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT,
  corrected_at_utc TEXT NOT NULL,
  FOREIGN KEY (expense_id) REFERENCES expenses(id)
);
