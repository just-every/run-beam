-- Keep private replies within the management boundary captured at send time.
-- Older snapshots with no captured boundary fail closed for non-owner senders.
ALTER TABLE beam_announcement_recipients ADD COLUMN authority_teams TEXT;
