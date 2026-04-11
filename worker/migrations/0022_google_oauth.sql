-- 0022_google_oauth.sql
-- Google identity columns on users (email_verified already exists from schema)
-- Note: SQLite does not support ADD COLUMN ... UNIQUE; uniqueness is enforced via a partial index.
ALTER TABLE users ADD COLUMN google_sub     TEXT;
ALTER TABLE users ADD COLUMN google_picture TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users (google_sub) WHERE google_sub IS NOT NULL;

-- Short-lived handoff tokens (60-second single-use bridge tokens)
CREATE TABLE IF NOT EXISTS slt_tokens (
  token      TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT
);

-- IP-based abuse tracking for SLT exchange endpoint
CREATE TABLE IF NOT EXISTS slt_attempts (
  ip            TEXT    PRIMARY KEY,
  attempts      INTEGER NOT NULL DEFAULT 0,
  blocked_until INTEGER
);
