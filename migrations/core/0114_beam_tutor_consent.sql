-- Existing grants require explicit rights qualification before any further paid use.
ALTER TABLE beam_tutor_grants ADD COLUMN rights_confirmed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE beam_tutor_questions ADD COLUMN consent_version INTEGER NOT NULL DEFAULT 0;
