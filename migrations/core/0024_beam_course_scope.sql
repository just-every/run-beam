-- ORG-003: authors scoped to one course, reviewer replacement kept as history,
-- and self-review the owner allows per course. A publication or return by the
-- person who submitted the revision is recorded as self-reviewed.
CREATE TABLE beam_course_authors (
  course_id TEXT NOT NULL REFERENCES beam_courses(id),
  member_id TEXT NOT NULL REFERENCES beam_members(id),
  granted_by TEXT NOT NULL REFERENCES beam_members(id),
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (course_id, member_id)
);
CREATE INDEX beam_course_authors_member ON beam_course_authors(member_id);
CREATE TABLE beam_reviewer_changes (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES beam_courses(id),
  previous_reviewer_id TEXT NOT NULL REFERENCES beam_members(id),
  reviewer_id TEXT NOT NULL REFERENCES beam_members(id),
  reason TEXT NOT NULL,
  changed_by TEXT NOT NULL REFERENCES beam_members(id),
  changed_at INTEGER NOT NULL
);
CREATE INDEX beam_reviewer_changes_course ON beam_reviewer_changes(course_id);
ALTER TABLE beam_courses ADD COLUMN self_review INTEGER NOT NULL DEFAULT 0;
ALTER TABLE beam_course_revisions ADD COLUMN self_reviewed INTEGER NOT NULL DEFAULT 0;
