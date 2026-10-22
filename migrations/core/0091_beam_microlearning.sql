CREATE TABLE beam_revision_sequences (
 course_revision_id TEXT PRIMARY KEY REFERENCES beam_course_revisions(id), sequence_json TEXT NOT NULL
);
CREATE TABLE beam_sequence_state (
 assignment_id TEXT PRIMARY KEY REFERENCES beam_assignments(id), paused_at INTEGER,
 paused_ms INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE beam_sequence_answers (
 id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES beam_assignments(id), course_revision_id TEXT NOT NULL REFERENCES beam_course_revisions(id),
 day INTEGER NOT NULL, choice INTEGER NOT NULL, next TEXT NOT NULL, feedback TEXT NOT NULL, answered_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX beam_sequence_continued ON beam_sequence_answers(assignment_id,day) WHERE next='continue';
