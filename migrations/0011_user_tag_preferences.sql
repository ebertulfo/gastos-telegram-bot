-- User tag preferences (seeded during onboarding, used for tag suggestions)
CREATE TABLE user_tag_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  tag TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'onboarding',
  created_at_utc TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, tag)
);

CREATE INDEX idx_user_tag_prefs ON user_tag_preferences(user_id);
