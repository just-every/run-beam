-- Beam learning records. Progress, completion and demonstrated competence are
-- separate: lesson progress never completes a course by itself, and a completion
-- records what happened (method and evidence), never a competence judgement.

CREATE TABLE beam_business (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Members are adult staff identified by their operator-auth email.
CREATE TABLE beam_members (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE beam_member_roles (
  member_id TEXT NOT NULL REFERENCES beam_members(id),
  role TEXT NOT NULL CHECK (role IN ('author', 'reviewer', 'learner', 'manager', 'assessor')),
  PRIMARY KEY (member_id, role)
);
CREATE TABLE beam_teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE beam_team_members (
  team_id TEXT NOT NULL REFERENCES beam_teams(id),
  member_id TEXT NOT NULL REFERENCES beam_members(id),
  PRIMARY KEY (team_id, member_id)
);

-- Owned source material: licence evidence and a responsible reviewer per source,
-- immutable content-addressed versions (bytes live in the FILES bucket).
CREATE TABLE beam_sources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  licence TEXT NOT NULL CHECK (licence IN ('owned', 'licensed', 'permission')),
  licence_evidence TEXT NOT NULL,
  reviewer_id TEXT NOT NULL REFERENCES beam_members(id),
  created_by TEXT NOT NULL REFERENCES beam_members(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE beam_source_versions (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES beam_sources(id),
  number INTEGER NOT NULL,
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  provenance TEXT NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES beam_members(id),
  uploaded_at INTEGER NOT NULL,
  UNIQUE (source_id, number)
);

-- Evidence files attached to practical attempts and offline training records.
CREATE TABLE beam_attachments (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES beam_members(id),
  uploaded_at INTEGER NOT NULL
);

-- A course has one editable draft (version-checked) and immutable revisions.
CREATE TABLE beam_courses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  reviewer_id TEXT NOT NULL REFERENCES beam_members(id),
  created_by TEXT NOT NULL REFERENCES beam_members(id),
  created_at INTEGER NOT NULL,
  draft_json TEXT NOT NULL,
  draft_version INTEGER NOT NULL,
  published_revision_id TEXT
);
CREATE TABLE beam_course_revisions (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES beam_courses(id),
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  draft_version INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('in_review', 'returned', 'published', 'superseded')),
  submitted_by TEXT NOT NULL REFERENCES beam_members(id),
  submitted_at INTEGER NOT NULL,
  reviewed_by TEXT REFERENCES beam_members(id),
  reviewed_at INTEGER,
  review_note TEXT,
  reassignment TEXT,
  UNIQUE (course_id, number)
);
CREATE TABLE beam_lesson_revisions (
  id TEXT PRIMARY KEY,
  course_revision_id TEXT NOT NULL REFERENCES beam_course_revisions(id),
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source_version_ids TEXT NOT NULL,
  UNIQUE (course_revision_id, position)
);
CREATE TABLE beam_assessment_revisions (
  id TEXT PRIMARY KEY,
  course_revision_id TEXT NOT NULL UNIQUE REFERENCES beam_course_revisions(id),
  questions_json TEXT NOT NULL,
  pass_percent INTEGER,
  max_attempts INTEGER,
  practical_instructions TEXT,
  assessor_id TEXT REFERENCES beam_members(id)
);

-- Role paths: each edit publishes a new path revision; assignments keep theirs.
CREATE TABLE beam_paths (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES beam_teams(id),
  current_revision_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE beam_path_revisions (
  id TEXT PRIMARY KEY,
  path_id TEXT NOT NULL REFERENCES beam_paths(id),
  number INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES beam_members(id),
  created_at INTEGER NOT NULL,
  UNIQUE (path_id, number)
);
CREATE TABLE beam_path_requirements (
  path_revision_id TEXT NOT NULL REFERENCES beam_path_revisions(id),
  position INTEGER NOT NULL,
  course_id TEXT NOT NULL REFERENCES beam_courses(id),
  prerequisite_course_id TEXT REFERENCES beam_courses(id),
  due_days INTEGER NOT NULL,
  renewal_days INTEGER,
  PRIMARY KEY (path_revision_id, course_id)
);

-- An assignment binds a learner, a requirement and an exact course revision,
-- with a due date in an explicit time zone.
CREATE TABLE beam_assignments (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES beam_members(id),
  course_id TEXT NOT NULL REFERENCES beam_courses(id),
  course_revision_id TEXT NOT NULL REFERENCES beam_course_revisions(id),
  path_revision_id TEXT REFERENCES beam_path_revisions(id),
  prerequisite_course_id TEXT REFERENCES beam_courses(id),
  renewal_days INTEGER,
  due_date TEXT NOT NULL,
  due_time TEXT NOT NULL,
  timezone TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'completed', 'replaced', 'cancelled')),
  reason TEXT NOT NULL,
  extra_attempts INTEGER NOT NULL DEFAULT 0,
  last_lesson_id TEXT,
  assigned_by TEXT NOT NULL REFERENCES beam_members(id),
  assigned_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX beam_one_open_assignment ON beam_assignments(learner_id, course_id) WHERE status = 'open';
CREATE INDEX beam_assignments_learner ON beam_assignments(learner_id);

CREATE TABLE beam_lesson_progress (
  assignment_id TEXT NOT NULL REFERENCES beam_assignments(id),
  lesson_revision_id TEXT NOT NULL REFERENCES beam_lesson_revisions(id),
  completed_at INTEGER NOT NULL,
  PRIMARY KEY (assignment_id, lesson_revision_id)
);

CREATE TABLE beam_attempts (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES beam_assignments(id),
  assessment_revision_id TEXT NOT NULL REFERENCES beam_assessment_revisions(id),
  kind TEXT NOT NULL CHECK (kind IN ('quiz', 'practical')),
  number INTEGER NOT NULL,
  submitted_at INTEGER NOT NULL,
  score INTEGER,
  max_score INTEGER,
  passed INTEGER,
  scoring_rule TEXT NOT NULL,
  retry_decision TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('scored', 'awaiting_review', 'accepted', 'rejected')),
  evidence_text TEXT,
  attachment_id TEXT REFERENCES beam_attachments(id),
  UNIQUE (assignment_id, kind, number)
);
CREATE TABLE beam_responses (
  attempt_id TEXT NOT NULL REFERENCES beam_attempts(id),
  question_id TEXT NOT NULL,
  answer_json TEXT NOT NULL,
  correct INTEGER NOT NULL,
  PRIMARY KEY (attempt_id, question_id)
);
CREATE TABLE beam_review_decisions (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL UNIQUE REFERENCES beam_attempts(id),
  assessor_id TEXT NOT NULL REFERENCES beam_members(id),
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  note TEXT NOT NULL,
  decided_at INTEGER NOT NULL
);

