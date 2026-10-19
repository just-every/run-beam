-- AUTO-001: dynamic learner audiences. An audience is a fixed rule over directory fields (role, team, manager,
-- location, department, employment state, custom fields, hire and transfer dates) with an optional course it enrolls.
-- Each stint a person spends in an audience is a row, closed with a reason when they leave it; exclusions keep their
-- reason. External-certificate requirements (LIB-006) may apply to audiences as well as teams. A person's transfer date
-- is the day their role, department or location last changed.
CREATE TABLE beam_audiences (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rule_json TEXT NOT NULL,
  course_id TEXT REFERENCES beam_courses(id),
  due_days INTEGER,
  unit_id TEXT REFERENCES beam_units(id),
  state TEXT NOT NULL CHECK (state IN ('draft', 'active', 'paused')),
  created_by TEXT NOT NULL REFERENCES beam_members(id),
  created_at INTEGER NOT NULL,
  previewed_at INTEGER,
  enabled_by TEXT REFERENCES beam_members(id),
  enabled_at INTEGER,
  synced_at INTEGER,
  CHECK (course_id IS NULL OR due_days IS NOT NULL)
);
CREATE TABLE beam_audience_members (
  id TEXT PRIMARY KEY,
  audience_id TEXT NOT NULL REFERENCES beam_audiences(id),
  member_id TEXT NOT NULL REFERENCES beam_members(id),
  joined_at INTEGER NOT NULL,
  assignment_id TEXT REFERENCES beam_assignments(id),
  outcome TEXT NOT NULL CHECK (outcome IN ('member', 'assigned', 'already_open', 'already_completed', 'course_unavailable')),
  left_at INTEGER,
  left_reason TEXT CHECK (left_reason IN ('no_longer_matches', 'on_leave', 'left_business', 'excluded'))
);
CREATE UNIQUE INDEX beam_audience_one_stint ON beam_audience_members(audience_id, member_id) WHERE left_at IS NULL;
CREATE INDEX beam_audience_members_member ON beam_audience_members(member_id);
CREATE TABLE beam_audience_exclusions (
  id TEXT PRIMARY KEY,
  audience_id TEXT NOT NULL REFERENCES beam_audiences(id),
  member_id TEXT NOT NULL REFERENCES beam_members(id),
  reason TEXT NOT NULL,
  excluded_by TEXT NOT NULL REFERENCES beam_members(id),
  excluded_at INTEGER NOT NULL,
  lifted_by TEXT REFERENCES beam_members(id),
  lifted_at INTEGER
);
CREATE UNIQUE INDEX beam_audience_one_exclusion ON beam_audience_exclusions(audience_id, member_id) WHERE lifted_at IS NULL;
ALTER TABLE beam_external_requirements ADD COLUMN audiences TEXT NOT NULL DEFAULT '[]';
ALTER TABLE beam_members ADD COLUMN transfer_date TEXT;
