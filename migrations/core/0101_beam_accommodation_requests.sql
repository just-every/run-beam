-- LEARN-011: numeric, course-scoped requests; no diagnosis or medical text.
CREATE TABLE beam_accommodation_requests (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES beam_members(id),
  assignment_id TEXT NOT NULL REFERENCES beam_assignments(id),
  course_id TEXT NOT NULL REFERENCES beam_courses(id),
  kind TEXT NOT NULL CHECK(kind IN ('minutes','percent')),
  amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 600 AND (kind='minutes' OR amount<=400)),
  state TEXT NOT NULL CHECK(state IN ('pending','approved','declined')),
  requested_at INTEGER NOT NULL,
  decided_by TEXT REFERENCES beam_members(id),
  decided_at INTEGER,
  decision_id TEXT,
  grant_id TEXT
);
CREATE UNIQUE INDEX beam_one_pending_accommodation ON beam_accommodation_requests(learner_id,course_id) WHERE state='pending';
