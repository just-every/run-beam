-- Portal preparation is separate from employee membership and learning evidence.
CREATE TABLE beam_enterprise_portals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('employee','customer','partner')),
  name TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  theme_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX beam_employee_portal ON beam_enterprise_portals(kind) WHERE kind='employee';
CREATE TABLE beam_portal_shares (
  portal_id TEXT NOT NULL REFERENCES beam_enterprise_portals(id),
  revision_id TEXT NOT NULL REFERENCES beam_course_revisions(id),
  shared_by TEXT NOT NULL,
  shared_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY(portal_id,revision_id)
);
CREATE TABLE beam_portal_identities (
  id TEXT PRIMARY KEY,
  portal_id TEXT NOT NULL REFERENCES beam_enterprise_portals(id),
  operator_id TEXT,
  display_name TEXT NOT NULL,
  invited_by TEXT NOT NULL,
  invited_at INTEGER NOT NULL,
  consent_at INTEGER,
  revoked_at INTEGER,
  UNIQUE(portal_id,operator_id),
  UNIQUE(portal_id,id)
);
CREATE TABLE beam_portal_administrators (
  portal_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY(portal_id,identity_id),
  FOREIGN KEY(portal_id,identity_id) REFERENCES beam_portal_identities(portal_id,id)
);
CREATE TABLE beam_portal_enrollments (
  id TEXT PRIMARY KEY,
  portal_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  enrolled_by TEXT NOT NULL,
  enrolled_at INTEGER NOT NULL,
  UNIQUE(portal_id,identity_id,revision_id),
  FOREIGN KEY(portal_id,identity_id) REFERENCES beam_portal_identities(portal_id,id),
  FOREIGN KEY(portal_id,revision_id) REFERENCES beam_portal_shares(portal_id,revision_id)
);
