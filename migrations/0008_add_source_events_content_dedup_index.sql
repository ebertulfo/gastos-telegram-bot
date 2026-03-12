-- Content-based dedup: index for findRecentDuplicateContent() query
-- Runs on every incoming text message to skip rapid retaps
CREATE INDEX IF NOT EXISTS idx_source_events_content_dedup
ON source_events (user_id, text_raw, created_at_utc);
