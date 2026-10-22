-- CONNECT-004 / LEARN-017 foundation: explicit, manual, language-only read consent.
CREATE TABLE beam_gusto_language_mappings (
 id TEXT PRIMARY KEY,member_id TEXT NOT NULL UNIQUE REFERENCES beam_members(id),
 employee_id TEXT NOT NULL,employee_uuid TEXT NOT NULL,company_uuid TEXT NOT NULL,
 field_id TEXT NOT NULL,environment TEXT NOT NULL CHECK(environment IN ('demo','production')),
 version INTEGER NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,
 consented_by TEXT NOT NULL,consented_at INTEGER NOT NULL,
 last_attempt_at INTEGER,last_synced_at INTEGER,last_outcome TEXT,last_failure TEXT,
 UNIQUE(environment,company_uuid,employee_uuid)
);

-- OPS-004: a copied read consent is lineage; the restored owner must consent again.
CREATE TRIGGER beam_restore_fences_gusto_language AFTER UPDATE OF import_job ON rer_portability_state
WHEN OLD.import_job IS NOT NULL AND NEW.import_job IS NULL AND OLD.applying=1 BEGIN
 UPDATE beam_gusto_language_mappings SET enabled=0,version=version+1,last_outcome='restored',last_failure='Read consent must be renewed after restore.';
END;
