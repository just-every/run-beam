-- AGENT-004: the named reviewer's retraining decision on a source-change notice: none, or required for chosen job
-- roles by a due date.
ALTER TABLE beam_source_notices ADD COLUMN retraining TEXT CHECK (retraining IN ('none', 'required'));
ALTER TABLE beam_source_notices ADD COLUMN retrain_roles TEXT;
ALTER TABLE beam_source_notices ADD COLUMN retrain_due_on TEXT;
-- The revision whose publication assigned the required retraining.
ALTER TABLE beam_source_notices ADD COLUMN retrain_revision_id TEXT REFERENCES beam_course_revisions(id);
