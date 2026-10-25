-- Paid preparation never grants publication authority.
CREATE TABLE beam_model_config (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), enabled INTEGER NOT NULL DEFAULT 0,
 key_cipher TEXT, version INTEGER NOT NULL, max_cost_cents INTEGER NOT NULL,
 updated_by TEXT NOT NULL REFERENCES beam_members(id), updated_at INTEGER NOT NULL
);
CREATE TABLE beam_model_runs (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('locale','course')),
 course_id TEXT NOT NULL REFERENCES beam_courses(id), digest TEXT NOT NULL, model TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('running','completed','failed')),
 approved_by TEXT NOT NULL REFERENCES beam_members(id), approved_at INTEGER NOT NULL,
 config_version INTEGER NOT NULL, estimate_cents INTEGER NOT NULL, max_cost_cents INTEGER NOT NULL,
 completed_at INTEGER, failure TEXT, usage_json TEXT, provider_response_id TEXT, result_id TEXT
);
CREATE TABLE beam_model_run_sources (
 run_id TEXT NOT NULL REFERENCES beam_model_runs(id), source_version_id TEXT NOT NULL REFERENCES beam_source_versions(id),
 PRIMARY KEY(run_id,source_version_id)
);
CREATE UNIQUE INDEX beam_model_active ON beam_model_runs(kind,course_id,digest) WHERE state='running';
ALTER TABLE beam_course_locales ADD COLUMN subtitles_json TEXT NOT NULL DEFAULT '{}';
CREATE TRIGGER beam_restore_disables_model AFTER UPDATE OF import_job ON rer_portability_state
WHEN NEW.import_job IS NOT OLD.import_job BEGIN
 UPDATE beam_model_config SET enabled=0,key_cipher=NULL,version=version+1;
END;
