-- AGENT-008: the evaluation Beam prepares by rule when a manager closes an applied intervention's measurement after its
-- window, and the future assignments a manager then retires. Neither changes outcome values or completions.
CREATE TABLE beam_outcome_evaluations (
  plan TEXT PRIMARY KEY REFERENCES beam_outcome_plans(id),
  intervention TEXT NOT NULL REFERENCES beam_agent_proposals(id),
  finding TEXT NOT NULL CHECK (finding IN ('improved', 'no_improvement', 'worse', 'not_measurable')),
  evaluation_json TEXT NOT NULL,
  retirable_json TEXT NOT NULL,
  closed_by TEXT NOT NULL REFERENCES beam_members(id),
  closed_at INTEGER NOT NULL
);
CREATE TABLE beam_outcome_retirements (
  id TEXT PRIMARY KEY,
  plan TEXT NOT NULL REFERENCES beam_outcome_evaluations(plan),
  assignments_json TEXT NOT NULL,
  note TEXT,
  decided_by TEXT NOT NULL REFERENCES beam_members(id),
  decided_at INTEGER NOT NULL
);
CREATE INDEX beam_outcome_retirements_plan ON beam_outcome_retirements(plan, decided_at);
