-- Traces table for observability spans
CREATE TABLE traces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id TEXT NOT NULL,
  span_name TEXT NOT NULL,
  user_id INTEGER,
  started_at_utc TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  error_message TEXT,
  metadata TEXT,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_traces_trace_id ON traces(trace_id);
CREATE INDEX idx_traces_user_id ON traces(user_id);
CREATE INDEX idx_traces_status_created ON traces(status, created_at_utc);
CREATE INDEX idx_traces_created_at ON traces(created_at_utc);
