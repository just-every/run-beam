-- Human-reported delivery evidence is distinct from a provider receipt.
CREATE TABLE beam_recovery_delivery (
 message TEXT PRIMARY KEY REFERENCES beam_escalation_messages(id), status TEXT NOT NULL CHECK(status='bounced'),
 recorded_by TEXT NOT NULL REFERENCES beam_members(id), recorded_at INTEGER NOT NULL
);
