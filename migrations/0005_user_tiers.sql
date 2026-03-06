-- 0005_user_tiers.sql
-- Add a tier column to support Free vs Premium user boundaries.
-- Safe migration: Default existing users to 'free'.

ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'free';
