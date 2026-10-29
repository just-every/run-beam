-- External practical evidence belongs only to its original portal enrollment.
-- Review decisions append to submissions; neither table can rewrite history.
CREATE TABLE beam_portal_practical_submissions (
 id TEXT PRIMARY KEY,
 enrollment_id TEXT NOT NULL REFERENCES beam_portal_enrollments(id),
 assessment_revision_id TEXT NOT NULL REFERENCES beam_assessment_revisions(id),
 submission_token TEXT NOT NULL,
 number INTEGER NOT NULL CHECK(number>0),
 submitted_at INTEGER NOT NULL,
 evidence_text TEXT NOT NULL CHECK(length(trim(evidence_text)) BETWEEN 1 AND 10000),
 UNIQUE(enrollment_id,submission_token),
 UNIQUE(enrollment_id,number)
);
CREATE TABLE beam_portal_practical_decisions (
 id TEXT PRIMARY KEY,
 submission_id TEXT NOT NULL UNIQUE REFERENCES beam_portal_practical_submissions(id),
 assessor_id TEXT NOT NULL REFERENCES beam_members(id),
 decision TEXT NOT NULL CHECK(decision IN ('accepted','rejected')),
 note TEXT NOT NULL CHECK(length(trim(note)) BETWEEN 1 AND 2000),
 decided_at INTEGER NOT NULL
);
CREATE TRIGGER beam_portal_practical_revision BEFORE INSERT ON beam_portal_practical_submissions
WHEN NOT EXISTS(SELECT 1 FROM beam_portal_enrollments e JOIN beam_assessment_revisions a
 ON a.course_revision_id=e.revision_id WHERE e.id=NEW.enrollment_id AND a.id=NEW.assessment_revision_id
 AND length(trim(a.practical_instructions))>0 AND a.assessor_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'portal_practical_revision_mismatch'); END;
CREATE TRIGGER beam_portal_practical_named_assessor BEFORE INSERT ON beam_portal_practical_decisions
WHEN NOT EXISTS(SELECT 1 FROM beam_portal_practical_submissions s JOIN beam_assessment_revisions a
 ON a.id=s.assessment_revision_id WHERE s.id=NEW.submission_id AND a.assessor_id=NEW.assessor_id)
BEGIN SELECT RAISE(ABORT,'portal_practical_assessor_mismatch'); END;
CREATE TRIGGER beam_portal_practical_submission_immutable BEFORE UPDATE ON beam_portal_practical_submissions
BEGIN SELECT RAISE(ABORT,'portal_practical_submission_immutable'); END;
CREATE TRIGGER beam_portal_practical_decision_immutable BEFORE UPDATE ON beam_portal_practical_decisions
BEGIN SELECT RAISE(ABORT,'portal_practical_decision_immutable'); END;
CREATE TRIGGER beam_portal_practical_assessment_immutable BEFORE UPDATE OF course_revision_id,assessor_id ON beam_assessment_revisions
WHEN EXISTS(SELECT 1 FROM beam_portal_practical_submissions s WHERE s.assessment_revision_id=OLD.id)
 AND (NEW.course_revision_id<>OLD.course_revision_id OR NEW.assessor_id IS NOT OLD.assessor_id)
BEGIN SELECT RAISE(ABORT,'portal_practical_assessment_immutable'); END;
CREATE TRIGGER beam_portal_practical_enrollment_immutable BEFORE UPDATE OF id,portal_id,identity_id,revision_id ON beam_portal_enrollments
WHEN EXISTS(SELECT 1 FROM beam_portal_practical_submissions s WHERE s.enrollment_id=OLD.id)
 AND (NEW.id<>OLD.id OR NEW.portal_id<>OLD.portal_id OR NEW.identity_id<>OLD.identity_id OR NEW.revision_id<>OLD.revision_id)
BEGIN SELECT RAISE(ABORT,'portal_practical_enrollment_immutable'); END;
