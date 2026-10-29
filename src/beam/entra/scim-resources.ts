import { all, insist, newId, now, one, stmt } from '../core'
import { refuseErasedIdentity } from '../erasure-fence'
import { guid, text, type EntraBindings } from './common'
import { revokeUsers } from './roles'

export const USER = 'urn:ietf:params:scim:schemas:core:2.0:User'
export const GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group'
export const PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'
export type ResourceKind = 'Users' | 'Groups'
export const table = (kind: ResourceKind) => kind === 'Users' ? 'beam_entra_users' : 'beam_entra_groups'
export function keys(value: Record<string, any>, allowed: string[]) {
 insist(Object.keys(value).every(key => allowed.includes(key)), 'scim_unsupported_attribute')
 insist(!('roles' in value) && !('entitlements' in value), 'scim_role_injection', 403)
}
function schemas(value: any, schema: string) { insist(Array.isArray(value) && value.length === 1 && value[0] === schema, 'scim_unsupported_schema') }
export function validateResource(input: Record<string, any>, kind: ResourceKind) {
 keys(input, kind === 'Users' ? ['schemas', 'externalId', 'userName', 'displayName', 'name', 'emails', 'active'] : ['schemas', 'externalId', 'displayName', 'members'])
 schemas(input.schemas, kind === 'Users' ? USER : GROUP)
 if (kind === 'Users') {
  insist(input.active === undefined || typeof input.active === 'boolean', 'scim_invalid_active')
  const username = text(input.userName, 'user_name', 254).toLowerCase()
  insist(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username) && !username.endsWith('.invalid'), 'scim_email_username_required')
  if (input.emails !== undefined) {
   insist(Array.isArray(input.emails) && input.emails.length <= 1 && input.emails.every((e: any) => e && typeof e.value === 'string' && e.value.toLowerCase() === username), 'scim_unsupported_email')
  }
  return { externalId: guid(input.externalId, 'external_id'), userName: username, displayName: text(input.displayName || input.name?.formatted || username, 'display_name', 200), active: input.active !== false }
 }
 return { externalId: guid(input.externalId, 'external_id'), displayName: text(input.displayName, 'display_name', 200), members: memberIds(input.members ?? []) }
}
export function memberIds(value: any): string[] {
 insist(Array.isArray(value) && value.length <= 1000 && value.every(m => m && typeof m === 'object' && typeof m.value === 'string' && /^[0-9a-f-]{36}$/.test(m.value)), 'scim_invalid_members')
 return [...new Set<string>(value.map(m => m.value))]
}
export async function validateMembers(env: EntraBindings, members: string[]) {
 const known = await all(env, 'SELECT id FROM beam_entra_users WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(members))
 insist(known.length === members.length, 'scim_unknown_member', 409)
}
export async function resource(env: EntraBindings, kind: ResourceKind, row: Record<string, any>) {
 const common = { id: row.id, externalId: row.external_id, displayName: row.display_name, meta: { resourceType: kind === 'Users' ? 'User' : 'Group', created: new Date(row.created_at).toISOString(), lastModified: new Date(row.updated_at).toISOString(), location: `${env.AUTH_ORIGIN}/scim/v2/${kind}/${row.id}`, version: `W/"${row.revision}"` } }
 if (kind === 'Users') return { schemas: [USER], ...common, userName: row.user_name, active: !!row.active, name: { formatted: row.display_name }, emails: [{ value: row.user_name, primary: true }], groups: (await all(env, 'SELECT g.id,g.display_name FROM beam_entra_groups g JOIN beam_entra_group_members gm ON gm.group_id=g.id WHERE gm.user_id=? ORDER BY g.id', row.id)).map(g => ({ value: g.id, display: g.display_name, type: 'direct' })) }
 return { schemas: [GROUP], ...common, members: (await all(env, 'SELECT u.id,u.display_name FROM beam_entra_users u JOIN beam_entra_group_members gm ON gm.user_id=u.id WHERE gm.group_id=? ORDER BY u.id', row.id)).map(u => ({ value: u.id, display: u.display_name, $ref: `${env.AUTH_ORIGIN}/scim/v2/Users/${u.id}` })) }
}
export async function createResource(env: EntraBindings, kind: ResourceKind, input: Record<string, any>) {
 const parsed = validateResource(input, kind), id = newId(), at = now()
 insist(!await one(env, `SELECT 1 FROM ${table(kind)} WHERE external_id=?`, parsed.externalId), 'scim_duplicate_external_id', 409)
 if (kind === 'Groups') {
  const g = parsed as { externalId: string; displayName: string; members: string[] }
  await validateMembers(env, g.members)
  return { id, statements: [stmt(env, 'INSERT INTO beam_entra_groups(id,external_id,display_name,created_at,updated_at) VALUES(?,?,?,?,?)', id, g.externalId, g.displayName, at, at), ...g.members.map(user => stmt(env, 'INSERT INTO beam_entra_group_members(group_id,user_id) VALUES(?,?)', id, user))] }
 }
 const u = parsed as { externalId: string; userName: string; displayName: string; active: boolean }
 await refuseErasedIdentity(env, [u.userName, u.externalId])
 insist(!await one(env, 'SELECT 1 FROM oa_operators WHERE lower(email)=? UNION ALL SELECT 1 FROM beam_members WHERE lower(email)=? OR employee_id=?', u.userName, u.userName, u.externalId), 'scim_existing_identity_requires_review', 409)
 const operator = newId(), member = newId()
 // SCIM's email is directory data. The unreachable account key prevents native
 // email recovery from becoming an alternative to the reviewed OIDC subject.
 const accountKey = `${operator}@entra.invalid`
 return { id, statements: [stmt(env, "INSERT INTO oa_operators(id,email,display_name,role,status,version,created_at) VALUES(?,?,?,'member',?,1,?)", operator, accountKey, u.displayName, u.active ? 'active' : 'inactive', at),
  stmt(env, "INSERT INTO beam_members(id,email,name,created_at,operator_id,employee_id,employment) VALUES(?,?,?,?,?,?,'active')", member, u.userName, u.displayName, at, operator, u.externalId),
  stmt(env, 'INSERT INTO beam_entra_users(id,external_id,user_name,display_name,member_id,operator_id,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)', id, u.externalId, u.userName, u.displayName, member, operator, u.active ? 1 : 0, at, at)] }
}
export async function patchResource(env: EntraBindings, kind: ResourceKind, row: Record<string, any>, input: Record<string, any>) {
 keys(input, ['schemas', 'Operations']); schemas(input.schemas, PATCH)
 insist(Array.isArray(input.Operations) && input.Operations.length > 0 && input.Operations.length <= 50, 'scim_invalid_patch')
 let active = !!row.active, displayName = row.display_name
 let members: string[] = kind === 'Groups' ? (await all(env, 'SELECT user_id FROM beam_entra_group_members WHERE group_id=?', row.id)).map(m => m.user_id) : []
 for (const op of input.Operations) {
  insist(op && typeof op === 'object', 'scim_invalid_patch'); keys(op, ['op', 'path', 'value'])
  const operation = String(op.op).toLowerCase(); insist(['add', 'replace', 'remove'].includes(operation), 'scim_invalid_patch')
  const changes = op.path === undefined && operation !== 'remove' ? op.value : { [op.path]: op.value }
  insist(changes && typeof changes === 'object' && !Array.isArray(changes), 'scim_invalid_patch')
  for (const [path, value] of Object.entries(changes)) {
   if (path.toLowerCase() === 'displayname' && operation !== 'remove') displayName = text(value, 'display_name', 200)
   else if (kind === 'Users' && path.toLowerCase() === 'active' && operation !== 'remove') { insist(typeof value === 'boolean', 'scim_invalid_active'); active = value }
   else if (kind === 'Groups' && path.toLowerCase() === 'members') {
    const ids = operation === 'remove' && value === undefined ? members : memberIds(value)
    members = operation === 'replace' ? ids : operation === 'add' ? [...new Set([...members, ...ids])] : members.filter(id => !ids.includes(id))
   } else if (kind === 'Groups' && operation === 'remove' && /^members\[value eq "[0-9a-f-]{36}"\]$/i.test(path)) members = members.filter(id => id !== path.match(/"([^"]+)"/)![1])
   else insist(false, 'scim_unsupported_patch')
  }
 }
 const at = now()
 if (kind === 'Users') return [
  // The caller fences this resource revision in the same transaction.
  stmt(env, 'UPDATE beam_entra_users SET display_name=?,active=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?', displayName, active ? 1 : 0, at, row.id, row.revision),
  stmt(env, "UPDATE oa_operators SET display_name=?,status=? WHERE id=? AND role='member'", displayName, active ? 'active' : 'inactive', row.operator_id),
  stmt(env, 'UPDATE beam_members SET name=? WHERE id=?', displayName, row.member_id), revokeUsers(env, 'id=?', row.id),
 ]
 await validateMembers(env, members); insist(members.length <= 1000, 'scim_too_many_members')
 return [revokeUsers(env, 'id IN (SELECT user_id FROM beam_entra_group_members WHERE group_id=?)', row.id), stmt(env, 'UPDATE beam_entra_groups SET display_name=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?', displayName, at, row.id, row.revision), stmt(env, 'DELETE FROM beam_entra_group_members WHERE group_id=?', row.id), ...members.map(user => stmt(env, 'INSERT INTO beam_entra_group_members(group_id,user_id) VALUES(?,?)', row.id, user))]
}
