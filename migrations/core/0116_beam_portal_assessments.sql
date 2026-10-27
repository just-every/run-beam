-- External assessments retain their own enrollment and immutable assessment revision.
CREATE TABLE beam_portal_attempts (
 id TEXT PRIMARY KEY,
 enrollment_id TEXT NOT NULL REFERENCES beam_portal_enrollments(id),
 assessment_revision_id TEXT NOT NULL REFERENCES beam_assessment_revisions(id),
 number INTEGER NOT NULL CHECK(number>0),
 submitted_at INTEGER NOT NULL,
 score INTEGER NOT NULL,
 max_score INTEGER NOT NULL CHECK(max_score>0),
 percent INTEGER NOT NULL CHECK(percent BETWEEN 0 AND 100),
 passed INTEGER NOT NULL CHECK(passed IN (0,1)),
 scoring_rule TEXT NOT NULL,
 responses_json TEXT NOT NULL,
 UNIQUE(enrollment_id,number)
);
CREATE TRIGGER beam_portal_attempt_revision BEFORE INSERT ON beam_portal_attempts
WHEN NOT EXISTS(SELECT 1 FROM beam_portal_enrollments e JOIN beam_assessment_revisions a
 ON a.course_revision_id=e.revision_id WHERE e.id=NEW.enrollment_id AND a.id=NEW.assessment_revision_id)
BEGIN SELECT RAISE(ABORT,'portal_assessment_revision_mismatch'); END;

-- Certificates snapshot the earned revision and issuer; no public verification capability is created.
CREATE TABLE beam_portal_completions (
 id TEXT PRIMARY KEY,
 enrollment_id TEXT NOT NULL UNIQUE REFERENCES beam_portal_enrollments(id),
 revision_id TEXT NOT NULL REFERENCES beam_course_revisions(id),
 assessment_revision_id TEXT REFERENCES beam_assessment_revisions(id),
 attempt_id TEXT REFERENCES beam_portal_attempts(id),
 method TEXT NOT NULL CHECK(method IN ('lessons','assessed')),
 evidence_json TEXT NOT NULL,
 completed_at INTEGER NOT NULL,
 certificate_number TEXT NOT NULL UNIQUE,
 issuer TEXT NOT NULL,
 learner_name TEXT NOT NULL,
 course_title TEXT NOT NULL,
 revision_number INTEGER NOT NULL,
 accent TEXT NOT NULL
);
CREATE TRIGGER beam_portal_completion_revision BEFORE INSERT ON beam_portal_completions
WHEN NOT EXISTS(SELECT 1 FROM beam_portal_enrollments e WHERE e.id=NEW.enrollment_id AND e.revision_id=NEW.revision_id)
 OR (NEW.assessment_revision_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM beam_assessment_revisions a WHERE a.id=NEW.assessment_revision_id AND a.course_revision_id=NEW.revision_id))
 OR (NEW.attempt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM beam_portal_attempts a WHERE a.id=NEW.attempt_id AND a.enrollment_id=NEW.enrollment_id AND a.assessment_revision_id=NEW.assessment_revision_id AND a.passed=1))
BEGIN SELECT RAISE(ABORT,'portal_completion_revision_mismatch'); END;
