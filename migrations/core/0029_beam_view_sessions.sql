-- ORG-012: read-only "View as" sessions. Who viewed whom, from when, until
-- when it ends (exit, timeout or lost authority) and why it ended; each start
-- and end is also an audit event (OPS-001).
CREATE TABLE beam_view_sessions (
  id TEXT PRIMARY KEY,
  viewer_id TEXT NOT NULL REFERENCES beam_members(id),
  learner_id TEXT NOT NULL REFERENCES beam_members(id),
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ended_at INTEGER,
  end_reason TEXT
);
CREATE INDEX beam_view_sessions_viewer ON beam_view_sessions(viewer_id);
