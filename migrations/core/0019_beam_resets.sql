-- LEARN-019: a reset restarts one open assignment. Lesson records move to
-- history under the reset; attempts stay where they are, marked with the reset
-- that closed them, so their responses, decisions and evidence remain intact.
CREATE TABLE beam_assignment_resets (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES beam_assignments(id),
  reset_by TEXT NOT NULL REFERENCES beam_members(id),
  reason TEXT NOT NULL,
  reset_at INTEGER NOT NULL,
  extra_attempts INTEGER NOT NULL
);
CREATE INDEX beam_assignment_resets_assignment ON beam_assignment_resets(assignment_id);
CREATE TABLE beam_lesson_progress_history (
  reset_id TEXT NOT NULL REFERENCES beam_assignment_resets(id),
  assignment_id TEXT NOT NULL REFERENCES beam_assignments(id),
  lesson_revision_id TEXT NOT NULL REFERENCES beam_lesson_revisions(id),
  completed_at INTEGER NOT NULL,
  PRIMARY KEY (reset_id, lesson_revision_id)
);
ALTER TABLE beam_attempts ADD COLUMN reset_id TEXT REFERENCES beam_assignment_resets(id);
