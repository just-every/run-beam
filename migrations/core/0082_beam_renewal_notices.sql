-- AUTO-004: legacy rules stay silent. Consent applies only to subsequent cycles.
ALTER TABLE beam_renewal_rules ADD COLUMN notice_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE beam_renewal_rules ADD COLUMN notice_cost_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE beam_renewal_rules ADD COLUMN notice_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE beam_renewal_rules ADD COLUMN notice_consent_by TEXT;
ALTER TABLE beam_renewal_rules ADD COLUMN notice_consent_at INTEGER;
ALTER TABLE beam_renewal_rules ADD COLUMN notice_activated_at INTEGER;
CREATE TABLE beam_renewal_notices (
 id TEXT PRIMARY KEY,
 rule_id TEXT NOT NULL REFERENCES beam_renewal_rules(id),
 assignment_id TEXT NOT NULL REFERENCES beam_assignments(id),
 learner_id TEXT NOT NULL REFERENCES beam_members(id),
 recipient_id TEXT NOT NULL REFERENCES beam_members(id),
 route TEXT NOT NULL CHECK(route IN ('learner','manager')),
 consent_version INTEGER NOT NULL,
 cost_cents INTEGER NOT NULL,
 consented_by TEXT NOT NULL,
 consented_at INTEGER NOT NULL,
 activated_at INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending',
 outcome TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 language TEXT,
 provider TEXT,
 provider_message_id TEXT,
 sent_at INTEGER,
 send_token TEXT,
 send_started_at INTEGER,
 send_expires_at INTEGER,
 created_at INTEGER NOT NULL,
 UNIQUE(assignment_id,recipient_id,route)
);
CREATE INDEX beam_renewal_notice_pending ON beam_renewal_notices(state,created_at);
-- OPS-004: a restored consent is lineage, never outbound authorization. A fresh
-- consent applies to future cycles only; archived pending work cannot revive.
CREATE TRIGGER beam_restore_fences_renewal_notices AFTER UPDATE OF import_job ON rer_portability_state
WHEN OLD.import_job IS NOT NULL AND NEW.import_job IS NULL AND OLD.applying=1 BEGIN
 UPDATE beam_renewal_rules SET notice_enabled=0,notice_version=notice_version+1,notice_activated_at=NULL;
 UPDATE beam_renewal_notices SET state='held',outcome='outcome_unknown',send_token=NULL,send_expires_at=NULL WHERE state='sending';
 UPDATE beam_renewal_notices SET state='held',outcome='restored' WHERE state IN ('pending','held','failed') AND COALESCE(outcome,'')<>'outcome_unknown';
END;
