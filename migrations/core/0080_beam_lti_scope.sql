-- A delegated LTI registration belongs to one business unit; old owner registrations remain installation-wide.
ALTER TABLE beam_lti_tools ADD COLUMN unit_id TEXT REFERENCES beam_units(id);
-- Deep-link consume and selection are one transaction, including an interrupted callback.
ALTER TABLE beam_lti_resources ADD COLUMN launch_id TEXT;
CREATE UNIQUE INDEX beam_lti_resource_launch ON beam_lti_resources(launch_id) WHERE launch_id IS NOT NULL;
