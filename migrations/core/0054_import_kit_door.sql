-- Base import-kit D1 schema upgrade (runeditrun/base 96c425b, modules/import-kit):
-- the statements the applied import-kit migrations lack. Applying them yields
-- the same schema as a fresh initializeD1ImportStorage.
DROP TRIGGER IF EXISTS ik_d1_stream_revision_update;
CREATE TRIGGER ik_d1_stream_revision_update BEFORE UPDATE ON ik_d1_stream_revisions WHEN NEW.stream_id IS NOT OLD.stream_id OR NEW.destination IS NOT OLD.destination OR NEW.mapping_version IS NOT OLD.mapping_version OR NEW.principal_id IS NOT OLD.principal_id OR NEW.fingerprint IS NOT OLD.fingerprint OR NEW.total IS NOT OLD.total OR NEW.layout_hash IS NOT OLD.layout_hash OR NEW.layout_revision<OLD.layout_revision OR NEW.progress_revision<=OLD.progress_revision OR ((NEW.namespace IS NOT OLD.namespace OR NEW.operation_key IS NOT OLD.operation_key) AND NOT (NEW.namespace='' AND NEW.operation_key='' AND NOT EXISTS(SELECT 1 FROM ik_d1_streams WHERE id=OLD.stream_id) AND EXISTS(SELECT 1 FROM ik_d1_retirements WHERE id=OLD.stream_id AND kind='stream'))) BEGIN SELECT RAISE(ABORT,'IMPORT_STREAM_REVISION_CHANGED'); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_insert BEFORE INSERT ON ik_d1_custody_states WHEN EXISTS(SELECT 1 FROM ik_d1_custody_states WHERE job_id=NEW.job_id OR rowid=NEW.rowid) BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_rowid BEFORE UPDATE ON ik_d1_custody_states WHEN NEW.rowid IS NOT OLD.rowid BEGIN SELECT RAISE(ABORT,'IMPORT_CUSTODY_STATE_CHANGED'); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_job_reuse BEFORE INSERT ON ik_jobs WHEN EXISTS(SELECT 1 FROM ik_jobs WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM ik_d1_retirements WHERE id=NEW.id AND kind='job') BEGIN SELECT RAISE(ABORT,'IMPORT_JOB_ID_REUSED'); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_sources_replace BEFORE INSERT ON ik_sources BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_sources WHERE identity=NEW.identity UNION ALL SELECT job_id FROM ik_sources WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_provenance_replace BEFORE INSERT ON ik_provenance BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_provenance WHERE id=NEW.id UNION ALL SELECT job_id FROM ik_provenance WHERE rowid=NEW.rowid UNION ALL SELECT job_id FROM ik_provenance WHERE NEW.reversed=0 AND reversed=0 AND destination=NEW.destination AND target_kind=NEW.target_kind AND target_id=NEW.target_id); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_d1_history_replace BEFORE INSERT ON ik_d1_history BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_d1_history WHERE id=NEW.id UNION ALL SELECT job_id FROM ik_d1_history WHERE rowid=NEW.rowid UNION ALL SELECT job_id FROM ik_d1_history WHERE successor_id=NEW.successor_id); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_d1_stream_pages_replace BEFORE INSERT ON ik_d1_stream_pages BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_d1_stream_pages WHERE stream_id=NEW.stream_id AND ordinal=NEW.ordinal UNION ALL SELECT job_id FROM ik_d1_stream_pages WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_d1_streams_replace BEFORE INSERT ON ik_d1_streams BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_d1_stream_pages WHERE stream_id=NEW.id OR stream_id IN (SELECT id FROM ik_d1_streams WHERE rowid=NEW.rowid) UNION ALL SELECT p.job_id FROM ik_d1_streams s JOIN ik_d1_stream_pages p ON p.stream_id=s.id WHERE s.destination=NEW.destination AND s.principal_id=NEW.principal_id AND s.operation_key=NEW.operation_key); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_jobs_replace BEFORE INSERT ON ik_jobs BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT id FROM ik_jobs WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_d1_plan_chunks_replace BEFORE INSERT ON ik_d1_plan_chunks BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_d1_plan_chunks WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_d1_creation_plans_replace BEFORE INSERT ON ik_d1_creation_plans BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_d1_creation_plans WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_d1_plan_index_replace BEFORE INSERT ON ik_d1_plan_index BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_d1_plan_index WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_originals_replace BEFORE INSERT ON ik_originals BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_originals WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_d1_original_chunks_replace BEFORE INSERT ON ik_d1_original_chunks BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_d1_original_chunks WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_original_sets_replace BEFORE INSERT ON ik_original_sets BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_original_sets WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_d1_indexed_jobs_replace BEFORE INSERT ON ik_d1_indexed_jobs BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_d1_indexed_jobs WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_d1_reversal_reports_replace BEFORE INSERT ON ik_d1_reversal_reports BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_d1_reversal_reports WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_d1_entries_replace BEFORE INSERT ON ik_d1_entries BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_d1_entries WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_batches_replace BEFORE INSERT ON ik_batches BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_batches WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_d1_erased_sources_replace BEFORE INSERT ON ik_d1_erased_sources BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT i.job_id FROM ik_d1_erased_sources e JOIN ik_jobs j ON j.destination=e.destination JOIN ik_d1_plan_index i ON i.job_id=j.id AND i.source_identity=e.identity WHERE e.rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_d1_erased_targets_replace BEFORE INSERT ON ik_d1_erased_targets BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT i.job_id FROM ik_d1_erased_targets e JOIN ik_jobs j ON j.destination=e.destination JOIN ik_d1_plan_index i ON i.job_id=j.id AND i.target_identity=e.identity WHERE e.rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_sources_update_replace BEFORE UPDATE ON ik_sources BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_sources WHERE identity=NEW.identity UNION ALL SELECT job_id FROM ik_sources WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_provenance_update_replace BEFORE UPDATE ON ik_provenance BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_provenance WHERE id=NEW.id UNION ALL SELECT job_id FROM ik_provenance WHERE rowid=NEW.rowid UNION ALL SELECT job_id FROM ik_provenance WHERE NEW.reversed=0 AND reversed=0 AND destination=NEW.destination AND target_kind=NEW.target_kind AND target_id=NEW.target_id); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_d1_history_update_replace BEFORE UPDATE ON ik_d1_history BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_d1_history WHERE id=NEW.id UNION ALL SELECT job_id FROM ik_d1_history WHERE rowid=NEW.rowid UNION ALL SELECT job_id FROM ik_d1_history WHERE successor_id=NEW.successor_id); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_d1_stream_pages_update_replace BEFORE UPDATE ON ik_d1_stream_pages BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_d1_stream_pages WHERE stream_id=NEW.stream_id AND ordinal=NEW.ordinal UNION ALL SELECT job_id FROM ik_d1_stream_pages WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_d1_streams_update_replace BEFORE UPDATE ON ik_d1_streams BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_d1_stream_pages WHERE stream_id=NEW.id OR stream_id IN (SELECT id FROM ik_d1_streams WHERE rowid=NEW.rowid) UNION ALL SELECT p.job_id FROM ik_d1_streams s JOIN ik_d1_stream_pages p ON p.stream_id=s.id WHERE s.destination=NEW.destination AND s.principal_id=NEW.principal_id AND s.operation_key=NEW.operation_key); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_jobs_update_replace BEFORE UPDATE ON ik_jobs BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT id FROM ik_jobs WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_d1_plan_chunks_update_replace BEFORE UPDATE ON ik_d1_plan_chunks BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_d1_plan_chunks WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_d1_creation_plans_update_replace BEFORE UPDATE ON ik_d1_creation_plans BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_d1_creation_plans WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_d1_plan_index_update_replace BEFORE UPDATE ON ik_d1_plan_index BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_d1_plan_index WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_originals_update_replace BEFORE UPDATE ON ik_originals BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_originals WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_d1_original_chunks_update_replace BEFORE UPDATE ON ik_d1_original_chunks BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_d1_original_chunks WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_original_sets_update_replace BEFORE UPDATE ON ik_original_sets BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_original_sets WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_d1_indexed_jobs_update_replace BEFORE UPDATE ON ik_d1_indexed_jobs BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_d1_indexed_jobs WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_d1_reversal_reports_update_replace BEFORE UPDATE ON ik_d1_reversal_reports BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_d1_reversal_reports WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_d1_entries_update_replace BEFORE UPDATE ON ik_d1_entries BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_d1_entries WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_batches_update_replace BEFORE UPDATE ON ik_batches BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT job_id FROM ik_batches WHERE rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_d1_erased_sources_update_replace BEFORE UPDATE ON ik_d1_erased_sources BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT i.job_id FROM ik_d1_erased_sources e JOIN ik_jobs j ON j.destination=e.destination JOIN ik_d1_plan_index i ON i.job_id=j.id AND i.source_identity=e.identity WHERE e.rowid=NEW.rowid); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_custody_state_ik_d1_erased_targets_update_replace BEFORE UPDATE ON ik_d1_erased_targets BEGIN UPDATE ik_d1_custody_states SET revision=revision+1 WHERE job_id IN (SELECT i.job_id FROM ik_d1_erased_targets e JOIN ik_jobs j ON j.destination=e.destination JOIN ik_d1_plan_index i ON i.job_id=j.id AND i.target_identity=e.identity WHERE e.rowid=NEW.rowid); END;
INSERT INTO ik_d1_assertions(ok) SELECT 0 WHERE EXISTS(SELECT 1 FROM pragma_index_list('ik_door_plans') l WHERE l."unique"=1 AND (SELECT group_concat(name) FROM pragma_index_info(l.name))='installation_id,namespace,bundle_sha256');
CREATE TABLE IF NOT EXISTS ik_door_settings (
    installation_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)));
