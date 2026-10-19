-- LEARN-013: optional recognition of learning activity. The owner sets points per finished lesson and course and the
-- badges (finish one course, or a number of courses); the owner or a learning administrator of the group's unit
-- switches on levels and an activity leaderboard for a team or a cohort (an AUTO-001 audience) and sets its challenges.
-- A person appears on a leaderboard only after the one-time notice, and may opt out of public recognition. Points, badges, levels and challenge progress are read from native lesson and course completions only,
-- so nothing here changes completion, attempts, certificates or practice.
CREATE TABLE beam_recognition_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  lesson_points INTEGER NOT NULL,
  course_points INTEGER NOT NULL,
  updated_by TEXT NOT NULL REFERENCES beam_members(id),
  updated_at INTEGER NOT NULL
);
CREATE TABLE beam_badges (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  milestone TEXT NOT NULL CHECK (milestone IN ('course', 'courses')),
  course_id TEXT REFERENCES beam_courses(id),
  courses INTEGER,
  state TEXT NOT NULL CHECK (state IN ('active', 'retired')),
  created_by TEXT NOT NULL REFERENCES beam_members(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE beam_group_recognition (
  kind TEXT NOT NULL CHECK (kind IN ('team', 'audience')),
  group_id TEXT NOT NULL,
  levels INTEGER NOT NULL,
  level_points INTEGER NOT NULL,
  leaderboard INTEGER NOT NULL,
  updated_by TEXT NOT NULL REFERENCES beam_members(id),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (kind, group_id)
);
CREATE TABLE beam_challenges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('team', 'audience')),
  group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  goal INTEGER NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES beam_members(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX beam_challenges_group ON beam_challenges(kind, group_id);
-- Each person's answer to the one-time recognition notice: 'in' once they have seen it, 'out' when they opt out.
CREATE TABLE beam_recognition_choices (
  member_id TEXT PRIMARY KEY REFERENCES beam_members(id),
  choice TEXT NOT NULL CHECK (choice IN ('in', 'out')),
  decided_at INTEGER NOT NULL
);
