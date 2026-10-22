-- Explicit human-owned retention and erasure. No scheduled destructive action.
ALTER TABLE beam_members ADD COLUMN erasure_pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE beam_members ADD COLUMN erased_at INTEGER;
ALTER TABLE beam_sources ADD COLUMN erased_at INTEGER;
CREATE TABLE beam_erasure_policy (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), assessment_days INTEGER NOT NULL CHECK(assessment_days BETWEEN 0 AND 36500),
 justification TEXT NOT NULL, version INTEGER NOT NULL, changed_at INTEGER NOT NULL
);
CREATE TABLE beam_erasure_holds (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('person','source')), subject_id TEXT NOT NULL,
 justification TEXT NOT NULL, placed_by TEXT NOT NULL, placed_at INTEGER NOT NULL, released_at INTEGER, released_by TEXT
);
CREATE TABLE beam_erasure_jobs (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('person','source')), subject_id TEXT NOT NULL, requested_by TEXT NOT NULL,
 requested_at INTEGER NOT NULL, phase TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','failed','complete')),
 selectors_json TEXT NOT NULL, inventory_json TEXT NOT NULL, retention_json TEXT NOT NULL,
 report_json TEXT NOT NULL DEFAULT '{}', cursor INTEGER NOT NULL DEFAULT 0, continuation TEXT, failure TEXT, version INTEGER NOT NULL DEFAULT 0, lease_until INTEGER
);
CREATE UNIQUE INDEX beam_erasure_active ON beam_erasure_jobs(kind,subject_id) WHERE state!='complete';
CREATE TABLE beam_erasure_files (
 job_id TEXT NOT NULL REFERENCES beam_erasure_jobs(id), sha256 TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
 PRIMARY KEY(job_id,sha256)
);
CREATE TABLE beam_erasure_providers (
 job_id TEXT NOT NULL REFERENCES beam_erasure_jobs(id), connection_id TEXT NOT NULL, actor_name TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending', failure TEXT, PRIMARY KEY(job_id,connection_id,actor_name)
);
CREATE TABLE beam_erasure_tombstones (digest TEXT PRIMARY KEY, job_id TEXT NOT NULL, erased_at INTEGER NOT NULL);

CREATE TABLE beam_erasure_guard (valid INTEGER NOT NULL CHECK(valid=1));
