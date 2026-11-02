-- Prerequisites of the adopted agent-door runtime; applied migrations stay intact.
ALTER TABLE agent_door_calls ADD COLUMN expires_at INTEGER;
-- Legacy completed calls have no completion timestamp. Bound their replay from
-- creation, rather than extending their retention from the time of upgrade.
UPDATE agent_door_calls SET expires_at=created_at + 2592000000
  WHERE state NOT IN ('running','pending') AND expires_at IS NULL;
CREATE INDEX agent_door_calls_expiry ON agent_door_calls(expires_at);
ALTER TABLE agent_door_agents ADD COLUMN tombstone TEXT;

-- Installation-private bookkeeping; the portability runtime excludes aliases.
CREATE TABLE agent_door_replay_aliases (
  agent TEXT NOT NULL, alias TEXT NOT NULL, call_id TEXT NOT NULL, tombstone TEXT NOT NULL,
  PRIMARY KEY(agent,alias)
);
CREATE TRIGGER agent_door_delete_replay_aliases AFTER DELETE ON agent_door_calls
BEGIN
  DELETE FROM agent_door_replay_aliases WHERE agent=OLD.agent AND call_id=OLD.decision_id;
END;
CREATE INDEX agent_door_replay_aliases_call ON agent_door_replay_aliases(agent,call_id);
