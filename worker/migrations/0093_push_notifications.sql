-- worker/migrations/0093_push_notifications.sql
-- Device tokens for native push notifications (iOS APNs / Android FCM).
-- `token` is the primary key (not `user_id`) — a physical device token
-- belongs to exactly one app installation. Re-registering the same token
-- under a different user_id (shared family tablet, account switch)
-- reassigns it via upsert in the /api/push/register handler, rather than
-- creating a stale duplicate row.
-- See docs/superpowers/specs/2026-08-11-push-notifications-design.md
CREATE TABLE IF NOT EXISTS device_tokens (
  token       TEXT    PRIMARY KEY,
  user_id     TEXT    NOT NULL REFERENCES users(id),
  platform    TEXT    NOT NULL CHECK (platform IN ('ios', 'android')),
  environment TEXT    NOT NULL CHECK (environment IN ('sandbox', 'production')),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens (user_id);
