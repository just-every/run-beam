-- NOTICE-005: extend current recipient relationships while retaining versions and private notices.
CREATE TABLE beam_notification_rules_next (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL,
 recipient TEXT NOT NULL CHECK(recipient IN ('learner','manager','assessor','admin')),
 course_id TEXT, team_id TEXT, location TEXT,
 variants_json TEXT NOT NULL, enabled INTEGER NOT NULL, created_by TEXT NOT NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 path_id TEXT REFERENCES beam_paths(id), enabled_by TEXT REFERENCES beam_members(id)
);
CREATE TABLE beam_notification_rule_versions_next (
 rule_id TEXT NOT NULL REFERENCES beam_notification_rules_next(id), version INTEGER NOT NULL,
 settings_json TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(rule_id,version)
);
CREATE TABLE beam_notification_resolutions_next (
 rule_id TEXT NOT NULL REFERENCES beam_notification_rules_next(id), completion_id TEXT NOT NULL REFERENCES beam_completions(id),
 recipients_json TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(rule_id,completion_id)
);
CREATE TABLE beam_notification_messages_next (
 id TEXT PRIMARY KEY, rule_id TEXT NOT NULL REFERENCES beam_notification_rules_next(id),
 rule_version INTEGER NOT NULL, event_key TEXT NOT NULL, learner_id TEXT NOT NULL,
 recipient_id TEXT NOT NULL, course_id TEXT, subject TEXT NOT NULL, body TEXT NOT NULL,
 language TEXT NOT NULL, test INTEGER NOT NULL, at INTEGER NOT NULL,
 UNIQUE(rule_id,event_key,recipient_id)
);
INSERT INTO beam_notification_rules_next SELECT * FROM beam_notification_rules ORDER BY rowid;
INSERT INTO beam_notification_rule_versions_next SELECT * FROM beam_notification_rule_versions ORDER BY rowid;
INSERT INTO beam_notification_resolutions_next SELECT * FROM beam_notification_resolutions ORDER BY rowid;
INSERT INTO beam_notification_messages_next SELECT * FROM beam_notification_messages ORDER BY rowid;
DROP TABLE beam_notification_messages;
DROP TABLE beam_notification_resolutions;
DROP TABLE beam_notification_rule_versions;
DROP TABLE beam_notification_rules;
ALTER TABLE beam_notification_rules_next RENAME TO beam_notification_rules;
ALTER TABLE beam_notification_rule_versions_next RENAME TO beam_notification_rule_versions;
ALTER TABLE beam_notification_resolutions_next RENAME TO beam_notification_resolutions;
ALTER TABLE beam_notification_messages_next RENAME TO beam_notification_messages;
CREATE INDEX beam_notification_messages_inbox ON beam_notification_messages(recipient_id,at);
