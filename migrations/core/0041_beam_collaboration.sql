-- AUTHOR-003: coauthor conflicts, comment threads and learner feedback. A lesson
-- save made from an older draft whose lesson someone else changed meanwhile is
-- kept as a conflict (both texts) until a coauthor resolves it. Comments thread on
-- a draft lesson or question; a change request stays open until resolved.
-- Learner feedback and broken-content reports on a published lesson reach the
-- course's responsible expert and the owner's content queue.
CREATE TABLE beam_draft_conflicts (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES beam_courses(id),
  lesson_id TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES beam_members(id),
  mine_json TEXT NOT NULL,
  theirs_json TEXT NOT NULL,
  draft_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  resolution TEXT CHECK (resolution IN ('kept_current', 'used_mine', 'merged')),
  resolved_by TEXT REFERENCES beam_members(id),
  resolved_at INTEGER
);
CREATE INDEX beam_draft_conflicts_course ON beam_draft_conflicts(course_id);
CREATE TABLE beam_course_comments (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES beam_courses(id),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('lesson', 'question')),
  target_id TEXT NOT NULL,
  thread_id TEXT REFERENCES beam_course_comments(id),
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'change')),
  author_id TEXT NOT NULL REFERENCES beam_members(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_by TEXT REFERENCES beam_members(id),
  resolved_at INTEGER
);
CREATE INDEX beam_course_comments_course ON beam_course_comments(course_id);
CREATE TABLE beam_content_feedback (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES beam_courses(id),
  course_revision_id TEXT NOT NULL REFERENCES beam_course_revisions(id),
  lesson_revision_id TEXT REFERENCES beam_lesson_revisions(id),
  learner_id TEXT NOT NULL REFERENCES beam_members(id),
  kind TEXT NOT NULL CHECK (kind IN ('feedback', 'broken')),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'closed')),
  closed_by TEXT REFERENCES beam_members(id),
  closed_at INTEGER,
  close_note TEXT
);
CREATE INDEX beam_content_feedback_course ON beam_content_feedback(course_id);
