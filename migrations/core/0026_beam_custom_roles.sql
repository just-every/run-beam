-- ORG-010: custom administrator roles. The owner names a role, ticks its
-- permissions and limits it to chosen teams or business units; holders get
-- exactly that, read on every request, so a change reaches every holder at once.
CREATE TABLE beam_custom_roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  permissions TEXT NOT NULL,
  teams TEXT NOT NULL,
  units TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES beam_members(id),
  created_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL REFERENCES beam_members(id),
  updated_at INTEGER NOT NULL
);
CREATE TABLE beam_custom_role_grants (
  id TEXT PRIMARY KEY,
  role_id TEXT NOT NULL REFERENCES beam_custom_roles(id),
  member_id TEXT NOT NULL REFERENCES beam_members(id),
  granted_by TEXT NOT NULL REFERENCES beam_members(id),
  granted_at INTEGER NOT NULL,
  revoked_by TEXT REFERENCES beam_members(id),
  revoked_at INTEGER
);
CREATE INDEX beam_custom_role_grants_member ON beam_custom_role_grants(member_id);
