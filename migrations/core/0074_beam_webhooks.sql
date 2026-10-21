-- CONNECT-015: transactional, minimal lifecycle outbox and explicit owner-authorized deliveries.
CREATE TABLE beam_webhook_subscriptions (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, endpoint TEXT NOT NULL,
 teams_json TEXT NOT NULL, courses_json TEXT NOT NULL, events_json TEXT NOT NULL,
 key_cipher TEXT NOT NULL, key_version INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, consent_at INTEGER NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0, revoked_at INTEGER
);
CREATE TABLE beam_webhook_events (
 id TEXT PRIMARY KEY, type TEXT NOT NULL, subject TEXT NOT NULL,
 learner_id TEXT, course_id TEXT NOT NULL, revision_id TEXT NOT NULL,
 teams_json TEXT NOT NULL, data_json TEXT NOT NULL, at INTEGER NOT NULL,
 UNIQUE(type,subject)
);
CREATE TABLE beam_webhook_deliveries (
 id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL REFERENCES beam_webhook_subscriptions(id),
 event_id TEXT NOT NULL REFERENCES beam_webhook_events(id),
 state TEXT NOT NULL DEFAULT 'pending', tries INTEGER NOT NULL DEFAULT 0,
 cycle INTEGER NOT NULL DEFAULT 0, due_at INTEGER NOT NULL, outcome TEXT,
 UNIQUE(subscription_id,event_id)
);
CREATE INDEX beam_webhook_pending ON beam_webhook_deliveries(state,due_at);
CREATE TABLE beam_webhook_attempts (
 id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL REFERENCES beam_webhook_deliveries(id),
 at INTEGER NOT NULL, key_version INTEGER NOT NULL, status INTEGER, outcome TEXT NOT NULL
);
CREATE TRIGGER beam_webhook_fanout AFTER INSERT ON beam_webhook_events WHEN COALESCE((SELECT applying FROM rer_portability_state),0)=0 BEGIN
 INSERT INTO beam_webhook_deliveries(id,subscription_id,event_id,due_at)
 SELECT lower(hex(randomblob(16))),s.id,NEW.id,NEW.at FROM beam_webhook_subscriptions s
 WHERE s.enabled=1 AND s.revoked_at IS NULL
 AND EXISTS(SELECT 1 FROM json_each(s.events_json) WHERE value=NEW.type)
 AND EXISTS(SELECT 1 FROM json_each(s.courses_json) WHERE value=NEW.course_id)
 AND (NEW.learner_id IS NULL OR EXISTS(SELECT 1 FROM json_each(s.teams_json) t JOIN json_each(NEW.teams_json) e ON t.value=e.value));
END;
CREATE TRIGGER beam_webhook_assignment AFTER INSERT ON beam_assignments WHEN COALESCE((SELECT applying FROM rer_portability_state),0)=0 BEGIN
 INSERT INTO beam_webhook_events SELECT 'enrollment:'||NEW.id,'enrollment',NEW.id,NEW.learner_id,NEW.course_id,NEW.course_revision_id,
 (SELECT json_group_array(team_id) FROM beam_team_members WHERE member_id=NEW.learner_id),
 json_object('assignment',NEW.id,'learner',NEW.learner_id,'course',NEW.course_id,'revision',NEW.course_revision_id),NEW.assigned_at;
 INSERT INTO beam_webhook_events SELECT 'renewal:'||NEW.id,'renewal',NEW.id,NEW.learner_id,NEW.course_id,NEW.course_revision_id,
 (SELECT json_group_array(team_id) FROM beam_team_members WHERE member_id=NEW.learner_id),
 json_object('assignment',NEW.id,'learner',NEW.learner_id,'course',NEW.course_id,'revision',NEW.course_revision_id),NEW.assigned_at WHERE NEW.reason='renewal';
END;
CREATE TRIGGER beam_webhook_progress AFTER INSERT ON beam_lesson_progress WHEN COALESCE((SELECT applying FROM rer_portability_state),0)=0 BEGIN
 INSERT INTO beam_webhook_events SELECT 'progress:'||NEW.assignment_id||':'||NEW.lesson_revision_id,'progress',NEW.assignment_id||':'||NEW.lesson_revision_id,a.learner_id,a.course_id,a.course_revision_id,
 (SELECT json_group_array(team_id) FROM beam_team_members WHERE member_id=a.learner_id),
 json_object('assignment',a.id,'learner',a.learner_id,'course',a.course_id,'revision',a.course_revision_id,'lessonsDone',(SELECT COUNT(*) FROM beam_lesson_progress WHERE assignment_id=a.id)),NEW.completed_at FROM beam_assignments a WHERE a.id=NEW.assignment_id;
END;
CREATE TRIGGER beam_webhook_completion AFTER INSERT ON beam_completions WHEN COALESCE((SELECT applying FROM rer_portability_state),0)=0 BEGIN
 INSERT INTO beam_webhook_events SELECT 'completion:'||NEW.id,'completion',NEW.id,NEW.learner_id,NEW.course_id,NEW.course_revision_id,
 (SELECT json_group_array(team_id) FROM beam_team_members WHERE member_id=NEW.learner_id),
 json_object('completion',NEW.id,'assignment',NEW.assignment_id,'learner',NEW.learner_id,'course',NEW.course_id,'revision',NEW.course_revision_id),NEW.completed_at;
END;
CREATE TRIGGER beam_webhook_publication AFTER UPDATE OF state ON beam_course_revisions WHEN NEW.state='published' AND OLD.state<>'published' AND COALESCE((SELECT applying FROM rer_portability_state),0)=0 BEGIN
 INSERT OR IGNORE INTO beam_webhook_events VALUES('publication:'||NEW.id,'publication',NEW.id,NULL,NEW.course_id,NEW.id,'[]',json_object('course',NEW.course_id,'revision',NEW.id),NEW.reviewed_at);
END;
ALTER TABLE beam_automation_controls RENAME TO beam_automation_controls_before_webhook;
CREATE TABLE beam_automation_controls (
 kind TEXT NOT NULL CHECK(kind IN ('follow_on','audience','notification','escalation','renewal','webhook')),
 rule_id TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('automatic','approval')),
 PRIMARY KEY(kind,rule_id)
);
INSERT INTO beam_automation_controls SELECT * FROM beam_automation_controls_before_webhook;
DROP TABLE beam_automation_controls_before_webhook;

CREATE TRIGGER beam_restore_disables_webhooks AFTER UPDATE OF import_job ON rer_portability_state
WHEN OLD.import_job IS NOT NULL AND NEW.import_job IS NULL AND OLD.applying=1 BEGIN
 UPDATE beam_webhook_subscriptions SET enabled=0,key_cipher='withheld';
END;
