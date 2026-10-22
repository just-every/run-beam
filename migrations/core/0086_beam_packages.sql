CREATE TABLE beam_packages (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES beam_courses(id), standard TEXT NOT NULL,
 title TEXT NOT NULL, manifest_json TEXT NOT NULL, source_version_ids TEXT NOT NULL,
 licence TEXT NOT NULL, licence_evidence TEXT NOT NULL, export_restriction TEXT,
 original_filename TEXT NOT NULL, original_sha256 TEXT NOT NULL, original_size INTEGER NOT NULL,
 created_by TEXT NOT NULL REFERENCES beam_members(id), created_at INTEGER NOT NULL
);
CREATE TABLE beam_package_assets (
 package_id TEXT NOT NULL REFERENCES beam_packages(id), path TEXT NOT NULL, sha256 TEXT NOT NULL,
 size INTEGER NOT NULL, media_type TEXT NOT NULL, PRIMARY KEY(package_id,path)
);
CREATE TABLE beam_revision_packages (
 course_revision_id TEXT NOT NULL REFERENCES beam_course_revisions(id), package_id TEXT NOT NULL REFERENCES beam_packages(id),
 position INTEGER NOT NULL, PRIMARY KEY(course_revision_id,package_id)
);
CREATE TABLE beam_package_runs (
 id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES beam_assignments(id), package_id TEXT NOT NULL REFERENCES beam_packages(id),
 sco_id TEXT NOT NULL, state_json TEXT NOT NULL, total_time REAL NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL, UNIQUE(assignment_id,package_id,sco_id)
);
CREATE TABLE beam_package_sessions (
 id TEXT PRIMARY KEY, run_id TEXT REFERENCES beam_package_runs(id), package_id TEXT NOT NULL REFERENCES beam_packages(id),
 sco_id TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES beam_members(id), auth_session_id TEXT NOT NULL, preview INTEGER NOT NULL DEFAULT 0,
 expires_at INTEGER NOT NULL, ended_at INTEGER, initial_json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE beam_package_events (
 id TEXT PRIMARY KEY, run_id TEXT REFERENCES beam_package_runs(id), session_id TEXT NOT NULL REFERENCES beam_package_sessions(id),
 event TEXT NOT NULL, payload_json TEXT NOT NULL, at INTEGER NOT NULL
);
