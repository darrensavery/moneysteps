ALTER TABLE payment_audit_log RENAME TO payment_audit_log_old;

CREATE TABLE payment_audit_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id         TEXT    NOT NULL,
  stripe_session_id TEXT    NOT NULL UNIQUE,
  amount_paid_int   INTEGER NOT NULL,
  currency          TEXT    NOT NULL,
  payment_type      TEXT    CHECK(payment_type IN ('LIFETIME','AI_ANNUAL','COMPLETE','COMPLETE_AI','SHIELD_AI','AI_UPGRADE','SHIELD')),
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (family_id) REFERENCES families(id)
);

INSERT INTO payment_audit_log SELECT * FROM payment_audit_log_old;

DROP TABLE payment_audit_log_old;
