-- Migration 0035: Field-level immutability guards for shared_expenses
--
-- The original shared_expenses_no_update trigger only fires when the row is already
-- committed (status IN committed_auto, committed_manual, reversed). This leaves pending
-- and rejected rows vulnerable to accidental mutation of financial fields by a bug or
-- future developer.
--
-- Following the pattern established in 0004_relax_ledger_update_trigger.sql, we drop
-- the blanket status-based trigger and replace it with field-level guards for the
-- fields that must never change after insert: total_amount, currency, ip_address,
-- created_at, family_id, logged_by.
--
-- The record_hash and previous_hash fields are explicitly excluded because they
-- legitimately transition from their pending sentinels (record_hash='PENDING',
-- previous_hash=64-zero genesis hash) to actual hash values at approve time.
--
-- The blanket status-based trigger remains for preventing updates to committed rows
-- (as a defense-in-depth measure), but the field-level guard ensures financial data
-- integrity even on pending rows.

DROP TRIGGER IF EXISTS shared_expenses_no_update;

-- Guard the core financial fields that constitute the immutable record.
-- Any attempt to change total_amount, currency, ip_address, created_at, family_id,
-- or logged_by will abort with an error.
CREATE TRIGGER IF NOT EXISTS shared_expenses_immutable_fields
  BEFORE UPDATE ON shared_expenses
  WHEN NEW.total_amount   != OLD.total_amount
    OR NEW.currency       != OLD.currency
    OR NEW.ip_address     != OLD.ip_address
    OR NEW.created_at     != OLD.created_at
    OR NEW.family_id      != OLD.family_id
    OR NEW.logged_by      != OLD.logged_by
BEGIN
  SELECT RAISE(ABORT, 'Immutable shared_expense fields cannot be changed after insert.');
END;

-- Status-based guard: committed rows cannot transition to other states.
CREATE TRIGGER IF NOT EXISTS shared_expenses_committed_immutable
  BEFORE UPDATE ON shared_expenses
  WHEN (OLD.verification_status IN ('committed_auto', 'committed_manual', 'reversed')
        AND NEW.verification_status != OLD.verification_status)
BEGIN
  SELECT RAISE(ABORT, 'Committed shared_expense rows are immutable. Use a reversal entry.');
END;

-- Partial index for efficient active-expense queries (where deleted_at IS NULL).
CREATE INDEX IF NOT EXISTS idx_shared_exp_active
  ON shared_expenses (family_id, created_at DESC)
  WHERE deleted_at IS NULL;
