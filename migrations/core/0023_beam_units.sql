-- ORG-002: business units and delegated learning administrators. A unit holds
-- teams (and through them their people) and courses. The owner grants a member
-- administration of one unit at a time, optionally until an instant; a grant is
-- active until it expires or the owner revokes it, and both stay on record.
CREATE TABLE beam_units (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES beam_members(id),
  created_at INTEGER NOT NULL
);
ALTER TABLE beam_teams ADD COLUMN unit_id TEXT REFERENCES beam_units(id);
ALTER TABLE beam_courses ADD COLUMN unit_id TEXT REFERENCES beam_units(id);
CREATE TABLE beam_admin_grants (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES beam_members(id),
  unit_id TEXT NOT NULL REFERENCES beam_units(id),
  granted_by TEXT NOT NULL REFERENCES beam_members(id),
  granted_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_by TEXT REFERENCES beam_members(id),
  revoked_at INTEGER
);
CREATE INDEX beam_admin_grants_member ON beam_admin_grants(member_id);
