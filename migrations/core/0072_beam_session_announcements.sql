-- NOTICE-006: session recipient snapshots and the sender's authority basis.
-- Preserve prior announcements, recipients and private replies in place.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE beam_announcements_next (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES beam_members(id),
  audience_kind TEXT NOT NULL CHECK (audience_kind IN ('team', 'course', 'session')),
  audience_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  basis TEXT NOT NULL DEFAULT 'management' CHECK (basis IN ('management', 'instructor', 'admin')),
  instructor_grant_id TEXT REFERENCES beam_instructor_grants(id)
);
INSERT INTO beam_announcements_next (id, sender_id, audience_kind, audience_id, title, body, sent_at)
  SELECT id, sender_id, audience_kind, audience_id, title, body, sent_at FROM beam_announcements ORDER BY rowid;
DROP TABLE beam_announcements;
ALTER TABLE beam_announcements_next RENAME TO beam_announcements;
