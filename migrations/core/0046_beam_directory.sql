-- ORG-001: the employee learning directory. A person's work email becomes optional (someone without one is identified by
-- their employee id), so the members table is rebuilt; its sign-in account is linked by account id rather than by email,
-- so an email change keeps the same person. Directory fields, owner-defined custom fields (each with its own "managers
-- may read" switch, off by default) and roster conflicts held for resolution sit beside it.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE beam_members_next (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  operator_id TEXT UNIQUE,
  employee_id TEXT UNIQUE,
  preferred_name TEXT,
  mobile TEXT,
  language TEXT,
  employment TEXT NOT NULL DEFAULT 'active' CHECK (employment IN ('active', 'leave', 'terminated')),
  manager_id TEXT REFERENCES beam_members(id),
  job_role TEXT,
  department TEXT,
  location TEXT,
  hire_date TEXT,
  custom_json TEXT NOT NULL DEFAULT '{}'
);
INSERT INTO beam_members_next (id, email, name, created_at, operator_id)
  SELECT m.id, m.email, m.name, m.created_at, (SELECT o.id FROM oa_operators o WHERE lower(o.email) = m.email) FROM beam_members m;
DROP TABLE beam_members;
ALTER TABLE beam_members_next RENAME TO beam_members;
CREATE INDEX beam_members_location ON beam_members(location);
CREATE TABLE beam_directory_fields (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  managers_read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE beam_directory_conflicts (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  holder_id TEXT REFERENCES beam_members(id),
  other_id TEXT NOT NULL REFERENCES beam_members(id),
  row_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES beam_members(id),
  created_at INTEGER NOT NULL,
  resolution TEXT CHECK (resolution IN ('applied', 'dismissed')),
  resolved_by TEXT REFERENCES beam_members(id),
  resolved_at INTEGER
);
-- ORG-010: a custom role may also be limited to locations from the directory.
ALTER TABLE beam_custom_roles ADD COLUMN locations TEXT NOT NULL DEFAULT '[]';
