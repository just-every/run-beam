import { all, BeamError, commit, insist, newId, now, one, stmt } from '../core'
import { body, connection, headers, ready, tokenMatches, type EntraBindings } from './common'
import { createResource, patchResource, resource, table, type ResourceKind } from './scim-resources'
import { reconcileRoles, revokeUsers } from './roles'

const listSchema = 'urn:ietf:params:scim:api:messages:2.0:ListResponse'
const reply = (value: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(value, { status, headers: { ...headers, ...extra } })
export async function scimResponse(env: EntraBindings, request: Request): Promise<Response | null> {
 const url = new URL(request.url)
 if (url.pathname !== '/scim/v2' && !url.pathname.startsWith('/scim/v2/')) return null
 try {
  insist(url.origin === env.AUTH_ORIGIN, 'invalid_origin', 403)
  const c = await connection(env), authorization = request.headers.get('authorization') || ''
  insist(ready(env, c) && authorization.startsWith('Bearer ') && authorization.length <= 8192 && await tokenMatches(authorization.slice(7), env.ENTRA_SCIM_TOKEN!), 'scim_unauthorized', 401)
  if (url.pathname === '/scim/v2/ServiceProviderConfig') {
   insist(request.method === 'GET', 'method_not_allowed', 405)
   return reply({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'], patch: { supported: true }, bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 }, filter: { supported: true, maxResults: 100 }, changePassword: { supported: false }, sort: { supported: false }, etag: { supported: true }, authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Tenant provisioning token', description: 'Server-held token for the consented Entra tenant', primary: true }] })
  }
  const match = /^\/scim\/v2\/(Users|Groups)(?:\/([0-9a-f-]{36}))?$/.exec(url.pathname)
  insist(match, 'scim_not_found', 404)
  const kind = match[1] as ResourceKind, id = match[2], active = kind === 'Users' ? ' AND deleted_at IS NULL' : ''
  if (request.method === 'GET' && !id) {
   const filter = url.searchParams.get('filter'); let where = '1'; const args: unknown[] = []
   if (filter) {
    const f = /^(userName|externalId|displayName|id) eq "([^"\x00-\x1f]{1,255})"$/i.exec(filter)
    insist(f && (kind === 'Users' || f[1].toLowerCase() !== 'username'), 'scim_unsupported_filter')
    const columns: Record<string, string> = { username: 'user_name', externalid: 'external_id', displayname: 'display_name', id: 'id' }
    where = `${columns[f[1].toLowerCase()]}=?`; args.push(f[1].toLowerCase() === 'username' ? f[2].toLowerCase() : f[2])
   }
   const start = Number(url.searchParams.get('startIndex') ?? '1'), count = Number(url.searchParams.get('count') ?? '100')
   insist(Number.isSafeInteger(start) && start >= 1 && start <= 1000000 && Number.isSafeInteger(count) && count >= 0 && count <= 100, 'scim_invalid_pagination')
   const rows = await all(env, `SELECT * FROM ${table(kind)} WHERE ${where}${active} ORDER BY id LIMIT ? OFFSET ?`, ...args, count, start - 1)
   const total = await one<{ total: number }>(env, `SELECT count(*) AS total FROM ${table(kind)} WHERE ${where}${active}`, ...args)
   return reply({ schemas: [listSchema], totalResults: total!.total, startIndex: start, itemsPerPage: rows.length, Resources: await Promise.all(rows.map(row => resource(env, kind, row))) })
  }
  const row = id ? await one(env, `SELECT * FROM ${table(kind)} WHERE id=?${active}`, id) : null
  if (id) insist(row, 'scim_not_found', 404)
  if (request.method === 'GET' && row) return reply(await resource(env, kind, row), 200, { etag: `W/"${row.revision}"` })
  const fenceId = newId()
  const statements: D1PreparedStatement[] = [stmt(env, 'INSERT INTO beam_entra_mutation_fences(id,revision,resource_kind,resource_id,resource_revision) VALUES(?,?,?,?,?)', fenceId, c!.revision, kind, row?.id ?? null, row?.revision ?? null)]
  if (row && request.headers.has('if-match')) insist(request.headers.get('if-match') === `W/"${row.revision}"`, 'scim_version_mismatch', 412)
  let resultId = id, status = 200
  if (request.method === 'POST' && !id) {
   const created = await createResource(env, kind, await body(request)); resultId = created.id; statements.push(...created.statements); status = 201
  } else if (request.method === 'PATCH' && row) {
   const ifMatch = request.headers.get('if-match'); insist(!ifMatch || ifMatch === `W/"${row.revision}"`, 'scim_version_mismatch', 412)
   statements.push(...await patchResource(env, kind, row, await body(request)))
  } else if (request.method === 'DELETE' && row) {
   if (kind === 'Users') statements.push(stmt(env, 'UPDATE beam_entra_users SET active=0,deleted_at=?,updated_at=?,revision=revision+1 WHERE id=?', now(), now(), id), stmt(env, "UPDATE oa_operators SET status='inactive' WHERE id=? AND role='member'", row.operator_id), revokeUsers(env, 'id=?', id), stmt(env, 'DELETE FROM beam_entra_group_members WHERE user_id=?', id))
   else statements.push(revokeUsers(env, 'id IN (SELECT user_id FROM beam_entra_group_members WHERE group_id=?)', id), stmt(env, 'DELETE FROM beam_entra_group_members WHERE group_id=?', id), stmt(env, 'DELETE FROM beam_entra_group_roles WHERE group_id=?', id), stmt(env, 'DELETE FROM beam_entra_groups WHERE id=?', id))
   status = 204
  } else insist(false, 'scim_unsupported_operation', 405)
  statements.push(...reconcileRoles(env), stmt(env, 'DELETE FROM beam_entra_mutation_fences WHERE id=?', fenceId))
  await commit(env, statements, { actor: 'entra:scim', action: `entra.scim.${request.method.toLowerCase()}`, subject: resultId!, detail: { kind, tenantId: c!.tenant_id } })
  if (status === 204) return new Response(null, { status, headers })
  const saved = await one(env, `SELECT * FROM ${table(kind)} WHERE id=?`, resultId)
  insist(saved, 'scim_not_found', 404)
  return reply(await resource(env, kind, saved), status, { location: `${env.AUTH_ORIGIN}/scim/v2/${kind}/${resultId}`, etag: `W/"${saved.revision}"` })
 } catch (error) {
  const known = error instanceof BeamError
  // Never expose D1 errors, request bodies, bearer tokens or provider secrets.
  return reply({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: String(known ? error.status : 409), detail: known ? error.code : 'scim_conflict' }, known ? error.status : 409, !known || error.status !== 401 ? {} : { 'www-authenticate': 'Bearer' })
 }
}
