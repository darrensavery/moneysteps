-- worker/migrations/0091_escalation_reply_link.sql
--
-- Links mentor_chat_escalations to the assistant's crisis-reply message, not just
-- the child's triggering message. The child's role='child' row was already linked
-- via message_id, but the assistant's role='assistant' crisis-resource reply (the
-- text that actually reveals which branch fired, e.g. "we've also let your
-- parent(s) know" vs. "without anyone else finding out") had no stored link at all,
-- making it impossible to redact its content for parent readers without relying on
-- fragile row-adjacency inference. See
-- .superpowers/sdd/2026-08-05-teen-mentor-chat/parent-content-redaction-report.md
-- (option b) for the full rationale.
ALTER TABLE mentor_chat_escalations
  ADD COLUMN assistant_message_id TEXT REFERENCES mentor_chat_messages(id);
