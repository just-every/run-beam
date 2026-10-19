-- REPORT-002: saved report selections, named viewers and separately revocable restricted links.
CREATE TABLE beam_dashboards (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES beam_members(id),
  name TEXT NOT NULL,
  filters TEXT NOT NULL CHECK(json_valid(filters)),
  fields TEXT NOT NULL CHECK(json_valid(fields)),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revoked_by TEXT REFERENCES beam_members(id)
);
CREATE TABLE beam_dashboard_shares (
  id TEXT PRIMARY KEY,
  dashboard_id TEXT NOT NULL REFERENCES beam_dashboards(id),
  viewer_id TEXT NOT NULL REFERENCES beam_members(id),
  kind TEXT NOT NULL CHECK(kind IN ('named', 'link')),
  token_hash TEXT UNIQUE,
  expires_at INTEGER,
  granted_at INTEGER NOT NULL,
  granted_by TEXT NOT NULL REFERENCES beam_members(id),
  revoked_at INTEGER,
  revoked_by TEXT REFERENCES beam_members(id),
  CHECK ((kind = 'named' AND token_hash IS NULL AND expires_at IS NULL) OR (kind = 'link' AND token_hash IS NOT NULL AND expires_at IS NOT NULL))
);
CREATE INDEX beam_dashboard_viewer ON beam_dashboard_shares(viewer_id, dashboard_id);
