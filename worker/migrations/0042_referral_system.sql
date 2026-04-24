-- Migration 0042: referral system

-- Unique referral code per family (set at registration)
ALTER TABLE families ADD COLUMN referral_code TEXT UNIQUE;

-- Code of the referrer who brought this family in (set at registration)
ALTER TABLE families ADD COLUMN referred_by_code TEXT;

-- Click log — one row per unique click on a referral link
CREATE TABLE IF NOT EXISTS referral_clicks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  referral_code TEXT    NOT NULL,
  clicked_at    INTEGER NOT NULL,  -- unix epoch
  user_agent    TEXT,
  ip_hash       TEXT               -- SHA-256 of IP for dedup, not PII
);

-- Conversion log — one row when a referred family buys a licence
CREATE TABLE IF NOT EXISTS referral_conversions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  referral_code    TEXT    NOT NULL,       -- referrer's code
  referred_family  TEXT    NOT NULL,       -- family_id of the new purchaser
  payment_type     TEXT    NOT NULL,       -- LIFETIME | COMPLETE | AI_ANNUAL | SHIELD
  stripe_session_id TEXT   NOT NULL UNIQUE,-- idempotency key
  converted_at     INTEGER NOT NULL,       -- unix epoch
  reward_granted   INTEGER NOT NULL DEFAULT 0  -- 1 once AI Mentor bonus applied
);

CREATE INDEX IF NOT EXISTS idx_referral_clicks_code ON referral_clicks(referral_code);
CREATE INDEX IF NOT EXISTS idx_referral_conversions_code ON referral_conversions(referral_code);
