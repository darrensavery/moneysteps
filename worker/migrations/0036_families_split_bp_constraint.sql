-- Migration 0036: Add CHECK constraint to families.shared_expense_split_bp
--
-- SQLite does not support adding CHECK constraints to existing columns via
-- ALTER TABLE. We use the standard table-rebuild approach:
--   1. Disable foreign key enforcement
--   2. Rename existing table to _old
--   3. Recreate table with the constraint in place
--   4. Copy all data
--   5. Drop the old table
--   6. Re-enable foreign keys and verify integrity
--
-- Full column inventory (in insertion order across migrations 0001→0034):
--   id, name, currency, verify_mode, created_at       — 0001_initial_schema
--   base_currency, parenting_mode                      — 0007_invite_codes_and_currency
--   deleted_at                                         — 0020_parent_role_and_family_soft_delete
--   fast_track_enabled                                 — 0029_market_rates
--   shared_expense_threshold                           — 0034_shared_expense_settings
--   shared_expense_split_bp                            — 0034_shared_expense_settings (constraint added here)

PRAGMA foreign_keys = OFF;

-- Step 1: Rename existing table
ALTER TABLE families RENAME TO families_old;

-- Step 2: Recreate with all columns, adding the missing CHECK constraint
CREATE TABLE families (
  id                        TEXT    PRIMARY KEY,
  name                      TEXT    NOT NULL,
  currency                  TEXT    NOT NULL DEFAULT 'GBP'
                              CHECK (currency IN ('GBP', 'PLN', 'USD')),
  verify_mode               TEXT    NOT NULL DEFAULT 'standard'
                              CHECK (verify_mode IN ('amicable', 'standard')),
  created_at                INTEGER NOT NULL DEFAULT (unixepoch()),
  base_currency             TEXT    NOT NULL DEFAULT 'GBP'
                              CHECK (base_currency IN ('GBP', 'PLN', 'USD')),
  parenting_mode            TEXT    NOT NULL DEFAULT 'single'
                              CHECK (parenting_mode IN ('single', 'co-parenting')),
  deleted_at                INTEGER,
  fast_track_enabled        INTEGER NOT NULL DEFAULT 0,
  shared_expense_threshold  INTEGER NOT NULL DEFAULT 5000,
  shared_expense_split_bp   INTEGER NOT NULL DEFAULT 5000
                              CHECK (shared_expense_split_bp BETWEEN 0 AND 10000)
);

-- Step 3: Copy all data
INSERT INTO families (
  id,
  name,
  currency,
  verify_mode,
  created_at,
  base_currency,
  parenting_mode,
  deleted_at,
  fast_track_enabled,
  shared_expense_threshold,
  shared_expense_split_bp
)
SELECT
  id,
  name,
  currency,
  verify_mode,
  created_at,
  base_currency,
  parenting_mode,
  deleted_at,
  fast_track_enabled,
  shared_expense_threshold,
  shared_expense_split_bp
FROM families_old;

-- Step 4: Drop the old table
DROP TABLE families_old;

-- Step 5: Re-enable foreign keys
PRAGMA foreign_keys = ON;

-- Step 6: Verify referential integrity
PRAGMA foreign_key_check;
