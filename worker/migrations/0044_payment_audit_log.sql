CREATE TABLE IF NOT EXISTS payment_audit_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id         TEXT    NOT NULL,
  stripe_session_id TEXT    NOT NULL UNIQUE,
  amount_paid_int   INTEGER NOT NULL,
  currency          TEXT    NOT NULL DEFAULT 'GBP',
  payment_type      TEXT    NOT NULL,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payment_audit_log_family
  ON payment_audit_log (family_id);
