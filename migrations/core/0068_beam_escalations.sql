-- NOTICE-004: an explicit owner policy, durable delivery facts and human resolution.
CREATE TABLE beam_escalation_policy (
 id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, enabled INTEGER NOT NULL,
 reminder_hours INTEGER NOT NULL, manager_hours INTEGER NOT NULL, fallback_hours INTEGER NOT NULL,
 updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE beam_escalation_messages (
 id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES beam_assignments(id),
 recipient_id TEXT NOT NULL REFERENCES beam_members(id), route TEXT NOT NULL,
 status TEXT NOT NULL, sent_at INTEGER NOT NULL,
 UNIQUE(assignment_id,recipient_id,route)
);
CREATE TABLE beam_escalation_resolutions (
 assignment_id TEXT PRIMARY KEY REFERENCES beam_assignments(id), reason TEXT NOT NULL,
 resolved_by TEXT NOT NULL, resolved_at INTEGER NOT NULL
);
