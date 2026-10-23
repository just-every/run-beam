-- Value-free owner decisions; source people/requirements remain in existing import custody.
CREATE TABLE beam_cutover_credit_decisions (
 plan_id TEXT NOT NULL REFERENCES ik_door_plans(id), course_id TEXT NOT NULL REFERENCES beam_courses(id),
 decided_by TEXT NOT NULL REFERENCES beam_members(id), decided_at INTEGER NOT NULL,
 reason TEXT NOT NULL, PRIMARY KEY(plan_id,course_id)
);
CREATE TABLE beam_cutover_approvals (
 id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES ik_door_plans(id),
 basis_sha256 TEXT NOT NULL, approved_by TEXT NOT NULL REFERENCES beam_members(id), approved_at INTEGER NOT NULL,
 reason TEXT NOT NULL
);
-- Restored review lineage cannot authorize a first HRIS run.
ALTER TABLE beam_cutover_approvals ADD COLUMN restored INTEGER NOT NULL DEFAULT 0 CHECK(restored IN (0,1));
CREATE TRIGGER beam_restore_disables_cutover AFTER UPDATE OF import_job ON rer_portability_state
WHEN OLD.import_job IS NOT NULL AND NEW.import_job IS NULL AND OLD.applying=1 BEGIN
 UPDATE beam_cutover_approvals SET restored=1;
END;
