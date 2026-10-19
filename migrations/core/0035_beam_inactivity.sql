-- AUTO-007: the owner's inactivity policy and the notices it gives. A person who
-- has not signed in for the policy's days, and is in no protected cohort, gets a
-- notice; if they still have not signed in when it runs out, their access is
-- removed through Base (sessions revoked, evidence kept). Each notice records the
-- policy version that gave it and how it ended.
CREATE TABLE beam_inactivity_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  inactive_days INTEGER NOT NULL CHECK (inactive_days BETWEEN 30 AND 730),
  notice_days INTEGER NOT NULL CHECK (notice_days BETWEEN 7 AND 60),
  excluded_teams TEXT NOT NULL,
  excluded_roles TEXT NOT NULL,
  version INTEGER NOT NULL,
  previewed_version INTEGER,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_by TEXT NOT NULL REFERENCES beam_members(id),
  updated_at INTEGER NOT NULL
);
CREATE TABLE beam_inactivity_notices (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES beam_members(id),
  policy_version INTEGER NOT NULL,
  last_sign_in_at INTEGER NOT NULL,
  noticed_at INTEGER NOT NULL,
  deactivate_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'cancelled', 'deactivated')),
  closed_at INTEGER,
  close_reason TEXT
);
CREATE UNIQUE INDEX beam_inactivity_notices_open ON beam_inactivity_notices(member_id) WHERE state = 'open';
