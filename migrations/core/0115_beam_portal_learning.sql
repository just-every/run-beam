-- External lesson progress never becomes an employee assignment or completion.
CREATE TABLE beam_portal_lesson_progress (
 enrollment_id TEXT NOT NULL REFERENCES beam_portal_enrollments(id),
 lesson_revision_id TEXT NOT NULL REFERENCES beam_lesson_revisions(id),
 completed_at INTEGER NOT NULL,
 PRIMARY KEY(enrollment_id,lesson_revision_id)
);
CREATE TRIGGER beam_portal_progress_revision BEFORE INSERT ON beam_portal_lesson_progress
WHEN NOT EXISTS(SELECT 1 FROM beam_portal_enrollments e JOIN beam_lesson_revisions l
 ON l.course_revision_id=e.revision_id WHERE e.id=NEW.enrollment_id AND l.id=NEW.lesson_revision_id)
BEGIN SELECT RAISE(ABORT,'portal_lesson_revision_mismatch'); END;
