-- Owner-visible, value-free scheduler health; no request bodies or provider errors.
CREATE TABLE beam_operational_jobs (
 name TEXT PRIMARY KEY, started_at INTEGER NOT NULL, finished_at INTEGER,
 last_success_at INTEGER, outcome TEXT NOT NULL CHECK(outcome IN ('running','succeeded','failed')),
 failures INTEGER NOT NULL DEFAULT 0
);
