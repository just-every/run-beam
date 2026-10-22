CREATE TABLE beam_xapi_connections (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, endpoint TEXT NOT NULL,
 authorization_sealed TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES beam_members(id),
 consent_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE TABLE beam_xapi_activities (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES beam_courses(id),
 connection_id TEXT NOT NULL REFERENCES beam_xapi_connections(id), title TEXT NOT NULL,
 activity_iri TEXT NOT NULL, launch_url TEXT NOT NULL, objectives TEXT NOT NULL,
 source_version_ids TEXT NOT NULL, producer_sealed TEXT NOT NULL,
 rule TEXT NOT NULL CHECK(rule='completed-and-passed'), created_by TEXT NOT NULL REFERENCES beam_members(id),
 created_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE TABLE beam_revision_xapi (
 course_revision_id TEXT NOT NULL REFERENCES beam_course_revisions(id),
 activity_id TEXT NOT NULL REFERENCES beam_xapi_activities(id), position INTEGER NOT NULL,
 PRIMARY KEY(course_revision_id,activity_id)
);
CREATE TABLE beam_xapi_launches (
 id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES beam_assignments(id),
 activity_id TEXT NOT NULL REFERENCES beam_xapi_activities(id), actor_id TEXT NOT NULL REFERENCES beam_members(id),
 auth_session_id TEXT NOT NULL, registration TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, ended_at INTEGER, outcome TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE beam_xapi_statements (
 id TEXT PRIMARY KEY, launch_id TEXT NOT NULL REFERENCES beam_xapi_launches(id),
 digest TEXT NOT NULL, original_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','accepted','refused')),
 received_at INTEGER NOT NULL, accepted_at INTEGER, lrs_stored TEXT, failure TEXT
);
CREATE TABLE beam_xapi_attachments (
 statement_id TEXT NOT NULL REFERENCES beam_xapi_statements(id), sha256 TEXT NOT NULL,
 size INTEGER NOT NULL, media_type TEXT NOT NULL, filename TEXT NOT NULL,
 PRIMARY KEY(statement_id,sha256)
);
CREATE INDEX beam_xapi_launch_assignment ON beam_xapi_launches(assignment_id,activity_id,created_at);
