-- REPORT-001: the owner's expiring window (days ahead a current record counts as expiring; 30 when unset), and the
-- MOVE-009 credit decisions its coverage counts: one approved decision per mapped course, with its reason and renewal
-- interval, crediting the latest matched imported completion of each person until its credited expiry. Undoing keeps the
-- decision and its people as lineage; imported rows, assignments and completions are never changed.
CREATE TABLE beam_report_settings (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 expiring_days INTEGER NOT NULL CHECK (expiring_days BETWEEN 1 AND 365),
 version INTEGER NOT NULL,
 updated_by TEXT NOT NULL REFERENCES beam_members(id),
 updated_at INTEGER NOT NULL
);
CREATE TABLE beam_history_credits (
 id TEXT PRIMARY KEY,
 course_id TEXT NOT NULL REFERENCES beam_courses(id),
 interval_days INTEGER NOT NULL CHECK (interval_days BETWEEN 1 AND 3650),
 reason TEXT NOT NULL,
 approved_by TEXT NOT NULL REFERENCES beam_members(id),
 approved_at INTEGER NOT NULL,
 undone_by TEXT REFERENCES beam_members(id),
 undone_at INTEGER,
 undo_reason TEXT
);
CREATE TABLE beam_history_credit_people (
 credit_id TEXT NOT NULL REFERENCES beam_history_credits(id),
 member_id TEXT NOT NULL REFERENCES beam_members(id),
 history_id TEXT NOT NULL,
 source TEXT NOT NULL,
 completed_on TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 PRIMARY KEY (credit_id, member_id)
);
CREATE INDEX beam_history_credit_people_member ON beam_history_credit_people(member_id);
