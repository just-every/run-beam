-- LIVE-003: a course revision may require session attendance (the share of the
-- session's scheduled minutes, reviewed with the revision). Attendance records
-- are never edited: an amendment adds a record that supersedes the last one,
-- with its reason, so the timeline keeps every decision.
ALTER TABLE beam_course_revisions ADD COLUMN attendance_percent INTEGER;
CREATE TABLE beam_attendance (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES beam_sessions(id),
  registration_id TEXT NOT NULL REFERENCES beam_session_registrations(id),
  learner_id TEXT NOT NULL REFERENCES beam_members(id),
  assignment_id TEXT NOT NULL REFERENCES beam_assignments(id),
  status TEXT NOT NULL CHECK (status IN ('attended', 'partial', 'absent')),
  minutes INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('complete', 'incomplete')),
  note TEXT NOT NULL,
  attachment_id TEXT REFERENCES beam_attachments(id),
  recorded_by TEXT NOT NULL REFERENCES beam_members(id),
  recorded_at INTEGER NOT NULL,
  amends_id TEXT REFERENCES beam_attendance(id),
  amend_reason TEXT,
  superseded_at INTEGER
);
CREATE UNIQUE INDEX beam_attendance_current ON beam_attendance(session_id, learner_id) WHERE superseded_at IS NULL;
CREATE INDEX beam_attendance_assignment ON beam_attendance(assignment_id);
