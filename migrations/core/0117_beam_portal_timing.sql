-- An open timed assessment is progress, not a scored attempt or earned evidence.
CREATE TABLE beam_portal_quiz_sessions (
 id TEXT PRIMARY KEY,
 enrollment_id TEXT NOT NULL REFERENCES beam_portal_enrollments(id),
 assessment_revision_id TEXT NOT NULL REFERENCES beam_assessment_revisions(id),
 number INTEGER NOT NULL CHECK(number>0),
 started_at INTEGER NOT NULL,
 deadline INTEGER NOT NULL CHECK(deadline>started_at),
 answers_json TEXT NOT NULL DEFAULT '{}',
 version INTEGER NOT NULL DEFAULT 0,
 closed_at INTEGER,
 close_reason TEXT CHECK(close_reason IN ('submitted','expired')),
 attempt_id TEXT REFERENCES beam_portal_attempts(id),
 UNIQUE(enrollment_id,number)
);
CREATE TRIGGER beam_portal_quiz_session_revision BEFORE INSERT ON beam_portal_quiz_sessions
WHEN NOT EXISTS(SELECT 1 FROM beam_portal_enrollments e JOIN beam_assessment_revisions a
 ON a.course_revision_id=e.revision_id WHERE e.id=NEW.enrollment_id AND a.id=NEW.assessment_revision_id AND a.time_limit_minutes IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'portal_assessment_revision_mismatch'); END;
