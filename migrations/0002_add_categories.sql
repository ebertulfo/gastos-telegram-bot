-- Migration number: 0002 	 2026-02-27T12:00:00.000Z
-- Add category and tags for M7 Analytics and M9 RAG Prep

ALTER TABLE expenses ADD COLUMN category TEXT DEFAULT 'Other';

-- Tags is a JSON array string
ALTER TABLE expenses ADD COLUMN tags TEXT DEFAULT '[]';
