-- LIVE-002: session seats, registration deadlines and waitlists. A session with
-- a capacity holds that many seats: registered learners plus open seat offers.
-- Waitlist entries are kept with every state they pass through, and every
-- registration, waitlist and offer step is kept as a roster event.
ALTER TABLE beam_sessions ADD COLUMN capacity INTEGER;
ALTER TABLE beam_sessions ADD COLUMN registration_closes_at INTEGER;
ALTER TABLE beam_sessions ADD COLUMN waitlist_policy TEXT NOT NULL DEFAULT 'offer' CHECK (waitlist_policy IN ('offer', 'assign'));
ALTER TABLE beam_sessions ADD COLUMN waitlist_order TEXT NOT NULL DEFAULT 'joined' CHECK (waitlist_order IN ('joined', 'due'));
ALTER TABLE beam_sessions ADD COLUMN offer_hours INTEGER NOT NULL DEFAULT 24;
CREATE TABLE beam_session_waitlist (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES beam_sessions(id),
  course_id TEXT NOT NULL REFERENCES beam_courses(id),
  learner_id TEXT NOT NULL REFERENCES beam_members(id),
  assignment_id TEXT NOT NULL REFERENCES beam_assignments(id),
  state TEXT NOT NULL CHECK (state IN ('waiting', 'offered', 'accepted', 'assigned', 'declined', 'expired', 'withdrawn', 'closed')),
  joined_at INTEGER NOT NULL,
  offered_at INTEGER,
  offer_expires_at INTEGER,
  ended_at INTEGER
);
CREATE UNIQUE INDEX beam_one_wait_per_session ON beam_session_waitlist(session_id, learner_id) WHERE state IN ('waiting', 'offered');
CREATE TABLE beam_session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES beam_sessions(id),
  learner_id TEXT NOT NULL REFERENCES beam_members(id),
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL
);
CREATE INDEX beam_session_events_session ON beam_session_events(session_id, at);
