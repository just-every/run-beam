-- Privacy withdrawal is separate from a human approval or rejection.
ALTER TABLE beam_agent_proposals ADD COLUMN withdrawn_at INTEGER;
ALTER TABLE beam_agent_proposals ADD COLUMN withdrawn_by TEXT REFERENCES beam_members(id);
