-- Add description column to expenses table (previously only in parse_results.parsed_json)
ALTER TABLE expenses ADD COLUMN description TEXT;

-- Backfill from parse_results
UPDATE expenses SET description = (
  SELECT JSON_EXTRACT(pr.parsed_json, '$.description')
  FROM parse_results pr
  JOIN source_events se ON pr.source_event_id = se.id
  WHERE se.id = expenses.source_event_id
);