CREATE TABLE beam_completions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT UNIQUE REFERENCES beam_assignments(id),
  learner_id TEXT NOT NULL REFERENCES beam_members(id),
  course_id TEXT NOT NULL REFERENCES beam_courses(id),
  course_revision_id TEXT NOT NULL REFERENCES beam_course_revisions(id),
  assessment_revision_id TEXT REFERENCES beam_assessment_revisions(id),
  method TEXT NOT NULL CHECK (method IN ('lessons', 'assessed', 'offline')),
  evidence_json TEXT NOT NULL,
  completed_at INTEGER NOT NULL,
  expires_at INTEGER,
  recorded_by TEXT NOT NULL REFERENCES beam_members(id)
);
CREATE INDEX beam_completions_learner ON beam_completions(learner_id);

CREATE TABLE beam_offline_sessions (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES beam_courses(id),
  course_revision_id TEXT NOT NULL REFERENCES beam_course_revisions(id),
  held_on TEXT NOT NULL,
  instructor TEXT NOT NULL,
  location TEXT NOT NULL,
  attested_by TEXT NOT NULL REFERENCES beam_members(id),
  attestation TEXT NOT NULL,
  attachment_id TEXT REFERENCES beam_attachments(id),
  recorded_at INTEGER NOT NULL
);

CREATE TABLE beam_certificates (
  id TEXT PRIMARY KEY,
  completion_id TEXT NOT NULL UNIQUE REFERENCES beam_completions(id),
  number TEXT NOT NULL UNIQUE,
  issuer TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER
);

-- Procedure maintenance: a new source version flags courses citing an older
-- version; proposals carry the input versions they were prepared from.
CREATE TABLE beam_source_notices (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES beam_courses(id),
  source_id TEXT NOT NULL REFERENCES beam_sources(id),
  previous_version_id TEXT NOT NULL REFERENCES beam_source_versions(id),
  new_version_id TEXT NOT NULL REFERENCES beam_source_versions(id),
  state TEXT NOT NULL CHECK (state IN ('open', 'no_material_change', 'draft_updated')),
  note TEXT,
  decided_by TEXT REFERENCES beam_members(id),
  decided_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (course_id, new_version_id)
);
CREATE TABLE beam_proposals (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES beam_courses(id),
  base_draft_version INTEGER NOT NULL,
  input_version_ids TEXT NOT NULL,
  prepared_by TEXT NOT NULL REFERENCES beam_members(id),
  agent TEXT,
  summary TEXT NOT NULL,
  draft_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'accepted', 'declined')),
  decided_by TEXT REFERENCES beam_members(id),
  decided_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Imported history (move-in kits): original identifiers and labels retained,
-- written only through the import kit's journal.
CREATE TABLE beam_imported_history (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  revision TEXT NOT NULL
);

CREATE TABLE beam_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  subject TEXT NOT NULL,
  detail TEXT NOT NULL
);
