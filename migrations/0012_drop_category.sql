-- Migrate category values into tags arrays, then drop the category column.
-- All logic is in SQL so it runs atomically with wrangler migrations.

-- Case 1: Category exists, tags is empty — create single-element array
UPDATE expenses
SET tags = '["' || lower(category) || '"]'
WHERE category IS NOT NULL
  AND category != 'Other'
  AND (tags = '[]' OR tags IS NULL);

-- Case 2: Category exists, tags is non-empty — prepend if not already present
UPDATE expenses
SET tags = '["' || lower(category) || '",' || substr(tags, 2)
WHERE category IS NOT NULL
  AND category != 'Other'
  AND tags IS NOT NULL
  AND tags != '[]'
  AND instr(lower(tags), '"' || lower(category) || '"') = 0;

-- Now safe to drop
ALTER TABLE expenses DROP COLUMN category;
