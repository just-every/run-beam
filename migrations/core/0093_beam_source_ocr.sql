-- OCR is an explicit owner-approved disclosure of one immutable source version.
CREATE TABLE beam_source_ocr_config (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 key_cipher TEXT, version INTEGER NOT NULL, max_cost_cents INTEGER NOT NULL CHECK(max_cost_cents BETWEEN 0 AND 100000),
 updated_by TEXT NOT NULL REFERENCES beam_members(id), updated_at INTEGER NOT NULL
);
CREATE TABLE beam_source_ocr_runs (
 id TEXT PRIMARY KEY, source_version_id TEXT NOT NULL REFERENCES beam_source_versions(id), sha256 TEXT NOT NULL,
 model TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('running','completed','failed')),
 approved_by TEXT NOT NULL REFERENCES beam_members(id), approved_at INTEGER NOT NULL, config_version INTEGER NOT NULL,
 estimate_cents INTEGER NOT NULL CHECK(estimate_cents>0), max_cost_cents INTEGER NOT NULL CHECK(max_cost_cents>=estimate_cents),
 page_count INTEGER NOT NULL CHECK(page_count BETWEEN 1 AND 60), completed_at INTEGER, result_json TEXT, usage_json TEXT, failure TEXT, provider_response_id TEXT,
 CHECK(state!='completed' OR (result_json IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX beam_source_ocr_active ON beam_source_ocr_runs(source_version_id,sha256) WHERE state IN ('running','completed');
CREATE INDEX beam_source_ocr_source ON beam_source_ocr_runs(source_version_id,approved_at);
-- Archive restore must never resume provider calls or keep usable account keys.
CREATE TRIGGER beam_restore_disables_source_ocr AFTER UPDATE OF import_job ON rer_portability_state
WHEN OLD.import_job IS NOT NULL AND NEW.import_job IS NULL AND OLD.applying=1 BEGIN
 UPDATE beam_source_ocr_config SET enabled=0,key_cipher=NULL,version=version+1;
END;
