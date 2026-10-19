-- AUTHOR-006: accountable content upkeep. A course's fallback owner and next review date (a business-local calendar
-- date), scheduled reviews with their decisions, the next review date each source-notice decision set, and every
-- reminder or escalation mail Beam handed to the mail provider.
ALTER TABLE beam_courses ADD COLUMN fallback_owner_id TEXT REFERENCES beam_members(id);
ALTER TABLE beam_courses ADD COLUMN next_review_on TEXT;
ALTER TABLE beam_source_notices ADD COLUMN next_review_on TEXT;
CREATE TABLE beam_content_reviews (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES beam_courses(id),
  due_on TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'no_material_change', 'draft_updated')),
  note TEXT,
  next_review_on TEXT,
  decided_by TEXT REFERENCES beam_members(id),
  decided_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (course_id, due_on)
);
CREATE TABLE beam_upkeep_messages (
  id TEXT PRIMARY KEY,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('review', 'source')),
  item_id TEXT NOT NULL,
  course_id TEXT NOT NULL REFERENCES beam_courses(id),
  recipient_id TEXT NOT NULL REFERENCES beam_members(id),
  route TEXT NOT NULL CHECK (route IN ('responsible', 'fallback', 'owner')),
  reason TEXT,
  status TEXT NOT NULL CHECK (status IN ('accepted', 'development')),
  provider_message_id TEXT,
  sent_at INTEGER NOT NULL
);
CREATE INDEX beam_upkeep_messages_course ON beam_upkeep_messages(course_id, sent_at);
