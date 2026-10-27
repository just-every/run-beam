ALTER TABLE beam_portal_attempts ADD COLUMN state TEXT NOT NULL DEFAULT 'scored' CHECK(state IN ('awaiting_review','scored'));
CREATE TABLE beam_portal_quiz_reviews (
 attempt_id TEXT PRIMARY KEY REFERENCES beam_portal_attempts(id),
 assessor_id TEXT NOT NULL REFERENCES beam_members(id),
 note TEXT NOT NULL,
 points_json TEXT NOT NULL,
 graded_at INTEGER NOT NULL
);
