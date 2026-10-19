-- LEARN-001: a course's questions are its bank. The assessment revision keeps how many questions each attempt draws
-- (null asks them all), whether their order is shuffled, and when learners see which answers were right. Each attempt
-- and timed session keeps the questions it drew; each response keeps its weight and the points it earned (null until
-- the named assessor grades a written answer), and the grading is recorded with its note.
ALTER TABLE beam_assessment_revisions ADD COLUMN draw_count INTEGER;
ALTER TABLE beam_assessment_revisions ADD COLUMN shuffle INTEGER NOT NULL DEFAULT 0;
ALTER TABLE beam_assessment_revisions ADD COLUMN feedback TEXT NOT NULL DEFAULT 'attempt' CHECK (feedback IN ('attempt', 'final', 'score'));
ALTER TABLE beam_attempts ADD COLUMN question_ids_json TEXT;
ALTER TABLE beam_quiz_sessions ADD COLUMN question_ids_json TEXT;
ALTER TABLE beam_responses ADD COLUMN weight INTEGER NOT NULL DEFAULT 1;
ALTER TABLE beam_responses ADD COLUMN points INTEGER;
UPDATE beam_responses SET points = correct;
CREATE TABLE beam_quiz_gradings (
  attempt_id TEXT PRIMARY KEY REFERENCES beam_attempts(id),
  assessor_id TEXT NOT NULL REFERENCES beam_members(id),
  note TEXT NOT NULL,
  graded_at INTEGER NOT NULL
);
-- The revision's satisfaction survey: it never counts toward passing or completion. Answers keep only the revision;
-- who answered is kept apart, without a link to the answer, so each assignment answers once.
ALTER TABLE beam_course_revisions ADD COLUMN survey_json TEXT;
CREATE TABLE beam_survey_answers (
  id TEXT PRIMARY KEY,
  course_revision_id TEXT NOT NULL REFERENCES beam_course_revisions(id),
  answers_json TEXT NOT NULL
);
CREATE INDEX beam_survey_answers_revision ON beam_survey_answers(course_revision_id);
CREATE TABLE beam_survey_takers (
  assignment_id TEXT PRIMARY KEY REFERENCES beam_assignments(id)
);
