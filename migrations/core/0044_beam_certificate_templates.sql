-- LEARN-002: certificate templates, verification links and corrections. A
-- template is immutable once saved (a change is a new template); a course names
-- the template its certificates use, and each certificate keeps the template it
-- was issued with. A verification link is stored only as its token's hash and
-- can be revoked. A correction issues a superseding certificate with its own
-- number and keeps the original.
CREATE TABLE beam_certificate_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  heading TEXT NOT NULL,
  wording TEXT NOT NULL,
  signatory_name TEXT NOT NULL,
  signatory_title TEXT NOT NULL,
  verify_fields TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES beam_members(id),
  created_at INTEGER NOT NULL
);
ALTER TABLE beam_courses ADD COLUMN certificate_template_id TEXT REFERENCES beam_certificate_templates(id);
ALTER TABLE beam_certificates ADD COLUMN template_id TEXT REFERENCES beam_certificate_templates(id);
CREATE TABLE beam_certificate_corrections (
  id TEXT PRIMARY KEY,
  certificate_id TEXT NOT NULL REFERENCES beam_certificates(id),
  number TEXT NOT NULL UNIQUE,
  learner_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  issued_by TEXT NOT NULL REFERENCES beam_members(id),
  issued_at INTEGER NOT NULL
);
CREATE INDEX beam_certificate_corrections_certificate ON beam_certificate_corrections(certificate_id);
CREATE TABLE beam_certificate_links (
  id TEXT PRIMARY KEY,
  certificate_id TEXT NOT NULL REFERENCES beam_certificates(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES beam_members(id),
  created_at INTEGER NOT NULL,
  revoked_by TEXT REFERENCES beam_members(id),
  revoked_at INTEGER
);
CREATE INDEX beam_certificate_links_certificate ON beam_certificate_links(certificate_id);
