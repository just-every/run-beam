-- LIB-006: certificates people earn outside Beam. The owner defines a
-- requirement for teams, names who reviews it (the person's managers, a named
-- assessor, or the learning administrators of their units) and how many days
-- before expiry to remind. A learner, or their manager for them, uploads a
-- certificate with its file (verified, inert bytes in beam_attachments); it
-- counts only once approved, until its expiry. Rejections and replaced or
-- expired certificates stay.
CREATE TABLE beam_external_requirements (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  teams TEXT NOT NULL,
  reviewer_kind TEXT NOT NULL CHECK (reviewer_kind IN ('manager', 'assessor', 'administrator')),
  reviewer_id TEXT REFERENCES beam_members(id),
  reminder_days INTEGER NOT NULL,
  expires INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES beam_members(id),
  created_at INTEGER NOT NULL,
  CHECK (reviewer_kind != 'assessor' OR reviewer_id IS NOT NULL)
);
CREATE TABLE beam_external_certificates (
  id TEXT PRIMARY KEY,
  requirement_id TEXT NOT NULL REFERENCES beam_external_requirements(id),
  learner_id TEXT NOT NULL REFERENCES beam_members(id),
  issuer TEXT NOT NULL,
  number TEXT NOT NULL,
  issued_on TEXT NOT NULL,
  expires_on TEXT,
  expires_at INTEGER,
  attachment_id TEXT NOT NULL REFERENCES beam_attachments(id),
  uploaded_by TEXT NOT NULL REFERENCES beam_members(id),
  uploaded_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'approved', 'rejected', 'replaced')),
  decided_by TEXT REFERENCES beam_members(id),
  decided_at INTEGER,
  reason TEXT,
  replaced_by TEXT REFERENCES beam_external_certificates(id),
  replaced_at INTEGER
);
CREATE INDEX beam_external_certificates_learner ON beam_external_certificates(learner_id, requirement_id);
