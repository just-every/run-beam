-- LEARN-014: lesson discussions and expert questions for a course's cohort. A thread hangs off a lesson of a published
-- revision; replies note whether a course expert wrote them; an expert resolves a question with an answer and may turn
-- it into a course-draft proposal. Attachments are stored bytes that a learner shares for review: they stay pending until
-- an expert or moderator approves them, and a removed one is never served. Moderators hide posts with a reason; hidden
-- items stay in the record. Nothing here touches attempts, completions or certificates.
CREATE TABLE beam_discussion_threads (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES beam_courses(id),
  lesson_revision_id TEXT NOT NULL REFERENCES beam_lesson_revisions(id),
  kind TEXT NOT NULL CHECK (kind IN ('question', 'discussion')),
  title TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'resolved')),
  answer_post_id TEXT,
  resolved_by TEXT REFERENCES beam_members(id),
  resolved_at INTEGER,
  proposal_id TEXT REFERENCES beam_proposals(id),
  created_by TEXT NOT NULL REFERENCES beam_members(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX beam_discussion_threads_course ON beam_discussion_threads(course_id, created_at);
CREATE TABLE beam_discussion_posts (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES beam_discussion_threads(id),
  author_id TEXT NOT NULL REFERENCES beam_members(id),
  expert INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  hidden_by TEXT REFERENCES beam_members(id),
  hidden_at INTEGER,
  hidden_reason TEXT
);
CREATE INDEX beam_discussion_posts_thread ON beam_discussion_posts(thread_id, created_at);
CREATE TABLE beam_discussion_files (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES beam_discussion_posts(id),
  attachment_id TEXT NOT NULL REFERENCES beam_attachments(id),
  state TEXT NOT NULL CHECK (state IN ('pending', 'approved', 'removed')),
  decided_by TEXT REFERENCES beam_members(id),
  decided_at INTEGER,
  reason TEXT
);
CREATE INDEX beam_discussion_files_post ON beam_discussion_files(post_id);
