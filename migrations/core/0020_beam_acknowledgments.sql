-- LEARN-010: an acknowledgment or electronic signature asked of one person on
-- one exact source version. Decisions are kept with what was shown, the intent,
-- the signer, the time and how they signed in; a new version asks again in a
-- separate row and leaves earlier ones as they were.
CREATE TABLE beam_acknowledgments (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES beam_sources(id),
  source_version_id TEXT NOT NULL REFERENCES beam_source_versions(id),
  learner_id TEXT NOT NULL REFERENCES beam_members(id),
  kind TEXT NOT NULL CHECK (kind IN ('acknowledgment', 'signature')),
  previous_id TEXT REFERENCES beam_acknowledgments(id),
  requested_by TEXT NOT NULL REFERENCES beam_members(id),
  requested_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'signed', 'declined')),
  viewed_at INTEGER,
  decided_at INTEGER,
  intent TEXT,
  signature TEXT,
  identity_method TEXT,
  decline_reason TEXT,
  UNIQUE (source_version_id, learner_id)
);
CREATE INDEX beam_acknowledgments_learner ON beam_acknowledgments(learner_id);
