-- AUTHOR-005 (retirement and cloning slice): a retired course keeps its
-- revisions, assignments, completions and certificates readable and its open
-- assignments completable, but no door assigns it anew until it is restored.
-- A clone records the course it was copied from.
ALTER TABLE beam_courses ADD COLUMN retired_at INTEGER;
ALTER TABLE beam_courses ADD COLUMN retired_by TEXT REFERENCES beam_members(id);
ALTER TABLE beam_courses ADD COLUMN retire_reason TEXT;
ALTER TABLE beam_courses ADD COLUMN cloned_from TEXT REFERENCES beam_courses(id);
