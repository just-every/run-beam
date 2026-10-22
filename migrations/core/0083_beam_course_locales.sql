-- AUTHOR-008 foundation: reviewed, externally prepared alternate revisions, not simulated model generation.
CREATE TABLE beam_locale_glossaries (
 id TEXT PRIMARY KEY,course_id TEXT NOT NULL REFERENCES beam_courses(id),locale TEXT NOT NULL,
 terms_json TEXT NOT NULL,created_by TEXT NOT NULL,created_at INTEGER NOT NULL,
 approved_by TEXT,approved_at INTEGER
);
CREATE TABLE beam_course_locales (
 id TEXT PRIMARY KEY,course_id TEXT NOT NULL REFERENCES beam_courses(id),
 base_revision_id TEXT NOT NULL REFERENCES beam_course_revisions(id),locale TEXT NOT NULL,
 glossary_id TEXT NOT NULL REFERENCES beam_locale_glossaries(id),draft_json TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,state TEXT NOT NULL CHECK(state IN ('draft','in_review','approved')),
 prepared_by TEXT NOT NULL,prepared_at INTEGER NOT NULL,submitted_by TEXT,submitted_at INTEGER,
 approved_by TEXT,approved_at INTEGER,revision_id TEXT UNIQUE REFERENCES beam_course_revisions(id)
);
CREATE INDEX beam_course_locales_selection ON beam_course_locales(base_revision_id,locale,state,approved_at);
CREATE TABLE beam_locale_maintenance (
 id TEXT PRIMARY KEY,locale_id TEXT NOT NULL REFERENCES beam_course_locales(id),
 cause TEXT NOT NULL CHECK(cause IN ('source_changed','base_changed')),
 source_id TEXT,new_version_id TEXT,base_revision_id TEXT NOT NULL,
 event_key TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(locale_id,event_key)
);
