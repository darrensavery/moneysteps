-- Migration 0026: Add app_view snapshot to child_logins.
-- Records the child's app_view at the time of each login so graduation_pending
-- can be detected by comparing consecutive logins.

ALTER TABLE child_logins ADD COLUMN app_view TEXT NOT NULL DEFAULT 'ORCHARD'
  CHECK (app_view IN ('ORCHARD', 'CLEAN'));
