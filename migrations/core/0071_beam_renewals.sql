-- AUTO-004: immutable native recurrence rules and retained cycle provenance.
CREATE TABLE beam_renewal_rules (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES beam_courses(id),
 basis TEXT NOT NULL CHECK(basis IN ('expiry','annual')),
 lead_days INTEGER NOT NULL, grace_days INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('draft','active','paused')),
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
 previewed_at INTEGER, enabled_by TEXT, enabled_at INTEGER
);
CREATE UNIQUE INDEX beam_renewal_rule_active ON beam_renewal_rules(course_id) WHERE state='active';
CREATE TABLE beam_renewal_cycles (
 completion_id TEXT PRIMARY KEY REFERENCES beam_completions(id),
 rule_id TEXT NOT NULL REFERENCES beam_renewal_rules(id),
 assignment_id TEXT NOT NULL UNIQUE REFERENCES beam_assignments(id),
 expires_at INTEGER NOT NULL, due_date TEXT NOT NULL, timezone TEXT NOT NULL, created_at INTEGER NOT NULL
);
ALTER TABLE beam_automation_controls RENAME TO beam_automation_controls_before_renewal;
CREATE TABLE beam_automation_controls (
 kind TEXT NOT NULL CHECK(kind IN ('follow_on','audience','notification','escalation','renewal')),
 rule_id TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('automatic','approval')),
 PRIMARY KEY(kind,rule_id)
);
INSERT INTO beam_automation_controls SELECT * FROM beam_automation_controls_before_renewal;
DROP TABLE beam_automation_controls_before_renewal;
