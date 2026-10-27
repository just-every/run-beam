-- Pending uploads are custody, including bytes written before metadata commits.
-- No expiry may declare an interrupted object write finished.
CREATE TABLE beam_source_uploads (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES beam_sources(id),
  started_at INTEGER NOT NULL
);
CREATE INDEX beam_source_uploads_source ON beam_source_uploads(source_id);
CREATE TRIGGER beam_source_upload_admission
BEFORE INSERT ON beam_source_uploads
WHEN EXISTS(SELECT 1 FROM beam_unavailable_source_refs WHERE source_id=NEW.source_id)
BEGIN SELECT RAISE(ABORT,'source_unavailable'); END;
CREATE TRIGGER beam_source_erasure_upload_admission
BEFORE INSERT ON beam_erasure_jobs
WHEN NEW.kind='source' AND EXISTS(SELECT 1 FROM beam_source_uploads WHERE source_id=NEW.subject_id)
BEGIN SELECT RAISE(ABORT,'source_upload_in_progress'); END;
