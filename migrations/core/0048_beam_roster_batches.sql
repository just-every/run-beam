-- ORG-006: bulk roster changes with a write-free preview. An uploaded CSV or XLSX roster is kept as a batch with its
-- column mapping, options (invite new people with an email; what to do with people missing from the file) and one row
-- per file row or missing person, each with the action the preview showed and, once applied, its outcome. People
-- without a work email carry a username (stored lowercase) for ORG-011 sign-in.
CREATE TABLE beam_roster_batches (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  headers_json TEXT NOT NULL,
  mapping_json TEXT NOT NULL,
  invite INTEGER NOT NULL DEFAULT 0,
  missing TEXT NOT NULL CHECK (missing IN ('keep', 'deactivate')),
  state TEXT NOT NULL CHECK (state IN ('preview', 'applying', 'applied')),
  created_by TEXT NOT NULL REFERENCES beam_members(id),
  created_at INTEGER NOT NULL,
  previewed_at INTEGER NOT NULL,
  applied_at INTEGER
);
CREATE TABLE beam_roster_batch_rows (
  batch_id TEXT NOT NULL REFERENCES beam_roster_batches(id),
  seq INTEGER NOT NULL,
  line INTEGER,
  cells_json TEXT NOT NULL,
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  member_id TEXT REFERENCES beam_members(id),
  state TEXT NOT NULL CHECK (state IN ('planned', 'applying', 'done')),
  outcome TEXT,
  applied_at INTEGER,
  PRIMARY KEY (batch_id, seq)
);
ALTER TABLE beam_members ADD COLUMN username TEXT;
CREATE UNIQUE INDEX beam_members_username ON beam_members(username);
