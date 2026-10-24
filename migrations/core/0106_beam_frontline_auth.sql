-- ORG-011 credentials are separate from portable learning evidence.
CREATE TABLE beam_frontline_policy(singleton INTEGER PRIMARY KEY CHECK(singleton=1),enabled INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE beam_frontline_credentials(
 member_id TEXT PRIMARY KEY REFERENCES beam_members(id),salt TEXT NOT NULL,hash TEXT NOT NULL,
 initial_expires INTEGER,mode TEXT NOT NULL CHECK(mode IN ('password','pin')),
 failures INTEGER NOT NULL DEFAULT 0,locked_until INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX beam_username_folded ON beam_members(lower(username)) WHERE username IS NOT NULL;
-- Employment termination is terminal for existing sessions, including after rehire.
CREATE TRIGGER beam_frontline_leaver AFTER UPDATE OF employment ON beam_members
 WHEN NEW.employment='terminated' AND OLD.employment<>'terminated'
 BEGIN
 UPDATE oa_sessions SET revoked_at=COALESCE(revoked_at,unixepoch()*1000) WHERE operator_id=NEW.operator_id;
 DELETE FROM beam_frontline_credentials WHERE member_id=NEW.id;
 END;
