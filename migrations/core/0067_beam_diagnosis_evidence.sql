-- AGENT-002: minimized operational observations and withdrawable import receipts.
CREATE TABLE beam_diagnosis_imports (
 id TEXT PRIMARY KEY, course TEXT NOT NULL REFERENCES beam_courses(id), revision TEXT NOT NULL REFERENCES beam_course_revisions(id),
 job_role TEXT NOT NULL, metric TEXT NOT NULL, unit TEXT NOT NULL, from_day TEXT NOT NULL, to_day TEXT NOT NULL, timezone TEXT NOT NULL,
 actor TEXT NOT NULL REFERENCES beam_members(id), reviewer TEXT NOT NULL REFERENCES beam_members(id), imported_at INTEGER NOT NULL,
 filename TEXT NOT NULL, row_count INTEGER NOT NULL, kept INTEGER NOT NULL, refused_json TEXT NOT NULL,
 cohort_json TEXT NOT NULL, trained_json TEXT NOT NULL, question_plan TEXT REFERENCES beam_question_plans(id), withdrawn_at INTEGER
);
CREATE TABLE beam_diagnosis_observations (
 import_id TEXT NOT NULL REFERENCES beam_diagnosis_imports(id), member TEXT NOT NULL REFERENCES beam_members(id),
 on_day TEXT NOT NULL, value REAL, line INTEGER NOT NULL, PRIMARY KEY(import_id, line)
);
CREATE TABLE beam_diagnosis_basis (
 diagnosis TEXT PRIMARY KEY REFERENCES beam_diagnoses(id), import_id TEXT NOT NULL REFERENCES beam_diagnosis_imports(id)
);
