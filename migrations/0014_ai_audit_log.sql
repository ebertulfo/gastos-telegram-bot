-- AI audit log: captures LLM calls for debugging agent behavior
CREATE TABLE ai_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  messages_sent TEXT,
  response_received TEXT,
  tool_calls TEXT,
  total_tokens INTEGER DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  anomaly_flags TEXT,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_audit_trace_id ON ai_audit_log(trace_id);
CREATE INDEX idx_audit_user_id ON ai_audit_log(user_id);
CREATE INDEX idx_audit_anomalies ON ai_audit_log(anomaly_flags)
  WHERE anomaly_flags IS NOT NULL;
CREATE INDEX idx_audit_created_at ON ai_audit_log(created_at_utc);
