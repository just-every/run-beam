-- NOTICE-006: bounded location and active cohort recipient snapshots.
-- Rebuild the parent and both dependent tables together: D1 checks foreign keys
-- between statements, so retaining children across a parent DROP is unsafe.
CREATE TABLE beam_announcements_next (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES beam_members(id),
  audience_kind TEXT NOT NULL CHECK (audience_kind IN ('team', 'course', 'session', 'location', 'cohort')),
  audience_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  basis TEXT NOT NULL DEFAULT 'management' CHECK (basis IN ('management', 'instructor', 'admin')),
  instructor_grant_id TEXT REFERENCES beam_instructor_grants(id)
);
INSERT INTO beam_announcements_next (id, sender_id, audience_kind, audience_id, title, body, sent_at, basis, instructor_grant_id)
  SELECT id, sender_id, audience_kind, audience_id, title, body, sent_at, basis, instructor_grant_id FROM beam_announcements ORDER BY rowid;
CREATE TABLE beam_announcement_recipients_next (
  announcement_id TEXT NOT NULL REFERENCES beam_announcements_next(id),
  learner_id TEXT NOT NULL REFERENCES beam_members(id),
  PRIMARY KEY (announcement_id, learner_id)
);
INSERT INTO beam_announcement_recipients_next SELECT * FROM beam_announcement_recipients ORDER BY rowid;
CREATE TABLE beam_announcement_replies_next (
  id TEXT PRIMARY KEY,
  announcement_id TEXT NOT NULL REFERENCES beam_announcements_next(id),
  learner_id TEXT NOT NULL REFERENCES beam_members(id),
  body TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);
INSERT INTO beam_announcement_replies_next SELECT * FROM beam_announcement_replies ORDER BY rowid;
DROP TABLE beam_announcement_replies;
DROP TABLE beam_announcement_recipients;
DROP TABLE beam_announcements;
ALTER TABLE beam_announcements_next RENAME TO beam_announcements;
ALTER TABLE beam_announcement_recipients_next RENAME TO beam_announcement_recipients;
ALTER TABLE beam_announcement_replies_next RENAME TO beam_announcement_replies;
CREATE INDEX beam_announcement_recipients_learner ON beam_announcement_recipients(learner_id);
