-- Migration 0020: Add parent_role to family_roles; add deleted_at to families.
--
-- parent_role values:
--   'lead'      — primary billing/deletion authority (founding parent or promoted co-parent)
--   'co_parent' — full audit/approval rights, cannot delete the family
--   NULL        — future: 'viewer' role (read-only, grandparents/social workers)
--
-- Backfill: all existing parent rows become 'lead' because no co-parent
-- invite redemption has ever written a parent_role value.

ALTER TABLE family_roles ADD COLUMN parent_role TEXT
  CHECK (parent_role IN ('lead', 'co_parent'));

UPDATE family_roles
  SET parent_role = 'lead'
  WHERE role = 'parent' AND parent_role IS NULL;

ALTER TABLE families ADD COLUMN deleted_at INTEGER;