CREATE TABLE IF NOT EXISTS ik_door_revoked_keys (
    installation_id TEXT NOT NULL, kid TEXT NOT NULL, PRIMARY KEY(installation_id,kid));
CREATE TABLE IF NOT EXISTS ik_door_grants (
    installation_id TEXT NOT NULL, jti TEXT NOT NULL, action TEXT NOT NULL,
    namespace TEXT NOT NULL, kid TEXT NOT NULL, expires INTEGER NOT NULL,
    PRIMARY KEY(installation_id,jti));
CREATE TABLE IF NOT EXISTS ik_door_uploads (
    id TEXT PRIMARY KEY, installation_id TEXT NOT NULL, namespace TEXT NOT NULL,
    name TEXT NOT NULL, bundle_sha256 TEXT NOT NULL, total_bytes INTEGER NOT NULL,
    total_chunks INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ik_door_chunks (
    upload_id TEXT NOT NULL REFERENCES ik_door_uploads(id), ordinal INTEGER NOT NULL,
    sha256 TEXT NOT NULL, size INTEGER NOT NULL, base64 TEXT NOT NULL,
    PRIMARY KEY(upload_id,ordinal));
CREATE TABLE IF NOT EXISTS ik_door_namespaces (
    installation_id TEXT NOT NULL, namespace TEXT NOT NULL, head_id TEXT, pending_id TEXT,
    PRIMARY KEY(installation_id,namespace));
CREATE TABLE IF NOT EXISTS ik_door_plans (
      id TEXT PRIMARY KEY, installation_id TEXT NOT NULL, namespace TEXT NOT NULL,
      bundle_sha256 TEXT NOT NULL, fingerprint TEXT NOT NULL, previous_id TEXT,
      job_id TEXT UNIQUE, snapshot_hash TEXT NOT NULL,
      complete INTEGER NOT NULL DEFAULT 0 CHECK(complete IN (0,1)));
CREATE TABLE IF NOT EXISTS ik_door_plan_chunks (
      plan_id TEXT NOT NULL REFERENCES ik_door_plans(id), ordinal INTEGER NOT NULL,
      body TEXT NOT NULL, PRIMARY KEY(plan_id,ordinal));
CREATE TABLE IF NOT EXISTS ik_door_approvals (
      plan_id TEXT PRIMARY KEY REFERENCES ik_door_plans(id), approval_id TEXT NOT NULL,
      owner TEXT NOT NULL, approved_at TEXT NOT NULL, fingerprint TEXT NOT NULL,
      reviewer TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ik_door_plan_bundle ON ik_door_plans(installation_id,namespace,bundle_sha256);
CREATE TABLE IF NOT EXISTS ik_door_apply_failures (
    plan_id TEXT PRIMARY KEY REFERENCES ik_door_plans(id), reason_code TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ik_door_scopes (
    installation_id TEXT NOT NULL, namespace TEXT NOT NULL, destination TEXT NOT NULL,
    PRIMARY KEY(installation_id,namespace));
