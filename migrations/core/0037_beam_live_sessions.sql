-- LIVE-001: scheduled classroom and virtual sessions of a course. A session is
-- one option a learner can choose; it meets once or repeats daily or weekly at
-- the same wall-clock time in its own IANA zone. Every change bumps its
-- iCalendar sequence and is kept as a change; a learner holds at most one
-- registration per course, and switching keeps the earlier one as cancelled.
CREATE TABLE beam_sessions (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES beam_courses(id),
  title TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('classroom', 'virtual')),
  location TEXT NOT NULL,
  join_url TEXT,
  instructor_id TEXT REFERENCES beam_members(id),
  materials TEXT NOT NULL,
  timezone TEXT NOT NULL,
  start_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  repeat TEXT NOT NULL CHECK (repeat IN ('none', 'daily', 'weekly')),
  meetings INTEGER NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL CHECK (state IN ('scheduled', 'cancelled')),
  cancel_reason TEXT,
  created_by TEXT NOT NULL REFERENCES beam_members(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX beam_sessions_course ON beam_sessions(course_id);
CREATE TABLE beam_session_meetings (
  session_id TEXT NOT NULL REFERENCES beam_sessions(id),
  position INTEGER NOT NULL,
  local_date TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, position)
);
CREATE TABLE beam_session_registrations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES beam_sessions(id),
  course_id TEXT NOT NULL REFERENCES beam_courses(id),
  learner_id TEXT NOT NULL REFERENCES beam_members(id),
  assignment_id TEXT NOT NULL REFERENCES beam_assignments(id),
  state TEXT NOT NULL CHECK (state IN ('registered', 'cancelled')),
  registered_at INTEGER NOT NULL,
  ended_at INTEGER,
  end_reason TEXT
);
CREATE UNIQUE INDEX beam_one_session_per_course ON beam_session_registrations(course_id, learner_id) WHERE state = 'registered';
CREATE TABLE beam_session_changes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES beam_sessions(id),
  at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('rescheduled', 'updated', 'cancelled')),
  detail TEXT NOT NULL
);
