-- AUTO-009: course access windows. A rule on a course or a path gives each new
-- assignment its window when it is created (renewals included); an admin can set
-- one assignment's window directly. A manager's extension moves only the close
-- and is kept with who extended it, by how much and why.
CREATE TABLE beam_access_rules (
  scope TEXT NOT NULL CHECK (scope IN ('course', 'path')),
  target_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('after_enrolment', 'dates')),
  close_days INTEGER,
  open_date TEXT,
  close_date TEXT,
  timezone TEXT,
  set_by TEXT NOT NULL REFERENCES beam_members(id),
  set_at INTEGER NOT NULL,
  PRIMARY KEY (scope, target_id)
);
ALTER TABLE beam_assignments ADD COLUMN access_opens_at INTEGER;
ALTER TABLE beam_assignments ADD COLUMN access_closes_at INTEGER;
ALTER TABLE beam_assignments ADD COLUMN access_rule TEXT;
CREATE TABLE beam_access_extensions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES beam_assignments(id),
  days INTEGER NOT NULL,
  reason TEXT NOT NULL,
  previous_closes_at INTEGER NOT NULL,
  closes_at INTEGER NOT NULL,
  extended_by TEXT NOT NULL REFERENCES beam_members(id),
  extended_at INTEGER NOT NULL
);
CREATE INDEX beam_access_extensions_assignment ON beam_access_extensions(assignment_id);
