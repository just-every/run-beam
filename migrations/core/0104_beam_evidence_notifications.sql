-- NOTICE-005: retain event-time recipients on the evidence they concern.
ALTER TABLE beam_notification_rules ADD COLUMN event_kind TEXT NOT NULL DEFAULT 'completion' CHECK(event_kind IN ('completion','evidence_pending'));
ALTER TABLE beam_attempts ADD COLUMN notice_resolutions_json TEXT NOT NULL DEFAULT '{}';
