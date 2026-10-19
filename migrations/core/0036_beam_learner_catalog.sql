-- ORG-007: the learner catalog. A course is offered for self-enrollment
-- ('open'), on approval ('request') or only by assignment ('assigned', the
-- default), to everyone or to chosen teams. Requests wait for whoever may enroll
-- the learner; favorites and saved searches belong to their person alone.
ALTER TABLE beam_courses ADD COLUMN enrollment_mode TEXT NOT NULL DEFAULT 'assigned' CHECK (enrollment_mode IN ('assigned', 'open', 'request'));
ALTER TABLE beam_courses ADD COLUMN catalog_teams TEXT;
CREATE TABLE beam_enrollment_requests (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES beam_courses(id),
  learner_id TEXT NOT NULL REFERENCES beam_members(id),
  note TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'approved', 'declined', 'withdrawn')),
  requested_at INTEGER NOT NULL,
  decided_by TEXT REFERENCES beam_members(id),
  decided_at INTEGER,
  reason TEXT,
  assignment_id TEXT REFERENCES beam_assignments(id)
);
CREATE UNIQUE INDEX beam_enrollment_requests_open ON beam_enrollment_requests(course_id, learner_id) WHERE state = 'open';
CREATE TABLE beam_favorites (
  member_id TEXT NOT NULL REFERENCES beam_members(id),
  course_id TEXT NOT NULL REFERENCES beam_courses(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (member_id, course_id)
);
CREATE TABLE beam_saved_searches (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES beam_members(id),
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
