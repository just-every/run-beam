-- AGENT-005: a measurement plan chosen before an intervention is applied, and the operational outcome values imported
-- for the people it covers. Values are kept per person and period for the comparison and never read back per person.
CREATE TABLE beam_outcome_plans (
  id TEXT PRIMARY KEY,
  intervention TEXT NOT NULL REFERENCES beam_agent_proposals(id),
  metric TEXT NOT NULL,
  unit TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('higher', 'lower')),
  baseline_from TEXT NOT NULL,
  baseline_to TEXT NOT NULL,
  after_from TEXT NOT NULL,
  after_to TEXT NOT NULL,
  comparison TEXT NOT NULL CHECK (comparison IN ('rest_of_role', 'none')),
  min_group INTEGER NOT NULL CHECK (min_group BETWEEN 3 AND 50),
  prepared_by TEXT NOT NULL REFERENCES beam_members(id),
  via_agent INTEGER NOT NULL CHECK (via_agent IN (0, 1)),
  prepared_at INTEGER NOT NULL,
  approved_by TEXT REFERENCES beam_members(id),
  approved_at INTEGER,
  cohort_json TEXT
);
CREATE UNIQUE INDEX beam_outcome_plans_approved ON beam_outcome_plans(intervention) WHERE approved_at IS NOT NULL;
CREATE TABLE beam_outcome_values (
  plan TEXT NOT NULL REFERENCES beam_outcome_plans(id),
  member TEXT NOT NULL REFERENCES beam_members(id),
  observed_on TEXT NOT NULL,
  value REAL,
  imported_by TEXT NOT NULL REFERENCES beam_members(id),
  imported_at INTEGER NOT NULL,
  PRIMARY KEY (plan, member, observed_on)
);
CREATE TABLE beam_outcome_changes (
  id TEXT PRIMARY KEY,
  plan TEXT NOT NULL REFERENCES beam_outcome_plans(id),
  changed_on TEXT NOT NULL,
  description TEXT NOT NULL,
  recorded_by TEXT NOT NULL REFERENCES beam_members(id),
  recorded_at INTEGER NOT NULL
);
