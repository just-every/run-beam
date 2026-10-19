-- AUTO-006: a learner reports a blocker on an open assignment; a manager or
-- administrator within their authority defers or exempts it, with a reason and an
-- end date, under the owner's exception policy. Due dates, completions and
-- evidence are never rewritten: an exception only changes how the record is read
-- while it lasts, and it stays in the record after it ends.
CREATE TABLE beam_exception_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  max_deferral_days INTEGER NOT NULL CHECK (max_deferral_days BETWEEN 1 AND 365),
  max_exemption_days INTEGER NOT NULL CHECK (max_exemption_days BETWEEN 1 AND 730),
  manager_exemptions INTEGER NOT NULL CHECK (manager_exemptions IN (0, 1)),
  updated_by TEXT NOT NULL REFERENCES beam_members(id),
  updated_at INTEGER NOT NULL
);
CREATE TABLE beam_blockers (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES beam_assignments(id),
  learner_id TEXT NOT NULL REFERENCES beam_members(id),
  kind TEXT NOT NULL CHECK (kind IN ('leave', 'access', 'content', 'other')),
  note TEXT NOT NULL,
  reported_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'granted', 'declined')),
  decided_by TEXT REFERENCES beam_members(id),
  decided_at INTEGER,
  decision_reason TEXT
);
CREATE UNIQUE INDEX beam_blockers_open ON beam_blockers(assignment_id) WHERE state = 'open';
CREATE TABLE beam_exceptions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES beam_assignments(id),
  kind TEXT NOT NULL CHECK (kind IN ('deferral', 'exemption')),
  ends_on TEXT NOT NULL,
  ends_at INTEGER NOT NULL,
  reason TEXT NOT NULL,
  blocker_id TEXT REFERENCES beam_blockers(id),
  granted_by TEXT NOT NULL REFERENCES beam_members(id),
  granted_at INTEGER NOT NULL
);
CREATE INDEX beam_exceptions_assignment ON beam_exceptions(assignment_id);
