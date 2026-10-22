-- OPS-007: old archives can contain live SCORM playback ids and encrypted xAPI
-- credentials. Restoring evidence never restores permission to play or contact
-- an LRS. As with LTI and webhooks, fence everything when restore commits;
-- ordinary live inserts remain available. No run, event, registration,
-- statement, attachment, outcome or completion evidence is rewritten.
CREATE TRIGGER beam_restore_disables_package_access AFTER UPDATE OF import_job ON rer_portability_state
WHEN OLD.import_job IS NOT NULL AND NEW.import_job IS NULL AND OLD.applying=1 BEGIN
 UPDATE beam_package_sessions SET auth_session_id='withheld',
  ended_at=COALESCE(ended_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),
  expires_at=MIN(expires_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER));
 UPDATE beam_xapi_launches SET auth_session_id='withheld',
  ended_at=COALESCE(ended_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),
  expires_at=MIN(expires_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER));
 UPDATE beam_xapi_connections SET authorization_sealed='withheld',
  revoked_at=COALESCE(revoked_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER));
 UPDATE beam_xapi_activities SET producer_sealed='withheld',
  revoked_at=COALESCE(revoked_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER));
END;
