-- OPS-001: how an audited change was made. NULL is the person's own signed-in
-- session; a change through an agent's preparation credential (BEAM-14) records
-- that credential's delegating session, so the audit names the agent route and
-- the person who delegated it. Corrections are appended as their own events.
ALTER TABLE beam_audit ADD COLUMN via TEXT;
CREATE INDEX beam_audit_subject ON beam_audit(action, subject);
