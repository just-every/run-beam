-- NOTICE-004 inherits AUTO-008's per-rule automatic versus approval control.
ALTER TABLE beam_automation_controls RENAME TO beam_automation_controls_before_escalation;
CREATE TABLE beam_automation_controls (
 kind TEXT NOT NULL CHECK(kind IN ('follow_on','audience','notification','escalation')),
 rule_id TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('automatic','approval')),
 PRIMARY KEY(kind,rule_id)
);
INSERT INTO beam_automation_controls SELECT * FROM beam_automation_controls_before_escalation;
DROP TABLE beam_automation_controls_before_escalation;
