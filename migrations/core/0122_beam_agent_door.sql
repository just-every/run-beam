CREATE TABLE IF NOT EXISTS agent_door_state (
  id INTEGER PRIMARY KEY CHECK(id=1), envelope TEXT, local_document TEXT,
  local_revision INTEGER NOT NULL DEFAULT 0, local_paused INTEGER NOT NULL DEFAULT 0,
  decision_lock TEXT, decision_until INTEGER
);
CREATE TABLE IF NOT EXISTS agent_door_agents (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, specialist TEXT, sponsor TEXT NOT NULL,
  sponsor_name TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
  window INTEGER NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS agent_door_audit (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, at TEXT NOT NULL,
  agent TEXT NOT NULL, classes TEXT NOT NULL, row TEXT NOT NULL, evidence TEXT
);
CREATE INDEX IF NOT EXISTS agent_door_audit_agent ON agent_door_audit(agent,sequence);
CREATE TABLE IF NOT EXISTS agent_door_calls (
  agent TEXT NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL, decision_id TEXT NOT NULL,
  created_at INTEGER NOT NULL, state TEXT NOT NULL, outcome TEXT, PRIMARY KEY(agent,key)
);
CREATE TABLE IF NOT EXISTS agent_door_approvals (
  id TEXT PRIMARY KEY, state TEXT NOT NULL, saved TEXT NOT NULL, approvals TEXT NOT NULL DEFAULT '[]',
  result TEXT, version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS agent_door_reviews (
  id TEXT PRIMARY KEY, state TEXT NOT NULL, saved TEXT NOT NULL, marked_by TEXT, marked_at TEXT
);
CREATE TABLE IF NOT EXISTS agent_door_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, uri TEXT NOT NULL, event TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_door_events_uri ON agent_door_events(uri,sequence);
CREATE TABLE IF NOT EXISTS agent_door_usage (
  decision_id TEXT PRIMARY KEY, at INTEGER NOT NULL, seed TEXT NOT NULL, specialist TEXT, agent TEXT NOT NULL,
  classes TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_door_usage_day ON agent_door_usage(at);
CREATE TABLE bs_settings (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  rev INTEGER NOT NULL DEFAULT 0,
  document TEXT,
  applied_at TEXT,
  stopped INTEGER NOT NULL DEFAULT 0 CHECK(stopped IN(0,1)),
  token TEXT NOT NULL DEFAULT ''
);
CREATE TABLE bs_overrides (
  field TEXT PRIMARY KEY CHECK(field IN('display_name','owner_name','brand_color','logo','timezone')),
  value TEXT NOT NULL,
  actor TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
CREATE TABLE bs_logo (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  sha256 TEXT NOT NULL,
  type TEXT NOT NULL,
  bytes BLOB NOT NULL
);
CREATE TABLE bs_team (
  email TEXT PRIMARY KEY,
  operator_id TEXT,
  invite INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN('invited','active','inactive','conflict'))
);
CREATE TABLE bs_audit (
  id INTEGER PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  field TEXT,
  changed_at TEXT NOT NULL
);
-- An INSERT of NULL fails the transaction if a concurrent write invalidated its fence.
CREATE TABLE bs_assert (value INTEGER NOT NULL);
ALTER TABLE bs_settings ADD COLUMN owner_id TEXT CHECK(owner_id IS NULL OR owner_id <> '');
ALTER TABLE bs_team ADD COLUMN business_id TEXT CHECK(business_id IS NULL OR business_id <> '');
ALTER TABLE bs_team ADD COLUMN business_role TEXT CHECK(business_role IS NULL OR business_role IN('admin','member'));
CREATE UNIQUE INDEX bs_team_business_id ON bs_team(business_id) WHERE business_id IS NOT NULL;
