-- AUTHOR-010: moving open assignments to a newly published revision. The earlier
-- assignment ends as replaced and the new one records the move: both revisions,
-- who moved it and when, the lessons whose progress carried over and those that
-- reopened, and whether the assessment was unchanged (its attempts carry over) or
-- changed (unfinished attempts are voided under a move entry in the reset history,
-- kept with their evidence).
CREATE TABLE beam_assignment_moves (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES beam_assignments(id),
  from_assignment TEXT NOT NULL REFERENCES beam_assignments(id),
  from_revision TEXT NOT NULL REFERENCES beam_course_revisions(id),
  to_revision TEXT NOT NULL REFERENCES beam_course_revisions(id),
  assessment TEXT NOT NULL CHECK (assessment IN ('unchanged', 'changed', 'none')),
  carried_lessons TEXT NOT NULL,
  reopened_lessons TEXT NOT NULL,
  voided_attempts TEXT NOT NULL,
  moved_by TEXT NOT NULL REFERENCES beam_members(id),
  moved_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX beam_assignment_moves_to ON beam_assignment_moves(assignment_id);
CREATE INDEX beam_assignment_moves_from ON beam_assignment_moves(from_assignment);
ALTER TABLE beam_assignment_resets ADD COLUMN kind TEXT NOT NULL DEFAULT 'reset' CHECK (kind IN ('reset', 'move'));
