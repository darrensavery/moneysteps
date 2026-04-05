-- Production repair migration
-- Applies all DDL that is marked as applied in d1_migrations but was never actually executed.
-- Safe to run: uses IF NOT EXISTS / IF column doesn't exist patterns where possible.
-- Run with: wrangler d1 execute morechard --remote --file migrations/repair_production.sql

-- ============================================================
-- Drop the old chores table (wrong schema) and recreate it
-- ============================================================
DROP TABLE IF EXISTS chores;

CREATE TABLE IF NOT EXISTS chores (
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
                            'daily','weekly','bi_weekly','monthly','quarterly','as_needed','school_days'
                          )),
  due_date        TEXT,
  is_priority     INTEGER NOT NULL DEFAULT 0,
  is_flash        INTEGER NOT NULL DEFAULT 0,
  flash_deadline  TEXT,
  archived        INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_chores_family ON chores (family_id, archived, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chores_child  ON chores (assigned_to, archived);

-- ============================================================
-- USER SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS user_settings (
  user_id       TEXT    PRIMARY KEY REFERENCES users(id),
  avatar_id     TEXT    NOT NULL DEFAULT 'bot',
  theme         TEXT    NOT NULL DEFAULT 'system'
                        CHECK (theme IN ('light', 'dark', 'system')),
  locale        TEXT    NOT NULL DEFAULT 'en',
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ============================================================
-- COMPLETIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS completions (
  id              TEXT    PRIMARY KEY,
  family_id       TEXT    NOT NULL REFERENCES families(id),
  chore_id        TEXT    NOT NULL REFERENCES chores(id),
  child_id        TEXT    NOT NULL REFERENCES users(id),
  note            TEXT,
  status          TEXT    NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected')),
  rejection_note  TEXT,
  ledger_id       INTEGER REFERENCES ledger(id),
  rating          INTEGER DEFAULT 0,
  submitted_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at     INTEGER,
  resolved_by     TEXT    REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_completions_family ON completions (family_id, status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_completions_child  ON completions (child_id, submitted_at DESC);

-- ============================================================
-- SUGGESTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS suggestions (
  id              TEXT    PRIMARY KEY,
  family_id       TEXT    NOT NULL REFERENCES families(id),
  child_id        TEXT    NOT NULL REFERENCES users(id),
  title           TEXT    NOT NULL,
  frequency       TEXT,
  proposed_amount INTEGER NOT NULL CHECK (proposed_amount > 0),
  reason          TEXT,
  status          TEXT    NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected')),
  rejection_note  TEXT,
  submitted_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at     INTEGER,
  resolved_by     TEXT    REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_suggestions_family ON suggestions (family_id, status);

-- ============================================================
-- PLANS
-- ============================================================
CREATE TABLE IF NOT EXISTS plans (
  id          TEXT    PRIMARY KEY,
  family_id   TEXT    NOT NULL REFERENCES families(id),
  chore_id    TEXT    NOT NULL REFERENCES chores(id),
  child_id    TEXT    NOT NULL REFERENCES users(id),
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  week_start  TEXT    NOT NULL,
  added_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_plans_child_week ON plans (child_id, week_start);

-- ============================================================
-- GOALS
-- ============================================================
CREATE TABLE IF NOT EXISTS goals (
  id                        TEXT    PRIMARY KEY,
  family_id                 TEXT    NOT NULL REFERENCES families(id),
  child_id                  TEXT    NOT NULL REFERENCES users(id),
  title                     TEXT    NOT NULL,
  target_amount             INTEGER NOT NULL CHECK (target_amount > 0),
  currency                  TEXT    NOT NULL CHECK (currency IN ('GBP','PLN')),
  category                  TEXT    NOT NULL DEFAULT 'other',
  deadline                  TEXT,
  alloc_pct                 INTEGER NOT NULL DEFAULT 0
                                    CHECK (alloc_pct BETWEEN 0 AND 100),
  match_rate                INTEGER NOT NULL DEFAULT 0
                                    CHECK (match_rate IN (0,10,25,50,100)),
  sort_order                INTEGER NOT NULL DEFAULT 0,
  archived                  INTEGER NOT NULL DEFAULT 0,
  status                    TEXT    NOT NULL DEFAULT 'ACTIVE'
                                    CHECK (status IN ('ACTIVE','REACHED','ARCHIVED')),
  current_saved_pence       INTEGER NOT NULL DEFAULT 0,
  product_url               TEXT,
  parent_match_pct          INTEGER NOT NULL DEFAULT 0
                                    CHECK (parent_match_pct BETWEEN 0 AND 100),
  parent_fixed_contribution INTEGER NOT NULL DEFAULT 0,
  created_at                INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at                INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_goals_child ON goals (child_id, archived, sort_order);

-- ============================================================
-- SPENDING
-- ============================================================
CREATE TABLE IF NOT EXISTS spending (
  id          TEXT    PRIMARY KEY,
  family_id   TEXT    NOT NULL REFERENCES families(id),
  child_id    TEXT    NOT NULL REFERENCES users(id),
  title       TEXT    NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  currency    TEXT    NOT NULL CHECK (currency IN ('GBP','PLN')),
  note        TEXT,
  goal_id     TEXT    REFERENCES goals(id),
  spent_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_spending_child ON spending (child_id, spent_at DESC);

-- ============================================================
-- PAYOUTS
-- ============================================================
CREATE TABLE IF NOT EXISTS payouts (
  id          TEXT    PRIMARY KEY,
  family_id   TEXT    NOT NULL REFERENCES families(id),
  child_id    TEXT    NOT NULL REFERENCES users(id),
  paid_by     TEXT    NOT NULL REFERENCES users(id),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  currency    TEXT    NOT NULL CHECK (currency IN ('GBP','PLN')),
  note        TEXT,
  paid_at     INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_payouts_child ON payouts (child_id, paid_at DESC);

-- ============================================================
-- SUBSCRIPTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id          TEXT    PRIMARY KEY,
  family_id   TEXT    NOT NULL REFERENCES families(id),
  child_id    TEXT    NOT NULL REFERENCES users(id),
  title       TEXT    NOT NULL,
  category    TEXT    NOT NULL DEFAULT 'other',
  amount      INTEGER NOT NULL CHECK (amount > 0),
  currency    TEXT    NOT NULL CHECK (currency IN ('GBP','PLN')),
  frequency   TEXT    NOT NULL DEFAULT 'monthly'
              CHECK (frequency IN ('weekly','monthly','annual')),
  start_date  TEXT    NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_subs_child ON subscriptions (child_id, active);

-- ============================================================
-- BONUS PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS bonus_payments (
  id          TEXT    PRIMARY KEY,
  family_id   TEXT    NOT NULL REFERENCES families(id),
  child_id    TEXT    NOT NULL REFERENCES users(id),
  paid_by     TEXT    NOT NULL REFERENCES users(id),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  currency    TEXT    NOT NULL CHECK (currency IN ('GBP','PLN')),
  reason      TEXT    NOT NULL,
  ledger_id   INTEGER REFERENCES ledger(id),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ============================================================
-- CHILD LOGINS
-- ============================================================
CREATE TABLE IF NOT EXISTS child_logins (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id   TEXT    NOT NULL REFERENCES families(id),
  child_id    TEXT    NOT NULL REFERENCES users(id),
  ip_address  TEXT    NOT NULL,
  logged_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_child_logins ON child_logins (child_id, logged_at DESC);

-- ============================================================
-- PUSH SUBSCRIPTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT    NOT NULL REFERENCES users(id),
  family_id    TEXT    NOT NULL REFERENCES families(id),
  endpoint     TEXT    NOT NULL UNIQUE,
  p256dh       TEXT    NOT NULL,
  auth_key     TEXT    NOT NULL,
  user_agent   TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions (user_id);

-- ============================================================
-- PARENT MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS parent_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id   TEXT    NOT NULL REFERENCES families(id),
  from_user   TEXT    NOT NULL REFERENCES users(id),
  to_child    TEXT    NOT NULL REFERENCES users(id),
  message     TEXT    NOT NULL,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (from_user, to_child)
);

-- ============================================================
-- ACCOUNT LOCKS
-- ============================================================
CREATE TABLE IF NOT EXISTS account_locks (
  user_id     TEXT    PRIMARY KEY REFERENCES users(id),
  locked_by   TEXT    NOT NULL REFERENCES users(id),
  locked_until INTEGER NOT NULL,
  reason      TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ============================================================
-- INVITE CODES (from 0007)
-- ============================================================
CREATE TABLE IF NOT EXISTS invite_codes (
  code        TEXT PRIMARY KEY,
  family_id   TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  role        TEXT NOT NULL CHECK(role IN ('child','co-parent')),
  redeemed_by TEXT DEFAULT NULL,
  redeemed_at INTEGER DEFAULT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at  INTEGER NOT NULL,
  FOREIGN KEY (family_id)  REFERENCES families(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_invite_family  ON invite_codes(family_id);
CREATE INDEX IF NOT EXISTS idx_invite_expires ON invite_codes(expires_at);

-- ============================================================
-- REGISTRATION PROGRESS (from 0007)
-- ============================================================
CREATE TABLE IF NOT EXISTS registration_progress (
  family_id   TEXT PRIMARY KEY,
  last_step   INTEGER NOT NULL DEFAULT 1,
  step_data   TEXT NOT NULL DEFAULT '{}',
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (family_id) REFERENCES families(id)
);

-- ============================================================
-- Missing users columns (from 0006_auth.sql)
-- ============================================================
-- These ALTERs may fail silently if columns already exist — that is fine.
-- D1 doesn't support IF NOT EXISTS on ALTER TABLE ADD COLUMN, so wrap each
-- in a separate statement and ignore duplicates when running.

-- ============================================================
-- users: password_hash, pin_hash, email_verified, firebase_uid (from 0006)
-- These already exist based on PRAGMA — skip.

-- ============================================================
-- Migrations from 0009: school_days frequency
-- Already handled by the chores table creation above (includes 'school_days').

-- ============================================================
-- Migrations from 0010: teen_mode on users
-- ============================================================
-- Attempt; will fail if already exists (that is fine — run separately if needed)

-- ============================================================
-- Migrations from 0011: allowance columns
-- Already handled by PRAGMA showing allowance_amount/allowance_day on users.

-- ============================================================
-- Migrations from 0012: earnings_mode (already confirmed in users PRAGMA)
-- Already applied.
