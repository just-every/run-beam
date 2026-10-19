-- AUTO-008: retained policy snapshots, owner controls and explicit execution attempts.
CREATE TABLE beam_automation_policy (
 id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL,
 paused INTEGER NOT NULL, quiet_start INTEGER NOT NULL, quiet_end INTEGER NOT NULL,
 daily_limit INTEGER NOT NULL, updated_by TEXT, updated_at INTEGER NOT NULL
);
INSERT INTO beam_automation_policy VALUES (1,0,0,0,0,1000,NULL,0);
CREATE TABLE beam_automation_controls (
 kind TEXT NOT NULL CHECK(kind IN ('follow_on','audience')), rule_id TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('automatic','approval')), PRIMARY KEY(kind,rule_id)
);
CREATE TABLE beam_automation_policy_versions (version INTEGER PRIMARY KEY, settings_json TEXT NOT NULL, at INTEGER NOT NULL);
INSERT INTO beam_automation_policy_versions VALUES(0,'{"paused":false,"quietStart":0,"quietEnd":0,"dailyLimit":1000,"externalSpendCents":0,"controls":[]}',0);
CREATE TABLE beam_automation_executions (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, rule_id TEXT NOT NULL, event_key TEXT NOT NULL,
 learner_id TEXT NOT NULL, input_json TEXT NOT NULL, artifact_id TEXT NOT NULL,
 policy_version INTEGER NOT NULL, state TEXT NOT NULL, outcome TEXT NOT NULL,
 failure TEXT, approved_version INTEGER, approved_by TEXT, at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(kind,rule_id,event_key)
);
CREATE TABLE beam_automation_attempts (
 id TEXT PRIMARY KEY, execution_id TEXT NOT NULL REFERENCES beam_automation_executions(id),
 policy_version INTEGER NOT NULL, day TEXT NOT NULL, charged INTEGER NOT NULL,
 outcome TEXT NOT NULL, failure TEXT, at INTEGER NOT NULL
);
CREATE INDEX beam_automation_attempts_day ON beam_automation_attempts(day,charged);
