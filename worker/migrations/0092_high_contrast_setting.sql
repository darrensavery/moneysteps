-- 0092_high_contrast_setting.sql
-- Adds a per-user High Contrast accessibility preference (WCAG 2.1 AA).
-- Independent of `theme` (light/dark) — see docs/superpowers/specs/2026-08-06-high-contrast-mode-design.md
ALTER TABLE user_settings ADD COLUMN high_contrast INTEGER NOT NULL DEFAULT 0;
