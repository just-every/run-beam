-- CONNECT-015 (ct 21 Oct): a restore holds every undelivered delivery the archive brings back, so rotating the key and
-- re-enabling the subscription never sends the old installation's backlog: the scheduled job sends only new pending
-- deliveries, and an explicit owner replay (webhook.replay) rechecks scope and AUTO-008 before it sends one. A send that
-- was interrupted mid-flight keeps its running AUTO-008 reservation, so its replay reports outcome unknown and never
-- resends it.
CREATE TRIGGER beam_restore_holds_webhook_deliveries AFTER UPDATE OF import_job ON rer_portability_state
WHEN OLD.import_job IS NOT NULL AND NEW.import_job IS NULL AND OLD.applying=1 BEGIN
 UPDATE beam_webhook_deliveries SET state='held',outcome='restored' WHERE state IN ('pending','retry','held','sending');
END;
