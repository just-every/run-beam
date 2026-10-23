-- Explicit human grants carry only operational scope, never raw customer records.
CREATE TABLE beam_error_feeds (
 id TEXT PRIMARY KEY, actor TEXT NOT NULL REFERENCES beam_members(id), course TEXT NOT NULL REFERENCES beam_courses(id),
 job_role TEXT NOT NULL, teams_json TEXT NOT NULL, authorized_at INTEGER NOT NULL, revoked_at INTEGER
);
ALTER TABLE beam_diagnosis_imports ADD COLUMN feed TEXT REFERENCES beam_error_feeds(id);
ALTER TABLE beam_diagnosis_observations ADD COLUMN record_id TEXT;

-- A concurrent revocation cannot be followed by admission into the revoked grant.
CREATE TRIGGER beam_error_feed_import_guard BEFORE INSERT ON beam_diagnosis_imports
WHEN NEW.feed IS NOT NULL AND NOT EXISTS (SELECT 1 FROM beam_error_feeds WHERE id=NEW.feed AND revoked_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'feed_revoked'); END;
CREATE TRIGGER beam_error_feed_observation_guard BEFORE INSERT ON beam_diagnosis_observations
WHEN EXISTS (SELECT 1 FROM beam_diagnosis_imports WHERE id=NEW.import_id AND withdrawn_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'import_withdrawn'); END;
