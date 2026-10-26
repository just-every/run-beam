-- Tutor retrieval is explicitly scoped; paid preparation keeps the existing owner gate.
CREATE TABLE beam_tutor_grants (
 course_id TEXT NOT NULL REFERENCES beam_courses(id), source_version_id TEXT NOT NULL REFERENCES beam_source_versions(id),
 enabled INTEGER NOT NULL, version INTEGER NOT NULL, changed_by TEXT NOT NULL REFERENCES beam_members(id), changed_at INTEGER NOT NULL,
 PRIMARY KEY(course_id,source_version_id)
);
CREATE TABLE beam_tutor_questions (
 id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES beam_assignments(id), learner_id TEXT NOT NULL REFERENCES beam_members(id),
 question TEXT NOT NULL, created_at INTEGER NOT NULL, result_json TEXT, thread_id TEXT REFERENCES beam_discussion_threads(id)
);
ALTER TABLE beam_model_runs ADD COLUMN purpose TEXT NOT NULL DEFAULT 'preparation';
CREATE TRIGGER beam_restore_disables_tutor AFTER UPDATE OF import_job ON rer_portability_state
WHEN NEW.import_job IS NOT OLD.import_job BEGIN
 UPDATE beam_tutor_grants SET enabled=0,version=version+1;
 DELETE FROM beam_tutor_questions;
END;
