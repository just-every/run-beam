-- CONNECT-015: a bounded send lease identifies the only writer allowed to finish
-- an attempt. Expiry is uncertainty, never permission for an automatic resend.
ALTER TABLE beam_webhook_deliveries ADD COLUMN send_token TEXT;
ALTER TABLE beam_webhook_deliveries ADD COLUMN send_started_at INTEGER;
ALTER TABLE beam_webhook_deliveries ADD COLUMN send_expires_at INTEGER;
ALTER TABLE beam_webhook_deliveries ADD COLUMN send_key_version INTEGER;
CREATE INDEX beam_webhook_send_expiry ON beam_webhook_deliveries(state,send_expires_at);
