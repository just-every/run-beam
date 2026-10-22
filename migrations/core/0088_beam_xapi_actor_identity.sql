-- Stable, connection-specific pseudonyms; external providers never receive Beam member identifiers.
CREATE TABLE beam_xapi_actors (
 connection_id TEXT NOT NULL REFERENCES beam_xapi_connections(id),
 learner_id TEXT NOT NULL REFERENCES beam_members(id), actor_name TEXT NOT NULL UNIQUE,
 PRIMARY KEY(connection_id,learner_id)
);
