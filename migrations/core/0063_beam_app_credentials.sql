-- CONNECT-014: owner-issued application credentials, each with one audience and an optional team scope. Only the
-- SHA-256 of the secret is kept. Idempotent writes keep their first result; usage counts enforce the rate limit.
CREATE TABLE beam_app_credentials (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('roster.read', 'catalog.read', 'enrollments.write', 'reports.read', 'results.write')),
  teams_json TEXT NOT NULL,
  secret_sha256 TEXT NOT NULL,
  issued_by TEXT NOT NULL REFERENCES beam_members(id),
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  rotated_at INTEGER,
  revoked_by TEXT REFERENCES beam_members(id),
  revoked_at INTEGER
);
CREATE TABLE beam_app_requests (
  credential TEXT NOT NULL REFERENCES beam_app_credentials(id),
  idempotency_key TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (credential, idempotency_key)
);
CREATE TABLE beam_app_usage (
  credential TEXT NOT NULL REFERENCES beam_app_credentials(id),
  minute INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (credential, minute)
);
