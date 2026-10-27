import { requireOwner, type Actor, ROLES } from '../actor'
import { all, commit, insist, now, one, stmt } from '../core'
import { connection, guid, providerId, ready, text, type EntraBindings } from './common'
import { reconcileRoles, revokeUsers } from './roles'
import type { Input } from '../input'

function owner(actor: Actor) { requireOwner(actor); insist(!actor.agent && !actor.viewAs && ['native', 'oidc'].includes(actor.sessionKind), 'ordinary_owner_required', 403) }
export async function entraView(env: EntraBindings, actor: Actor) {
 owner(actor)
 const c = await connection(env)
 return { connection: c ? { tenantId: c.tenant_id, clientId: c.client_id, enabled: !!c.enabled, revision: c.revision, ready: ready(env, c), consentAt: c.consent_at, reason: c.reason } : null,
  provider: { id: providerId, startPath: `/auth/oidc/${providerId}/start`, callbackPath: `/auth/oidc/${providerId}/callback` }, scimPath: '/scim/v2',
  users: await all(env, 'SELECT u.id,u.external_id AS externalId,u.user_name AS userName,u.display_name AS displayName,u.active,u.member_id AS memberId,a.subject,a.reviewed_at AS reviewedAt FROM beam_entra_users u LEFT JOIN beam_entra_subjects a ON a.user_id=u.id ORDER BY u.created_at LIMIT 1000'),
  groups: await all(env, "SELECT g.id,g.external_id AS externalId,g.display_name AS displayName,COALESCE((SELECT json_group_array(role) FROM beam_entra_group_roles WHERE group_id=g.id),'[]') AS roles FROM beam_entra_groups g ORDER BY g.created_at LIMIT 1000") }
}
export async function configureEntra(env: EntraBindings, actor: Actor, input: Input) {
 owner(actor)
 insist(input.flag('consent'), 'explicit_consent_required', 403)
 const tenant = guid(input.text('tenantId'), 'tenant'), client = guid(input.text('clientId'), 'client'), reason = input.text('reason', { max: 2000 }), enabled = input.flag('enabled')
 insist(tenant === env.ENTRA_TENANT_ID?.toLowerCase() && client === env.ENTRA_CLIENT_ID?.toLowerCase(), 'entra_server_registration_mismatch', 409)
 insist(!enabled || !!env.ENTRA_CLIENT_SECRET && !!env.ENTRA_SCIM_TOKEN && env.ENTRA_SCIM_TOKEN.length >= 16, 'entra_server_credentials_required', 409)
 const c = await connection(env), at = now()
 insist(!c || c.tenant_id === tenant && c.client_id === client, 'entra_registration_immutable', 409)
 await commit(env, [stmt(env, `INSERT INTO beam_entra_connection(singleton,tenant_id,client_id,enabled,revision,consent_by,consent_at,reason) VALUES(1,?,?,?,1,?,?,?)
  ON CONFLICT(singleton) DO UPDATE SET enabled=excluded.enabled,revision=beam_entra_connection.revision+1,consent_by=excluded.consent_by,consent_at=excluded.consent_at,reason=excluded.reason`, tenant, client, enabled ? 1 : 0, actor.id, at, reason), ...reconcileRoles(env)],
  { actor, action: 'entra.configure', subject: tenant, detail: { clientId: client, enabled, reason, consent: true } })
 return { enabled, tenantId: tenant, clientId: client }
}
export async function associateEntraSubject(env: EntraBindings, actor: Actor, input: Input) {
 owner(actor)
 const c = await connection(env); insist(c, 'entra_not_configured', 409)
 const external = guid(input.text('externalId'), 'external_id'), evidence = input.text('evidence', { max: 2000 })
 insist(input.flag('consent'), 'explicit_consent_required', 403)
 const u = await one(env, "SELECT u.* FROM beam_entra_users u JOIN oa_operators o ON o.id=u.operator_id JOIN beam_members m ON m.id=u.member_id WHERE u.external_id=? AND u.deleted_at IS NULL AND o.role='member' AND m.erased_at IS NULL AND m.erasure_pending=0", external)
 insist(u, 'entra_user_not_found', 404)
 if (input.flag('revoke')) {
  await commit(env, [stmt(env, 'DELETE FROM beam_entra_subjects WHERE user_id=?', u.id), revokeUsers(env, 'id=?', u.id)], { actor, action: 'entra.subject.revoke', subject: u.id, detail: { externalId: external, evidence, consent: true } })
  return { id: u.id }
 }
 const subject = text(input.text('subject', { max: 255 }), 'subject')
 const existing = await one(env, 'SELECT * FROM beam_entra_subjects WHERE subject=? OR user_id=?', subject, u.id)
 insist(!existing || existing.subject === subject && existing.user_id === u.id, 'entra_subject_already_associated', 409)
 // Base bindings are permanent: a reviewed sub cannot be moved to a different account.
 const bound = await one(env, 'SELECT operator_id FROM oa_external_identities WHERE issuer=? AND subject=?', `https://login.microsoftonline.com/${c.tenant_id}/v2.0`, subject)
 insist(!bound || bound.operator_id === u.operator_id, 'entra_subject_already_bound', 409)
 await commit(env, [stmt(env, 'INSERT INTO beam_entra_subjects(subject,user_id,reviewed_by,reviewed_at,evidence) VALUES(?,?,?,?,?) ON CONFLICT(subject) DO UPDATE SET reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,evidence=excluded.evidence', subject, u.id, actor.id, now(), evidence), revokeUsers(env, 'id=?', u.id)], { actor, action: 'entra.subject.associate', subject: u.id, detail: { externalId: external, oidcSubject: subject, evidence, consent: true } })
 return { id: u.id }
}
export async function mapEntraGroup(env: EntraBindings, actor: Actor, input: Input) {
 owner(actor)
 insist(input.flag('consent'), 'explicit_consent_required', 403)
 const group = input.text('group'), roles = [...new Set(input.list('roles'))], reason = input.text('reason', { max: 2000 })
 insist(roles.every(role => (ROLES as readonly string[]).includes(role)), 'invalid_learning_role')
 insist(await one(env, 'SELECT 1 FROM beam_entra_groups WHERE id=?', group), 'entra_group_not_found', 404)
 await commit(env, [revokeUsers(env, 'id IN (SELECT user_id FROM beam_entra_group_members WHERE group_id=?)', group), stmt(env, 'DELETE FROM beam_entra_group_roles WHERE group_id=?', group),
  ...roles.map(role => stmt(env, 'INSERT INTO beam_entra_group_roles(group_id,role,reviewed_by,reviewed_at,reason) VALUES(?,?,?,?,?)', group, role, actor.id, now(), reason)), ...reconcileRoles(env)], { actor, action: 'entra.group.map', subject: group, detail: { roles, reason, consent: true } })
 return { group, roles }
}
