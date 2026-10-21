-- PACK-006: owner-approved deployments and exact-assignment LTI 1.3 launch/result lineage.
CREATE TABLE beam_lti_tools (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, issuer TEXT NOT NULL, client_id TEXT NOT NULL UNIQUE,
 deployment TEXT NOT NULL, login_url TEXT NOT NULL, redirect_uri TEXT NOT NULL,
 keys_json TEXT NOT NULL, key_version INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL, consent_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE TABLE beam_lti_platform_keys (
 id TEXT PRIMARY KEY, public_json TEXT NOT NULL, private_cipher TEXT NOT NULL,
 created_at INTEGER NOT NULL, retired_at INTEGER
);
CREATE TABLE beam_lti_launches (
 id TEXT PRIMARY KEY, tool_id TEXT NOT NULL REFERENCES beam_lti_tools(id),
 member_id TEXT NOT NULL, course_id TEXT NOT NULL, assignment_id TEXT,
 resource_id TEXT, kind TEXT NOT NULL, data TEXT NOT NULL UNIQUE,
 expires_at INTEGER NOT NULL, authorized_at INTEGER, consumed_at INTEGER
);
CREATE TABLE beam_lti_resources (
 id TEXT PRIMARY KEY, tool_id TEXT NOT NULL REFERENCES beam_lti_tools(id),
 course_id TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL,
 selected_by TEXT NOT NULL, selected_at INTEGER NOT NULL
);
CREATE TABLE beam_lti_lineitems (
 id TEXT PRIMARY KEY, tool_id TEXT NOT NULL REFERENCES beam_lti_tools(id),
 assignment_id TEXT NOT NULL, revision_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 learner_id TEXT NOT NULL, subject TEXT NOT NULL, launched_at INTEGER NOT NULL,
 UNIQUE(assignment_id,resource_id)
);
CREATE TABLE beam_lti_assertions (
 tool_id TEXT NOT NULL REFERENCES beam_lti_tools(id), jti TEXT NOT NULL,
 expires_at INTEGER NOT NULL, PRIMARY KEY(tool_id,jti)
);
CREATE TABLE beam_lti_tokens (
 hash TEXT PRIMARY KEY, tool_id TEXT NOT NULL REFERENCES beam_lti_tools(id),
 expires_at INTEGER NOT NULL
);
CREATE TABLE beam_lti_results (
 id TEXT PRIMARY KEY, lineitem_id TEXT NOT NULL REFERENCES beam_lti_lineitems(id),
 score_given REAL NOT NULL, score_maximum REAL NOT NULL,
 activity_progress TEXT NOT NULL, grading_progress TEXT NOT NULL,
 timestamp TEXT NOT NULL, received_at INTEGER NOT NULL,
 UNIQUE(lineitem_id,timestamp)
);
CREATE TRIGGER beam_restore_disables_lti AFTER UPDATE OF import_job ON rer_portability_state
WHEN OLD.import_job IS NOT NULL AND NEW.import_job IS NULL AND OLD.applying=1 BEGIN
 UPDATE beam_lti_tools SET revoked_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER);
 UPDATE beam_lti_platform_keys SET private_cipher='withheld',retired_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER);
 DELETE FROM beam_lti_tokens;
 UPDATE beam_lti_launches SET consumed_at=0,authorized_at=0;
END;
