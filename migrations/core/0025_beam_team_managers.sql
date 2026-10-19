-- ORG-004: managers hold authority only over the teams they manage. The owner
-- names each team's direct managers; the owner or a direct manager grants
-- temporary coverage that ends on a set instant. A manager's due-date exception
-- moves one open assignment's due date with a reason and keeps the earlier one.
CREATE TABLE beam_team_managers (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES beam_teams(id),
  member_id TEXT NOT NULL REFERENCES beam_members(id),
  kind TEXT NOT NULL CHECK (kind IN ('direct', 'coverage')),
  reason TEXT,
  expires_at INTEGER,
  granted_by TEXT NOT NULL REFERENCES beam_members(id),
  granted_at INTEGER NOT NULL,
  revoked_by TEXT REFERENCES beam_members(id),
  revoked_at INTEGER,
  CHECK (kind = 'direct' OR expires_at IS NOT NULL)
);
CREATE INDEX beam_team_managers_member ON beam_team_managers(member_id);
CREATE INDEX beam_team_managers_team ON beam_team_managers(team_id);
CREATE TABLE beam_due_exceptions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES beam_assignments(id),
  previous_due_date TEXT NOT NULL,
  previous_due_time TEXT NOT NULL,
  previous_due_at INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  due_time TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  reason TEXT NOT NULL,
  approved_by TEXT NOT NULL REFERENCES beam_members(id),
  approved_at INTEGER NOT NULL
);
CREATE INDEX beam_due_exceptions_assignment ON beam_due_exceptions(assignment_id);
