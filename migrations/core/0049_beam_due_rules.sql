-- AUTO-003: relative due dates. A path requirement is due a number of days after enrollment, the person's hire date,
-- their transfer date or the completion of its prerequisite, or on a fixed date; an assignment keeps the rule it was
-- made under, so a prerequisite completion can set its due date. A person may carry their own IANA time zone.
ALTER TABLE beam_path_requirements ADD COLUMN due_anchor TEXT NOT NULL DEFAULT 'enrollment' CHECK (due_anchor IN ('enrollment', 'hire', 'transfer', 'prerequisite', 'fixed'));
ALTER TABLE beam_path_requirements ADD COLUMN due_on TEXT;
ALTER TABLE beam_assignments ADD COLUMN due_anchor TEXT;
ALTER TABLE beam_assignments ADD COLUMN due_days INTEGER;
ALTER TABLE beam_members ADD COLUMN time_zone TEXT;
