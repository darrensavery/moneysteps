-- Migration 0027: Global Foundations — USD currency + en-US locale
-- Expands CHECK constraints on currency columns to include 'USD'.
-- Expands users.locale to include 'en-US'.
-- SQLite does not support ALTER COLUMN; we recreate affected tables.

-- ─────────────────────────────────────────────────────────────────
-- 1. users.locale  (en → en | en-US | pl)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE users_new (
  id                   TEXT PRIMARY KEY,
  family_id            TEXT REFERENCES families(id),
  display_name         TEXT NOT NULL,
  email                TEXT UNIQUE,
  locale               TEXT NOT NULL DEFAULT 'en'
                         CHECK (locale IN ('en', 'en-US', 'pl')),
  password_hash        TEXT,
  pin_hash             TEXT,
  email_verified       INTEGER NOT NULL DEFAULT 0,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  firebase_uid         TEXT DEFAULT NULL,
  allowance_amount     INTEGER NOT NULL DEFAULT 0,
  allowance_day        INTEGER NOT NULL DEFAULT 6 CHECK (allowance_day BETWEEN 0 AND 6),
  earnings_mode        TEXT NOT NULL DEFAULT 'HYBRID'
                         CHECK (earnings_mode IN ('ALLOWANCE','CHORES','HYBRID')),
  allowance_frequency  TEXT NOT NULL DEFAULT 'WEEKLY'
                         CHECK (allowance_frequency IN ('WEEKLY','BI_WEEKLY','MONTHLY')),
  teen_mode            INTEGER NOT NULL DEFAULT 0,
  email_pending        TEXT,
  parent_pin_hash      TEXT,
  pin_attempt_count    INTEGER NOT NULL DEFAULT 0,
  pin_locked_until     INTEGER,
  google_sub           TEXT,
  google_picture       TEXT
);
INSERT INTO users_new (
  id, family_id, display_name, email, locale,
  password_hash, pin_hash, email_verified, created_at, firebase_uid,
  allowance_amount, allowance_day, earnings_mode, allowance_frequency,
  teen_mode, email_pending, parent_pin_hash, pin_attempt_count,
  pin_locked_until, google_sub, google_picture
)
SELECT
  id, family_id, display_name, email, locale,
  password_hash, pin_hash, email_verified, created_at, firebase_uid,
  allowance_amount, allowance_day, earnings_mode, allowance_frequency,
  teen_mode, email_pending, parent_pin_hash, pin_attempt_count,
  pin_locked_until, google_sub, google_picture
FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────
-- 2. chores.currency  (GBP|PLN → GBP|PLN|USD)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE chores_new (
  id              TEXT PRIMARY KEY,
  family_id       TEXT NOT NULL REFERENCES families(id),
  assigned_to     TEXT NOT NULL REFERENCES users(id),
  created_by      TEXT NOT NULL REFERENCES users(id),
  title           TEXT NOT NULL,
  description     TEXT,
  reward_amount   INTEGER NOT NULL CHECK (reward_amount > 0),
  currency        TEXT NOT NULL DEFAULT 'GBP'
                    CHECK (currency IN ('GBP','PLN','USD')),
  frequency       TEXT NOT NULL DEFAULT 'weekly'
                    CHECK (frequency IN ('daily','weekly','bi_weekly','monthly','quarterly','as_needed','school_days')),
  due_date        TEXT,
  is_priority     INTEGER NOT NULL DEFAULT 0,
  is_flash        INTEGER NOT NULL DEFAULT 0,
  flash_deadline  TEXT,
  archived        INTEGER NOT NULL DEFAULT 0,
  proof_required  INTEGER NOT NULL DEFAULT 0,
  auto_approve    INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO chores_new SELECT * FROM chores;
DROP TABLE chores;
ALTER TABLE chores_new RENAME TO chores;

-- ─────────────────────────────────────────────────────────────────
-- 3. goals.currency  (GBP|PLN → GBP|PLN|USD)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE goals_new (
  id                       TEXT PRIMARY KEY,
  family_id                TEXT NOT NULL REFERENCES families(id),
  child_id                 TEXT NOT NULL REFERENCES users(id),
  title                    TEXT NOT NULL,
  target_amount            INTEGER NOT NULL CHECK (target_amount > 0),
  currency                 TEXT NOT NULL DEFAULT 'GBP'
                             CHECK (currency IN ('GBP','PLN','USD')),
  category                 TEXT NOT NULL DEFAULT 'other',
  deadline                 TEXT,
  alloc_pct                INTEGER NOT NULL DEFAULT 0 CHECK (alloc_pct BETWEEN 0 AND 100),
  match_rate               INTEGER NOT NULL DEFAULT 0 CHECK (match_rate IN (0,10,25,50,100)),
  sort_order               INTEGER NOT NULL DEFAULT 0,
  archived                 INTEGER NOT NULL DEFAULT 0,
  status                   TEXT NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE','REACHED','ARCHIVED')),
  current_saved_pence      INTEGER NOT NULL DEFAULT 0,
  product_url              TEXT,
  parent_match_pct         INTEGER NOT NULL DEFAULT 0 CHECK (parent_match_pct BETWEEN 0 AND 100),
  parent_fixed_contribution INTEGER NOT NULL DEFAULT 0,
  created_at               INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at               INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO goals_new SELECT * FROM goals;
DROP TABLE goals;
ALTER TABLE goals_new RENAME TO goals;

-- ─────────────────────────────────────────────────────────────────
-- 4. spending.currency  (GBP|PLN → GBP|PLN|USD)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE spending_new (
  id         TEXT PRIMARY KEY,
  family_id  TEXT NOT NULL REFERENCES families(id),
  child_id   TEXT NOT NULL REFERENCES users(id),
  title      TEXT NOT NULL,
  amount     INTEGER NOT NULL CHECK (amount > 0),
  currency   TEXT NOT NULL DEFAULT 'GBP'
               CHECK (currency IN ('GBP','PLN','USD')),
  note       TEXT,
  goal_id    TEXT REFERENCES goals(id),
  spent_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO spending_new SELECT * FROM spending;
DROP TABLE spending;
ALTER TABLE spending_new RENAME TO spending;

-- ─────────────────────────────────────────────────────────────────
-- 5. ledger.currency  (GBP|PLN → GBP|PLN|USD)
-- The ledger has immutable-field triggers. We recreate the table
-- and reattach the triggers.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE ledger_new (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id           TEXT NOT NULL REFERENCES families(id),
  child_id            TEXT REFERENCES users(id),
  chore_id            TEXT REFERENCES chores(id),
  entry_type          TEXT NOT NULL
                        CHECK (entry_type IN ('credit','reversal','payment','system_note')),
  amount              INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency            TEXT NOT NULL DEFAULT 'GBP'
                        CHECK (currency IN ('GBP','PLN','USD')),
  description         TEXT NOT NULL DEFAULT '',
  receipt_id          TEXT,
  category            TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending'
                        CHECK (verification_status IN
                          ('pending','verified_auto','verified_manual','disputed','reversed')),
  authorised_by       TEXT REFERENCES users(id),
  verified_at         INTEGER,
  verified_by         TEXT REFERENCES users(id),
  dispute_code        TEXT,
  dispute_before      INTEGER,
  previous_hash       TEXT NOT NULL DEFAULT '0000000000000000',
  record_hash         TEXT NOT NULL DEFAULT '',
  ip_address          TEXT NOT NULL DEFAULT '',
  created_at          INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO ledger_new SELECT * FROM ledger;
DROP TABLE ledger;
ALTER TABLE ledger_new RENAME TO ledger;

-- Recreate immutable-field trigger on new ledger table
CREATE TRIGGER IF NOT EXISTS ledger_immutable_fields
BEFORE UPDATE ON ledger
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.amount        != OLD.amount        THEN RAISE(ABORT, 'ledger: amount is immutable')
    WHEN NEW.currency      != OLD.currency      THEN RAISE(ABORT, 'ledger: currency is immutable')
    WHEN NEW.entry_type    != OLD.entry_type    THEN RAISE(ABORT, 'ledger: entry_type is immutable')
    WHEN NEW.record_hash   != OLD.record_hash   THEN RAISE(ABORT, 'ledger: record_hash is immutable')
    WHEN NEW.previous_hash != OLD.previous_hash THEN RAISE(ABORT, 'ledger: previous_hash is immutable')
    WHEN NEW.ip_address    != OLD.ip_address    THEN RAISE(ABORT, 'ledger: ip_address is immutable')
    WHEN NEW.created_at    != OLD.created_at    THEN RAISE(ABORT, 'ledger: created_at is immutable')
  END;
END;

-- ─────────────────────────────────────────────────────────────────
-- 6. families.base_currency / currency  (GBP|PLN → GBP|PLN|USD)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE families_new (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'GBP'
                    CHECK (currency IN ('GBP','PLN','USD')),
  verify_mode     TEXT NOT NULL DEFAULT 'standard'
                    CHECK (verify_mode IN ('amicable','standard')),
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  base_currency   TEXT NOT NULL DEFAULT 'GBP'
                    CHECK (base_currency IN ('GBP','PLN','USD')),
  parenting_mode  TEXT NOT NULL DEFAULT 'single'
                    CHECK (parenting_mode IN ('single','co-parenting')),
  deleted_at      INTEGER
);
INSERT INTO families_new SELECT * FROM families;
DROP TABLE families;
ALTER TABLE families_new RENAME TO families;
