CREATE TABLE beam_cmi5_packages (
 package_id TEXT PRIMARY KEY REFERENCES beam_packages(id), connection_id TEXT NOT NULL REFERENCES beam_xapi_connections(id),
 consent_by TEXT NOT NULL REFERENCES beam_members(id), consent_at INTEGER NOT NULL
);
CREATE TABLE beam_cmi5_registrations (
 assignment_id TEXT NOT NULL REFERENCES beam_assignments(id), package_id TEXT NOT NULL REFERENCES beam_packages(id),
 registration TEXT NOT NULL UNIQUE, PRIMARY KEY(assignment_id,package_id)
);
CREATE TABLE beam_cmi5_sessions (
 session_id TEXT PRIMARY KEY REFERENCES beam_package_sessions(id), registration TEXT NOT NULL,
 session_uuid TEXT NOT NULL UNIQUE, fetch_hash TEXT NOT NULL, auth_hash TEXT, fetched_at INTEGER,
 active_registration TEXT UNIQUE, lifecycle TEXT NOT NULL DEFAULT 'launching', resumed INTEGER NOT NULL, busy INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE beam_cmi5_statements (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES beam_cmi5_sessions(session_id),
 digest TEXT NOT NULL, original_json TEXT NOT NULL, verb TEXT NOT NULL, status TEXT NOT NULL,
 received_at INTEGER NOT NULL, accepted_at INTEGER, lrs_stored TEXT, failure TEXT
);
CREATE TABLE beam_cmi5_state (
 assignment_id TEXT NOT NULL REFERENCES beam_assignments(id), package_id TEXT NOT NULL REFERENCES beam_packages(id),
 sco_id TEXT NOT NULL, state_id TEXT NOT NULL, body TEXT NOT NULL, etag TEXT NOT NULL,
 PRIMARY KEY(assignment_id,package_id,sco_id,state_id)
);
CREATE TRIGGER beam_restore_disables_cmi5 AFTER UPDATE OF import_job ON rer_portability_state
WHEN OLD.import_job IS NOT NULL AND NEW.import_job IS NULL AND OLD.applying=1 BEGIN
 UPDATE beam_package_sessions SET initial_json='{}' WHERE id IN (SELECT session_id FROM beam_cmi5_sessions);
 UPDATE beam_cmi5_sessions SET fetch_hash='withheld',auth_hash=NULL,lifecycle='restored',busy=0,active_registration=NULL;
END;
