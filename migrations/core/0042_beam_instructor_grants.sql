-- ORG-005 (instructor half): the owner, or a unit's learning administrator for
-- that unit's courses, grants a person instructor access, optionally until an
-- end. Only an active holder can be named as a session's instructor, and an
-- instructor keeps the roster and attendance of their sessions only while the
-- grant lasts; their earlier records stay.
CREATE TABLE beam_instructor_grants (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES beam_members(id),
  unit_id TEXT REFERENCES beam_units(id),
  expires_at INTEGER,
  granted_by TEXT NOT NULL REFERENCES beam_members(id),
  granted_at INTEGER NOT NULL,
  revoked_by TEXT REFERENCES beam_members(id),
  revoked_at INTEGER
);
CREATE INDEX beam_instructor_grants_member ON beam_instructor_grants(member_id);
