-- AUTO-008: estimated USD cents are reserved before a paid provider attempt.
-- Legacy internal attempts retain their zero-cost estimate. A zero budget
-- blocks positive estimates while continuing to permit internal zero-cost work.
ALTER TABLE beam_automation_policy ADD COLUMN daily_spend_limit_cents INTEGER NOT NULL DEFAULT 0 CHECK(daily_spend_limit_cents BETWEEN 0 AND 1000000000);
ALTER TABLE beam_automation_attempts ADD COLUMN external_spend_cents INTEGER NOT NULL DEFAULT 0 CHECK(external_spend_cents BETWEEN 0 AND 1000000000);
CREATE INDEX beam_automation_attempts_execution ON beam_automation_attempts(execution_id,charged);
