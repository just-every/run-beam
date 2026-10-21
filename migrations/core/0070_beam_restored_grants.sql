-- OPS-007 (ct 20 Oct 16:55Z): the installation archive drops every verifier hash and keeps the decision lineage
-- (scripts/installer/portability-policy.mjs). A grant a restore brings back stays disabled until the owner reissues it:
-- when Base's restore commits (the applying import leaves rer_portability_state), every application credential,
-- certificate verification link and restricted report link then present is marked restored. Rotating an application
-- credential reissues it; a restored link never works again, so a new link replaces it. Additive only, so archives
-- made before this migration still restore, and their grants are marked the same way.
ALTER TABLE beam_app_credentials ADD COLUMN restored_at INTEGER;
ALTER TABLE beam_certificate_links ADD COLUMN restored_at INTEGER;
ALTER TABLE beam_dashboard_shares ADD COLUMN restored_at INTEGER;
CREATE TRIGGER beam_restore_disables_grants AFTER UPDATE OF import_job ON rer_portability_state
WHEN OLD.import_job IS NOT NULL AND NEW.import_job IS NULL AND OLD.applying = 1
BEGIN
  UPDATE beam_app_credentials SET restored_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER);
  UPDATE beam_certificate_links SET restored_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER);
  UPDATE beam_dashboard_shares SET restored_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE kind = 'link';
END;
