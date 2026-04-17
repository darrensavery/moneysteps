-- Migration 0028: Learning Lab — chat history + curriculum unlock tables

CREATE TABLE chat_history (
  id          TEXT PRIMARY KEY,
  child_id    TEXT NOT NULL REFERENCES users(id),
  message     TEXT NOT NULL,
  reply       TEXT NOT NULL,
  pillar      TEXT NOT NULL CHECK (pillar IN ('LABOR_VALUE','DELAYED_GRATIFICATION','OPPORTUNITY_COST','CAPITAL_MANAGEMENT','SOCIAL_RESPONSIBILITY')),
  unlock_slug TEXT,
  app_view    TEXT NOT NULL CHECK (app_view IN ('ORCHARD', 'CLEAN')),
  locale      TEXT NOT NULL CHECK (locale IN ('en', 'en-US', 'pl')),
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_history_child ON chat_history(child_id, created_at DESC);

CREATE TABLE unlocked_modules (
  id           TEXT PRIMARY KEY,
  child_id     TEXT NOT NULL REFERENCES users(id),
  module_slug  TEXT NOT NULL,
  unlocked_at  INTEGER NOT NULL,
  UNIQUE (child_id, module_slug)
);
CREATE INDEX IF NOT EXISTS idx_unlocked_modules_child ON unlocked_modules(child_id);
