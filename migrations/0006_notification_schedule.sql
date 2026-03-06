-- Add last-sent tracking columns for proactive notifications
ALTER TABLE users ADD COLUMN last_morning_sent_date TEXT;   -- YYYY-MM-DD (user's local date)
ALTER TABLE users ADD COLUMN last_evening_sent_date TEXT;   -- YYYY-MM-DD
ALTER TABLE users ADD COLUMN last_weekly_sent_date TEXT;    -- YYYY-WNN  (e.g. 2026-W10)
ALTER TABLE users ADD COLUMN last_monthly_sent_date TEXT;   -- YYYY-MM
ALTER TABLE users ADD COLUMN last_yearly_sent_date TEXT;    -- YYYY
