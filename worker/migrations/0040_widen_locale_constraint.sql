-- Migration 0040: widen locale CHECK on user_settings to include en-GB and en-US.
-- SQLite does not support ALTER COLUMN, so we recreate the table.

CREATE TABLE user_settings_new (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  avatar_id  TEXT NOT NULL DEFAULT 'bottts:spark',
  theme      TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
  locale     TEXT NOT NULL DEFAULT 'en'     CHECK (locale IN ('en','en-GB','en-US','pl')),
  app_view   TEXT NOT NULL DEFAULT 'ORCHARD' CHECK (app_view IN ('ORCHARD','CLEAN')),
  updated_at INTEGER NOT NULL DEFAULT 0
);

INSERT INTO user_settings_new
SELECT user_id, avatar_id, theme,
       -- normalise legacy 'en' rows that are ambiguously English
       CASE locale WHEN 'en' THEN 'en' ELSE locale END,
       app_view, updated_at
FROM user_settings;

DROP TABLE user_settings;
ALTER TABLE user_settings_new RENAME TO user_settings;
