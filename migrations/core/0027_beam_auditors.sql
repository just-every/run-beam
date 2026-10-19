-- ORG-005 (auditor half): the owner shares one cohort's training evidence (its
-- teams' people, completions within a period) with an auditor until a set end.
-- The auditor reads it and downloads its files, each checked individually;
-- nothing else, and nothing after the grant ends or is revoked.
CREATE TABLE beam_auditor_grants (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES beam_members(id),
  teams TEXT NOT NULL,
  period_from INTEGER NOT NULL,
  period_to INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  granted_by TEXT NOT NULL REFERENCES beam_members(id),
  granted_at INTEGER NOT NULL,
  revoked_by TEXT REFERENCES beam_members(id),
  revoked_at INTEGER
);
CREATE INDEX beam_auditor_grants_member ON beam_auditor_grants(member_id);
