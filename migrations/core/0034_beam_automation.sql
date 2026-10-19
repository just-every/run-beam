-- AUTO-005: follow-on rules. When a learner is enrolled in, completes or runs out
-- of quiz attempts on a source course, an active rule assigns a target course.
-- A rule is fixed once saved (change it by saving a new one); it runs only after
-- a recorded dry run. Each rule acts at most once per event, so a repeated event
-- or a replay never creates repeated work.
CREATE TABLE beam_automation_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('enrollment', 'completion', 'failure')),
  source_course_id TEXT NOT NULL REFERENCES beam_courses(id),
  target_course_id TEXT NOT NULL REFERENCES beam_courses(id),
  due_days INTEGER NOT NULL CHECK (due_days BETWEEN 1 AND 365),
  min_percent INTEGER CHECK (min_percent BETWEEN 0 AND 100),
  team_id TEXT REFERENCES beam_teams(id),
  unit_id TEXT REFERENCES beam_units(id),
  state TEXT NOT NULL CHECK (state IN ('draft', 'active', 'paused')),
  created_by TEXT NOT NULL REFERENCES beam_members(id),
  created_at INTEGER NOT NULL,
  previewed_at INTEGER,
  preview_json TEXT,
  enabled_by TEXT REFERENCES beam_members(id),
  enabled_at INTEGER,
  CHECK (source_course_id != target_course_id)
);
CREATE INDEX beam_automation_rules_source ON beam_automation_rules(source_course_id, trigger);
CREATE TABLE beam_automation_runs (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES beam_automation_rules(id),
  event_key TEXT NOT NULL,
  learner_id TEXT NOT NULL REFERENCES beam_members(id),
  source_assignment_id TEXT REFERENCES beam_assignments(id),
  outcome TEXT NOT NULL CHECK (outcome IN ('assigned', 'already_open', 'target_unavailable', 'depth_limit')),
  target_assignment_id TEXT REFERENCES beam_assignments(id),
  replay INTEGER NOT NULL CHECK (replay IN (0, 1)),
  at INTEGER NOT NULL,
  UNIQUE (rule_id, event_key)
);
