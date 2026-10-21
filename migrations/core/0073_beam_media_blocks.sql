-- Published media belongs to its exact immutable lesson revision.
ALTER TABLE beam_lesson_revisions ADD COLUMN blocks_json TEXT NOT NULL DEFAULT '[]';
CREATE TABLE beam_embed_policy (id INTEGER PRIMARY KEY CHECK (id = 1), hosts TEXT NOT NULL, version INTEGER NOT NULL);
