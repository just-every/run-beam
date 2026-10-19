-- AUTHOR-005 (catalog slice): how the course estate is organised. Folder,
-- tags, learning objectives, language, expected duration, owner and the
-- template mark describe a course in the catalog; they are not part of its
-- reviewed revisions. An archived course is a retired one filed out of the
-- everyday course list; its records stay readable.
ALTER TABLE beam_courses ADD COLUMN folder TEXT;
ALTER TABLE beam_courses ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE beam_courses ADD COLUMN objectives TEXT NOT NULL DEFAULT '[]';
ALTER TABLE beam_courses ADD COLUMN language TEXT NOT NULL DEFAULT 'en';
ALTER TABLE beam_courses ADD COLUMN duration_minutes INTEGER;
ALTER TABLE beam_courses ADD COLUMN owner_id TEXT REFERENCES beam_members(id);
ALTER TABLE beam_courses ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0;
ALTER TABLE beam_courses ADD COLUMN archived_at INTEGER;
