-- Migration 0010: Add teen_mode to user_settings
--
-- teen_mode = 0 → child view (orchard language, playful icons)
-- teen_mode = 1 → mature view (fintech language, minimal icons)
--
-- Set by a parent via the child settings panel.
-- Defaults to 0 (child view) for all existing and new rows.

ALTER TABLE user_settings ADD COLUMN teen_mode INTEGER NOT NULL DEFAULT 0;
