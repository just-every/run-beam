-- CONNECT-008: one explicitly consented Entra tenant, SCIM objects and reviewed
-- OIDC subject associations. Provider secrets live exclusively in Worker bindings.
CREATE TABLE beam_entra_connection (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), tenant_id TEXT NOT NULL,
 client_id TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 revision INTEGER NOT NULL, consent_by TEXT NOT NULL REFERENCES beam_members(id),
 consent_at INTEGER NOT NULL, reason TEXT NOT NULL
);
CREATE TABLE beam_entra_users (
 id TEXT PRIMARY KEY, external_id TEXT NOT NULL UNIQUE, user_name TEXT NOT NULL UNIQUE,
 display_name TEXT NOT NULL, member_id TEXT NOT NULL UNIQUE REFERENCES beam_members(id),
 operator_id TEXT UNIQUE REFERENCES oa_operators(id),
 active INTEGER NOT NULL CHECK(active IN (0,1)), revision INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE TABLE beam_entra_subjects (
 subject TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES beam_entra_users(id),
 reviewed_by TEXT NOT NULL REFERENCES beam_members(id), reviewed_at INTEGER NOT NULL,
 evidence TEXT NOT NULL
);
CREATE TABLE beam_entra_groups (
 id TEXT PRIMARY KEY, external_id TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE beam_entra_group_members (
 group_id TEXT NOT NULL REFERENCES beam_entra_groups(id), user_id TEXT NOT NULL REFERENCES beam_entra_users(id),
 PRIMARY KEY(group_id,user_id)
);
CREATE TABLE beam_entra_group_roles (
 group_id TEXT NOT NULL REFERENCES beam_entra_groups(id),
 role TEXT NOT NULL CHECK(role IN ('author','reviewer','learner','manager','assessor')),
 reviewed_by TEXT NOT NULL REFERENCES beam_members(id), reviewed_at INTEGER NOT NULL, reason TEXT NOT NULL,
 PRIMARY KEY(group_id,role)
);
-- Only these grants are withdrawn by SCIM; independently granted learning roles survive.
CREATE TABLE beam_entra_role_grants (
 member_id TEXT NOT NULL REFERENCES beam_members(id), role TEXT NOT NULL,
 PRIMARY KEY(member_id,role)
);
-- A configuration or association change cannot leave an earlier session alive.
CREATE TRIGGER beam_entra_connection_revoke AFTER UPDATE ON beam_entra_connection BEGIN
 UPDATE oa_sessions SET revoked_at=COALESCE(revoked_at,NEW.consent_at)
 WHERE operator_id IN (SELECT operator_id FROM beam_entra_users);
END;
CREATE TRIGGER beam_entra_subject_revoke AFTER DELETE ON beam_entra_subjects BEGIN
 UPDATE oa_sessions SET revoked_at=COALESCE(revoked_at,OLD.reviewed_at)
 WHERE operator_id=(SELECT operator_id FROM beam_entra_users WHERE id=OLD.user_id);
END;
-- Base writes this record in the same transaction as its OIDC session. Repeat
-- admission at the durable boundary so concurrent deprovisioning fails closed.
CREATE TRIGGER beam_entra_session_admission BEFORE INSERT ON oa_provider_sessions
WHEN NEW.issuer IN (SELECT 'https://login.microsoftonline.com/'||tenant_id||'/v2.0' FROM beam_entra_connection)
BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM beam_entra_subjects a JOIN beam_entra_users u ON u.id=a.user_id
  JOIN beam_entra_connection c ON c.singleton=1 JOIN beam_members m ON m.id=u.member_id
  JOIN oa_operators o ON o.id=u.operator_id JOIN oa_sessions s ON s.id=NEW.session_id
  WHERE a.subject=NEW.subject AND c.enabled=1 AND u.active=1 AND o.role='member'
  AND o.status='active' AND m.erased_at IS NULL AND m.erasure_pending=0
  AND m.employment<>'terminated' AND s.operator_id=u.operator_id
  AND EXISTS(SELECT 1 FROM beam_entra_group_members gm JOIN beam_entra_group_roles gr ON gr.group_id=gm.group_id WHERE gm.user_id=u.id)
 ) THEN RAISE(ABORT,'entra_admission_denied') END;
END;
-- A transient transaction fence: no SCIM request read under an earlier consent
-- may write after that consent changes. Entries are removed in the same batch.
CREATE TABLE beam_entra_mutation_fences(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, resource_kind TEXT, resource_id TEXT, resource_revision INTEGER);
CREATE TRIGGER beam_entra_mutation_admission BEFORE INSERT ON beam_entra_mutation_fences BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM beam_entra_connection WHERE singleton=1 AND enabled=1 AND revision=NEW.revision)
 THEN RAISE(ABORT,'entra_configuration_changed') END;
 SELECT CASE WHEN NEW.resource_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM beam_entra_users WHERE NEW.resource_kind='Users' AND id=NEW.resource_id AND revision=NEW.resource_revision AND deleted_at IS NULL UNION ALL SELECT 1 FROM beam_entra_groups WHERE NEW.resource_kind='Groups' AND id=NEW.resource_id AND revision=NEW.resource_revision) THEN RAISE(ABORT,'entra_resource_changed') END;
END;
CREATE TRIGGER beam_entra_protect_operator BEFORE UPDATE OF role ON oa_operators
WHEN NEW.role<>'member' AND EXISTS(SELECT 1 FROM beam_entra_users WHERE operator_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'entra_managed_account'); END;

CREATE TRIGGER beam_entra_require_oidc BEFORE INSERT ON oa_sessions
WHEN NEW.kind<>'oidc' AND EXISTS(SELECT 1 FROM beam_entra_users WHERE operator_id=NEW.operator_id)
BEGIN SELECT RAISE(ABORT,'entra_provider_required'); END;

CREATE TRIGGER beam_restore_disables_entra AFTER UPDATE OF import_job ON rer_portability_state
WHEN NEW.import_job IS NOT OLD.import_job BEGIN
 UPDATE beam_entra_connection SET enabled=0,revision=revision+1;
 DELETE FROM beam_member_roles WHERE EXISTS(SELECT 1 FROM beam_entra_role_grants g WHERE g.member_id=beam_member_roles.member_id AND g.role=beam_member_roles.role);
 DELETE FROM beam_entra_role_grants;
 DELETE FROM beam_entra_subjects;
 UPDATE beam_entra_users SET active=0,operator_id=NULL;
END;
