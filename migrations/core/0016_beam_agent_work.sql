-- Work the owner's own agent prepares (through a preparation credential) or a
-- person drafts, and a person approves. Nothing in a proposal reaches staff,
-- assignments or courses until a human records the approval; the proposal row
-- keeps its inputs, reasons, exclusions, exact payload and the decision.
CREATE TABLE beam_agent_proposals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('assignment_plan', 'reminders', 'scenario', 'question_plan', 'process_change')),
  title TEXT NOT NULL,
  agent TEXT,
  prepared_by TEXT NOT NULL REFERENCES beam_members(id),
  via_agent INTEGER NOT NULL CHECK (via_agent IN (0, 1)),
  inputs_json TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  excluded_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('waiting', 'approved', 'declined')),
  decided_by TEXT REFERENCES beam_members(id),
  decided_at INTEGER,
  decision_note TEXT,
  result_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX beam_agent_proposals_state ON beam_agent_proposals(state, created_at);

-- Approved reminder messages, shown in-app to the learner of an open assignment.
CREATE TABLE beam_reminder_messages (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES beam_assignments(id),
  learner_id TEXT NOT NULL REFERENCES beam_members(id),
  body TEXT NOT NULL,
  proposal_id TEXT NOT NULL REFERENCES beam_agent_proposals(id),
  approved_by TEXT NOT NULL REFERENCES beam_members(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX beam_reminder_messages_learner ON beam_reminder_messages(learner_id);

-- Practice scenarios bound to one published course revision. Practice never
-- scores, never completes and never touches attempts or completions.
CREATE TABLE beam_scenarios (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES beam_courses(id),
  course_revision_id TEXT NOT NULL REFERENCES beam_course_revisions(id),
  title TEXT NOT NULL,
  rubric TEXT NOT NULL,
  steps_json TEXT NOT NULL,
  proposal_id TEXT NOT NULL UNIQUE REFERENCES beam_agent_proposals(id),
  approved_by TEXT NOT NULL REFERENCES beam_members(id),
  approved_at INTEGER NOT NULL
);
CREATE TABLE beam_practice_runs (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES beam_scenarios(id),
  learner_id TEXT NOT NULL REFERENCES beam_members(id),
  choices_json TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX beam_practice_runs_learner ON beam_practice_runs(learner_id, scenario_id);

-- Question plans a manager approved. Invitations record only whether someone
-- answered or declined; answers carry no member and no time, and are read only
-- once the plan has closed with enough answers (src/beam/questions.ts).
CREATE TABLE beam_question_plans (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  purpose TEXT NOT NULL,
  questions_json TEXT NOT NULL,
  closes_on TEXT NOT NULL,
  closes_at INTEGER NOT NULL,
  closed_at INTEGER,
  proposal_id TEXT NOT NULL UNIQUE REFERENCES beam_agent_proposals(id),
  approved_by TEXT NOT NULL REFERENCES beam_members(id),
  approved_at INTEGER NOT NULL
);
CREATE TABLE beam_question_invites (
  plan_id TEXT NOT NULL REFERENCES beam_question_plans(id),
  member_id TEXT NOT NULL REFERENCES beam_members(id),
  state TEXT NOT NULL CHECK (state IN ('waiting', 'answered', 'declined')),
  PRIMARY KEY (plan_id, member_id)
);
CREATE TABLE beam_question_answers (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES beam_question_plans(id),
  answers_json TEXT NOT NULL
);

-- Course-draft proposals also show the source passages they rely on and the
-- information the preparer found missing.
ALTER TABLE beam_proposals ADD COLUMN passages_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE beam_proposals ADD COLUMN missing_json TEXT NOT NULL DEFAULT '[]';
