-- NOTICE-005: immutable template versions, durable completion events and private in-app notices.
CREATE TABLE beam_notification_rules (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL,
 recipient TEXT NOT NULL CHECK(recipient IN ('learner','manager')),
 course_id TEXT, team_id TEXT, location TEXT,
 variants_json TEXT NOT NULL, enabled INTEGER NOT NULL, created_by TEXT NOT NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE beam_notification_rule_versions (
 rule_id TEXT NOT NULL REFERENCES beam_notification_rules(id), version INTEGER NOT NULL,
 settings_json TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(rule_id,version)
);
CREATE TABLE beam_notification_events (completion_id TEXT PRIMARY KEY REFERENCES beam_completions(id), at INTEGER NOT NULL);
CREATE TABLE beam_notification_resolutions (
 rule_id TEXT NOT NULL REFERENCES beam_notification_rules(id), completion_id TEXT NOT NULL REFERENCES beam_completions(id),
 recipients_json TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(rule_id,completion_id)
);
CREATE TABLE beam_notification_messages (
 id TEXT PRIMARY KEY, rule_id TEXT NOT NULL REFERENCES beam_notification_rules(id),
 rule_version INTEGER NOT NULL, event_key TEXT NOT NULL, learner_id TEXT NOT NULL,
 recipient_id TEXT NOT NULL, course_id TEXT, subject TEXT NOT NULL, body TEXT NOT NULL,
 language TEXT NOT NULL, test INTEGER NOT NULL, at INTEGER NOT NULL,
 UNIQUE(rule_id,event_key,recipient_id)
);
CREATE INDEX beam_notification_messages_inbox ON beam_notification_messages(recipient_id,at);
CREATE INDEX beam_notification_events_at ON beam_notification_events(at);
-- Add notification controls without changing any applied migration.
ALTER TABLE beam_automation_controls RENAME TO beam_automation_controls_0052;
CREATE TABLE beam_automation_controls (
 kind TEXT NOT NULL CHECK(kind IN ('follow_on','audience','notification')), rule_id TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('automatic','approval')), PRIMARY KEY(kind,rule_id)
);
INSERT INTO beam_automation_controls SELECT * FROM beam_automation_controls_0052;
DROP TABLE beam_automation_controls_0052;
