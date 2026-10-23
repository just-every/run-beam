-- Existing account approvals do not authorize a new cumulative spending limit.
ALTER TABLE beam_source_ocr_config ADD COLUMN total_budget_cents INTEGER NOT NULL DEFAULT 0 CHECK(total_budget_cents BETWEEN 0 AND 10000000);
ALTER TABLE beam_source_ocr_config ADD COLUMN account_mode TEXT NOT NULL DEFAULT 'production' CHECK(account_mode IN ('sandbox','production'));
ALTER TABLE beam_source_ocr_config ADD COLUMN agreement_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(agreement_confirmed IN (0,1));
ALTER TABLE beam_source_ocr_runs ADD COLUMN provider_attempted INTEGER NOT NULL DEFAULT 1 CHECK(provider_attempted IN (0,1));
UPDATE beam_source_ocr_config SET enabled=0,version=version+1;
