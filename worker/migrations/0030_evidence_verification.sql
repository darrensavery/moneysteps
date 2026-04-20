-- Migration 0030: Audit-Ready Evidence System
--
-- Adds four columns to completions for tamper-evident photo verification:
--   proof_hash              — SHA-256 hex of the raw image bytes (integrity seal)
--   proof_exif              — JSON: { dateTimeOriginal, gpsLat, gpsLng, deviceModel }
--   system_verify           — JSON: { uploadedAt, ip, city, country, cfLat, cfLng }
--   verification_confidence — 'High' | 'Medium' | 'Low'
--
-- SQLite supports ALTER TABLE ADD COLUMN, so no recreate is needed.
-- These columns are nullable; existing rows stay NULL until re-uploaded.
-- Privacy: these columns must never be included in child/parent list responses.
-- They are audit-only data, surfaced exclusively via a future audit export route.

ALTER TABLE completions ADD COLUMN proof_hash              TEXT;
ALTER TABLE completions ADD COLUMN proof_exif              TEXT;
ALTER TABLE completions ADD COLUMN system_verify           TEXT;
ALTER TABLE completions ADD COLUMN verification_confidence TEXT
  CHECK (verification_confidence IN ('High', 'Medium', 'Low'));
