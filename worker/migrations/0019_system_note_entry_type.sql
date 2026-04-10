-- Migration 0019: Add 'system_note' entry_type; relax amount > 0 to amount >= 0;
-- make child_id nullable; add email_pending to users.
--
-- system_note rows represent non-financial audit events (e.g. profile changes).
-- They always have amount = 0 and child_id = NULL.
--
-- SQLite cannot ALTER a CHECK constraint or NOT NULL directly.
-- Standard approach: rename → recreate → copy → drop old.

PRAGMA foreign_keys = OFF;
PRAGMA legacy_alter_table = ON;

-- 1. Rebuild ledger with updated constraints
CREATE TABLE ledger_new (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id           TEXT    NOT NULL REFERENCES families(id),
  child_id            TEXT    REFERENCES users(id),            -- NULL for system_note rows
  chore_id            TEXT    REFERENCES chores(id),
  entry_type          TEXT    NOT NULL
                              CHECK (entry_type IN ('credit', 'reversal', 'payment', 'system_note')),
  amount              INTEGER NOT NULL CHECK (amount >= 0),    -- 0 for system_note rows
  currency            TEXT    NOT NULL CHECK (currency IN ('GBP', 'PLN')),
  description         TEXT    NOT NULL,
  receipt_id          TEXT,
  category            TEXT,
  verification_status TEXT    NOT NULL
                              CHECK (verification_status IN
                                ('pending','verified_auto','verified_manual','disputed','reversed')),
  authorised_by       TEXT    REFERENCES users(id),
  verified_at         INTEGER,
  verified_by         TEXT    REFERENCES users(id),
  dispute_code        TEXT,
  dispute_before      INTEGER,
  previous_hash       TEXT    NOT NULL,
  record_hash         TEXT    NOT NULL,
  ip_address          TEXT    NOT NULL,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO ledger_new SELECT
  id, family_id, child_id, chore_id, entry_type, amount, currency, description,
  receipt_id, category, verification_status, authorised_by,
  verified_at, verified_by, dispute_code, dispute_before,
  previous_hash, record_hash, ip_address, created_at
FROM ledger;

DROP TABLE ledger;
ALTER TABLE ledger_new RENAME TO ledger;

-- Recreate immutability trigger
CREATE TRIGGER IF NOT EXISTS ledger_no_delete
  BEFORE DELETE ON ledger
BEGIN
  SELECT RAISE(ABORT, 'Ledger rows cannot be deleted.');
END;

CREATE TRIGGER IF NOT EXISTS ledger_immutable_fields
  BEFORE UPDATE ON ledger
  WHEN NEW.amount        != OLD.amount
    OR NEW.currency      != OLD.currency
    OR NEW.entry_type    != OLD.entry_type
    OR NEW.record_hash   != OLD.record_hash
    OR NEW.previous_hash != OLD.previous_hash
    OR NEW.ip_address    != OLD.ip_address
    OR NEW.created_at    != OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'Immutable ledger fields cannot be changed after insert.');
END;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_ledger_family ON ledger (family_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_child  ON ledger (child_id,  created_at DESC);

-- 2. Add email_pending to users
ALTER TABLE users ADD COLUMN email_pending TEXT;

PRAGMA foreign_keys = ON;
