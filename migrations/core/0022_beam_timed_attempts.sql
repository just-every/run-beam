-- LEARN-018: time-limited assessments. The limit is part of the assessment
-- revision. A timed quiz attempt runs as a server-clocked session from its start;
-- answers are saved into it until its deadline, and closing it (on submission, at
-- expiry or by a reset) writes the scored attempt with its limit, extra time,
-- accommodation and actual start and close times.
ALTER TABLE beam_assessment_revisions ADD COLUMN time_limit_minutes INTEGER;
CREATE TABLE beam_accommodations (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES beam_members(id),
  course_id TEXT REFERENCES beam_courses(id),
  kind TEXT NOT NULL CHECK (kind IN ('minutes', 'percent')),
  amount INTEGER NOT NULL,
  note TEXT NOT NULL,
  granted_by TEXT NOT NULL REFERENCES beam_members(id),
  granted_at INTEGER NOT NULL
);
CREATE INDEX beam_accommodations_learner ON beam_accommodations(learner_id);
CREATE TABLE beam_quiz_sessions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES beam_assignments(id),
  assessment_revision_id TEXT NOT NULL REFERENCES beam_assessment_revisions(id),
  started_at INTEGER NOT NULL,
  deadline INTEGER NOT NULL,
  time_limit_minutes INTEGER NOT NULL,
  extra_minutes INTEGER NOT NULL,
  accommodation_json TEXT,
  closed_at INTEGER,
  close_reason TEXT CHECK (close_reason IN ('submitted', 'expired', 'reset')),
  attempt_id TEXT REFERENCES beam_attempts(id)
);
CREATE UNIQUE INDEX beam_one_open_quiz_session ON beam_quiz_sessions(assignment_id) WHERE closed_at IS NULL;
CREATE TABLE beam_quiz_session_answers (
  session_id TEXT NOT NULL REFERENCES beam_quiz_sessions(id),
  question_id TEXT NOT NULL,
  answer_json TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, question_id)
);
ALTER TABLE beam_attempts ADD COLUMN started_at INTEGER;
ALTER TABLE beam_attempts ADD COLUMN closed_at INTEGER;
ALTER TABLE beam_attempts ADD COLUMN close_reason TEXT;
ALTER TABLE beam_attempts ADD COLUMN time_limit_minutes INTEGER;
ALTER TABLE beam_attempts ADD COLUMN extra_minutes INTEGER;
ALTER TABLE beam_attempts ADD COLUMN accommodation_json TEXT;
