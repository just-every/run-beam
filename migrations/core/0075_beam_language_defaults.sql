-- LEARN-017: explicit personal preference wins over location, team and installation defaults.
CREATE TABLE beam_language_defaults (
 kind TEXT NOT NULL CHECK(kind IN ('installation','team','location')),
 scope TEXT NOT NULL, language TEXT NOT NULL CHECK(language IN ('en-US','es-US')),
 updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(kind,scope)
);
