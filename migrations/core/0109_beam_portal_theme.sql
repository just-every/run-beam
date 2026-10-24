-- Owner-managed presentation only; hostname activation remains outside this table.
CREATE TABLE beam_portal_theme (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  primary_color TEXT NOT NULL,
  accent_color TEXT NOT NULL,
  signin_heading TEXT NOT NULL,
  signin_text TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  logo_json TEXT,
  favicon_json TEXT,
  version INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
