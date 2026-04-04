-- Migration 0009: Add school_days to chores frequency constraint
--
-- SQLite cannot modify a CHECK constraint in place (no ALTER COLUMN).
-- Standard approach: rename → recreate → copy → drop old.
--
-- New valid frequency values:
--   daily | weekly | bi_weekly | monthly | quarterly | as_needed | school_days
--
-- school_days = Mon–Fri recurring. Distinct from daily (7-day) so the
-- child's Weekly Grove planner can auto-plant only workdays.

PRAGMA foreign_keys = OFF;

-- Step 1: Recreate chores with the updated constraint
CREATE TABLE chores_new (
  id              TEXT    PRIMARY KEY,
  family_id       TEXT    NOT NULL REFERENCES families(id),
  assigned_to     TEXT    NOT NULL REFERENCES users(id),
  created_by      TEXT    NOT NULL REFERENCES users(id),
  title           TEXT    NOT NULL,
  description     TEXT,
  reward_amount   INTEGER NOT NULL CHECK (reward_amount > 0),
  currency        TEXT    NOT NULL CHECK (currency IN ('GBP','PLN')),
  frequency       TEXT    NOT NULL DEFAULT 'as_needed'
                          CHECK (frequency IN (
                            'daily','weekly','bi_weekly','monthly',
                            'quarterly','as_needed','school_days'
                          )),
  due_date        TEXT,
  is_priority     INTEGER NOT NULL DEFAULT 0,
  is_flash        INTEGER NOT NULL DEFAULT 0,
  flash_deadline  TEXT,
  archived        INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Step 2: Copy all existing rows
INSERT INTO chores_new SELECT * FROM chores;

-- Step 3: Swap
DROP TABLE chores;
ALTER TABLE chores_new RENAME TO chores;

-- Step 4: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_chores_family ON chores (family_id, archived, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chores_child  ON chores (assigned_to, archived);

PRAGMA foreign_keys = ON;
