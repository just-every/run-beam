-- CONNECT-016: an MCP grant is an application credential with the 'mcp' audience and an explicit tool list.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE beam_app_credentials_next (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('roster.read', 'catalog.read', 'enrollments.write', 'reports.read', 'results.write', 'mcp')),
  teams_json TEXT NOT NULL,
  tools_json TEXT NOT NULL DEFAULT '[]',
  secret_sha256 TEXT NOT NULL,
  issued_by TEXT NOT NULL REFERENCES beam_members(id),
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  rotated_at INTEGER,
  revoked_by TEXT REFERENCES beam_members(id),
  revoked_at INTEGER
);
INSERT INTO beam_app_credentials_next (id, name, audience, teams_json, secret_sha256, issued_by, issued_at, expires_at, rotated_at, revoked_by, revoked_at)
  SELECT id, name, audience, teams_json, secret_sha256, issued_by, issued_at, expires_at, rotated_at, revoked_by, revoked_at FROM beam_app_credentials;
DROP TABLE beam_app_credentials;
ALTER TABLE beam_app_credentials_next RENAME TO beam_app_credentials;
