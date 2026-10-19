-- AGENT-003: diagnoses a manager records and someone else reviews, and the intervention kind of agent work that
-- proposes the smallest useful action from one. The proposals table is rebuilt to admit the new kind.
CREATE TABLE beam_diagnoses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  finding TEXT NOT NULL,
  job_role TEXT NOT NULL,
  evidence TEXT NOT NULL,
  recorded_by TEXT NOT NULL REFERENCES beam_members(id),
  recorded_at INTEGER NOT NULL,
  reviewed_by TEXT REFERENCES beam_members(id),
  reviewed_at INTEGER
);
PRAGMA defer_foreign_keys = ON;
CREATE TABLE beam_agent_proposals_next (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('assignment_plan', 'reminders', 'scenario', 'question_plan', 'process_change', 'intervention')),
  title TEXT NOT NULL,
  agent TEXT,
  prepared_by TEXT NOT NULL REFERENCES beam_members(id),
  via_agent INTEGER NOT NULL CHECK (via_agent IN (0, 1)),
  inputs_json TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  excluded_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('waiting', 'approved', 'declined')),
  decided_by TEXT REFERENCES beam_members(id),
  decided_at INTEGER,
  decision_note TEXT,
  result_json TEXT,
  created_at INTEGER NOT NULL
);
INSERT INTO beam_agent_proposals_next SELECT id, kind, title, agent, prepared_by, via_agent, inputs_json, reasons_json, excluded_json, payload_json, payload_sha256, state, decided_by, decided_at, decision_note, result_json, created_at FROM beam_agent_proposals;
DROP TABLE beam_agent_proposals;
ALTER TABLE beam_agent_proposals_next RENAME TO beam_agent_proposals;
CREATE INDEX beam_agent_proposals_state ON beam_agent_proposals(state, created_at);
