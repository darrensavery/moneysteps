-- worker/migrations/0090_mentor_chat_tables.sql
CREATE TABLE IF NOT EXISTS mentor_chat_messages (
  id               TEXT    PRIMARY KEY,
  family_id        TEXT    NOT NULL REFERENCES families(id),
  child_id         TEXT    NOT NULL REFERENCES users(id),
  role             TEXT    NOT NULL CHECK (role IN ('child', 'assistant')),
  content          TEXT    NOT NULL,
  moderation_flags TEXT,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_mentor_chat_messages_child
  ON mentor_chat_messages (child_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mentor_chat_messages_family
  ON mentor_chat_messages (family_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mentor_chat_escalations (
  id               TEXT    PRIMARY KEY,
  message_id       TEXT    NOT NULL REFERENCES mentor_chat_messages(id),
  escalation_type  TEXT    NOT NULL CHECK (escalation_type IN ('distress', 'abuse_pattern')),
  parents_notified INTEGER NOT NULL CHECK (parents_notified IN (0, 1)),
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_mentor_chat_escalations_message
  ON mentor_chat_escalations (message_id);

CREATE TABLE IF NOT EXISTS mentor_chat_consents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT    NOT NULL REFERENCES users(id),
  consented       INTEGER NOT NULL CHECK (consented IN (0, 1)),
  consent_version TEXT    NOT NULL,
  ip_address      TEXT    NOT NULL,
  consented_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_mentor_chat_consents_user
  ON mentor_chat_consents (user_id, consented_at DESC);
