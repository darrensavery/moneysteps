-- Migration 0013: Savings Grove — goal enhancements
--
-- Adds:
--   status            ACTIVE | REACHED | ARCHIVED  (replaces soft-delete `archived` flag for goals)
--   current_saved_pence  running tally of how much child has saved toward this goal
--   product_url       Optional URL — visible only in teen_mode view
--   parent_match_pct  Integer 0-100 representing the parent match percentage
--                     (e.g. 50 = parent tops up 50p for every £1 child saves)
--   parent_fixed_contribution  One-time parent gift in pence (0 = none)
--
-- Note: existing `match_rate` column (0|10|25|50|100 %) is kept for backwards compat.
-- The new `parent_match_pct` is freeform (0-100) and supercedes match_rate for new goals.

ALTER TABLE goals ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'
  CHECK (status IN ('ACTIVE', 'REACHED', 'ARCHIVED'));

ALTER TABLE goals ADD COLUMN current_saved_pence INTEGER NOT NULL DEFAULT 0
  CHECK (current_saved_pence >= 0);

ALTER TABLE goals ADD COLUMN product_url TEXT;

ALTER TABLE goals ADD COLUMN parent_match_pct INTEGER NOT NULL DEFAULT 0
  CHECK (parent_match_pct BETWEEN 0 AND 100);

ALTER TABLE goals ADD COLUMN parent_fixed_contribution INTEGER NOT NULL DEFAULT 0
  CHECK (parent_fixed_contribution >= 0);

-- Migrate existing archived=1 rows to status='ARCHIVED'
UPDATE goals SET status = 'ARCHIVED' WHERE archived = 1;
