-- NOTICE-006 (in-app slice): announcements to the learners of a team or a
-- course, the people each one reached, and each recipient's private replies,
-- which only the sender reads.
CREATE TABLE beam_announcements (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES beam_members(id),
  audience_kind TEXT NOT NULL CHECK (audience_kind IN ('team', 'course')),
  audience_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);
CREATE TABLE beam_announcement_recipients (
  announcement_id TEXT NOT NULL REFERENCES beam_announcements(id),
  learner_id TEXT NOT NULL REFERENCES beam_members(id),
  PRIMARY KEY (announcement_id, learner_id)
);
CREATE INDEX beam_announcement_recipients_learner ON beam_announcement_recipients(learner_id);
CREATE TABLE beam_announcement_replies (
  id TEXT PRIMARY KEY,
  announcement_id TEXT NOT NULL REFERENCES beam_announcements(id),
  learner_id TEXT NOT NULL REFERENCES beam_members(id),
  body TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);
