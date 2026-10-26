-- Invitations identify an intended account but do not bind it before human claim.
ALTER TABLE beam_portal_identities ADD COLUMN invited_operator_id TEXT;
ALTER TABLE beam_portal_identities ADD COLUMN bound_at INTEGER;
ALTER TABLE beam_portal_identities ADD COLUMN consent_version INTEGER;
UPDATE beam_portal_identities SET invited_operator_id=operator_id,bound_at=consent_at;
UPDATE beam_portal_identities SET operator_id=NULL WHERE consent_at IS NULL;
-- Old free text cannot substitute for the complete disclosed notice.
ALTER TABLE beam_enterprise_portals ADD COLUMN notice_version INTEGER NOT NULL DEFAULT 0;
UPDATE beam_portal_identities SET consent_at=NULL;
UPDATE beam_portal_administrators SET revoked_at=COALESCE(revoked_at,unixepoch()*1000);
CREATE UNIQUE INDEX beam_portal_invitation_account ON beam_portal_identities(portal_id,invited_operator_id) WHERE invited_operator_id IS NOT NULL;
CREATE TABLE beam_portal_notices (
 portal_id TEXT NOT NULL REFERENCES beam_enterprise_portals(id),
 version INTEGER NOT NULL, disclosure_json TEXT NOT NULL,
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(portal_id,version)
);
CREATE TABLE beam_portal_consent_events (
 id TEXT PRIMARY KEY, portal_id TEXT NOT NULL, identity_id TEXT NOT NULL,
 operator_id TEXT, notice_version INTEGER NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('accept','withdraw')), at INTEGER NOT NULL,
 FOREIGN KEY(portal_id,identity_id) REFERENCES beam_portal_identities(portal_id,id)
);
-- Even archives written before the export policy cannot restore portal admission.
CREATE TRIGGER beam_restore_disconnects_portals AFTER UPDATE OF import_job ON rer_portability_state
WHEN OLD.import_job IS NOT NULL AND NEW.import_job IS NULL AND OLD.applying=1 BEGIN
 UPDATE beam_portal_identities SET operator_id=NULL,invited_operator_id=NULL,bound_at=NULL,
  consent_at=NULL,revoked_at=COALESCE(revoked_at,unixepoch()*1000);
 UPDATE beam_portal_administrators SET revoked_at=COALESCE(revoked_at,unixepoch()*1000);
 UPDATE beam_portal_consent_events SET operator_id=NULL;
END;
