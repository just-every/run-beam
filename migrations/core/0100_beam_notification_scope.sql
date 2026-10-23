-- Scoped notification editors and immutable assignment path filtering.
ALTER TABLE beam_notification_rules ADD COLUMN path_id TEXT REFERENCES beam_paths(id);
ALTER TABLE beam_notification_rules ADD COLUMN enabled_by TEXT REFERENCES beam_members(id);
UPDATE beam_notification_rules SET enabled_by=created_by WHERE enabled=1;
