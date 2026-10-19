-- LEARN-007: a reviewed skill taxonomy, the courses (and their objectives) and job roles mapped to it, each person's
-- declared goals, recorded diagnostic results and choice to turn off optional personalization, and each approved
-- minimal path with the recommendation inputs it was approved from.
CREATE TABLE beam_skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES beam_members(id),
  created_at INTEGER NOT NULL,
  reviewed_by TEXT REFERENCES beam_members(id),
  reviewed_at INTEGER
);
CREATE TABLE beam_course_skills (
  course_id TEXT NOT NULL REFERENCES beam_courses(id),
  skill_id TEXT NOT NULL REFERENCES beam_skills(id),
  objective TEXT,
  PRIMARY KEY (course_id, skill_id)
);
CREATE TABLE beam_role_skills (
  job_role TEXT NOT NULL,
  skill_id TEXT NOT NULL REFERENCES beam_skills(id),
  PRIMARY KEY (job_role, skill_id)
);
CREATE TABLE beam_skill_goals (
  member_id TEXT NOT NULL REFERENCES beam_members(id),
  skill_id TEXT NOT NULL REFERENCES beam_skills(id),
  declared_at INTEGER NOT NULL,
  PRIMARY KEY (member_id, skill_id)
);
CREATE TABLE beam_skill_diagnostics (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES beam_members(id),
  skill_id TEXT NOT NULL REFERENCES beam_skills(id),
  result TEXT NOT NULL CHECK (result IN ('gap', 'met')),
  note TEXT NOT NULL,
  recorded_by TEXT NOT NULL REFERENCES beam_members(id),
  recorded_at INTEGER NOT NULL
);
CREATE INDEX beam_skill_diagnostics_member ON beam_skill_diagnostics(member_id, skill_id, recorded_at);
CREATE TABLE beam_personalization (
  member_id TEXT PRIMARY KEY REFERENCES beam_members(id),
  opted_out INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE beam_skill_paths (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES beam_members(id),
  courses_json TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  approved_by TEXT NOT NULL REFERENCES beam_members(id),
  approved_at INTEGER NOT NULL
);
