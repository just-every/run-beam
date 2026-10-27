CREATE TABLE beam_microsoft_connection (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),
 tenant_id TEXT NOT NULL, site_id TEXT NOT NULL, drive_id TEXT NOT NULL, hostname TEXT NOT NULL,
 version INTEGER NOT NULL, approved_by TEXT NOT NULL REFERENCES beam_members(id), approved_at INTEGER NOT NULL,
 reason TEXT NOT NULL
);
CREATE TABLE beam_microsoft_sources (
 source_id TEXT PRIMARY KEY REFERENCES beam_sources(id), item_id TEXT NOT NULL,
 connection_version INTEGER NOT NULL, etag TEXT NOT NULL, permissions_json TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN('available','revoked')), checked_at INTEGER NOT NULL,
 UNIQUE(connection_version,item_id)
);
CREATE TRIGGER beam_restore_disables_microsoft AFTER UPDATE OF import_job ON rer_portability_state
WHEN NEW.import_job IS NOT OLD.import_job BEGIN
 UPDATE beam_microsoft_connection SET enabled=0,version=version+1;
 UPDATE beam_microsoft_sources SET state='revoked';
END;
CREATE TRIGGER beam_microsoft_source_admission BEFORE INSERT ON beam_microsoft_sources
WHEN NOT EXISTS(SELECT 1 FROM beam_microsoft_connection c WHERE c.singleton=1 AND c.enabled=1 AND c.version=NEW.connection_version)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;
DROP VIEW beam_unavailable_source_refs;
CREATE VIEW beam_unavailable_source_refs(source_id,version_id) AS
SELECT s.id,v.id FROM beam_sources s LEFT JOIN beam_source_versions v ON v.source_id=s.id
WHERE s.erased_at IS NOT NULL OR EXISTS(
 SELECT 1 FROM beam_erasure_jobs e WHERE e.kind='source' AND e.subject_id=s.id AND e.state!='complete'
) OR EXISTS(
 SELECT 1 FROM beam_microsoft_sources m LEFT JOIN beam_microsoft_connection c ON c.singleton=1
 WHERE m.source_id=s.id AND (m.state='revoked' OR coalesce(c.enabled,0)=0 OR m.connection_version<>c.version)
);
