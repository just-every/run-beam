import type { OperatorAuth } from '../../modules/operator-auth/index.mjs'
import { createOidcHandler } from '../../modules/operator-auth/identity/oidc/index.mjs'
import { currentActor } from '../actor'
import { BeamError, insist } from '../core'
import { Input } from '../input'
import { body, providerId, type EntraBindings } from './common'
import { entraAuth } from './oidc'
import { scimResponse } from './scim'
import { associateEntraSubject, configureEntra, entraView, mapEntraGroup } from './settings'
export { entraAuth, entraIssuers } from './oidc'
export { entraSessionAllowed } from './session'
export { associateEntraSubject, configureEntra, entraView, mapEntraGroup } from './settings'
export type { EntraBindings } from './common'

/** Call before Base auth and Beam's general API router; unrelated routes return null. */
export async function entraResponse(env: EntraBindings, request: Request, baseAuth: OperatorAuth): Promise<Response | null> {
 const path = new URL(request.url).pathname
 if (path === '/scim/v2' || path.startsWith('/scim/v2/')) return scimResponse(env, request)
 if (path === `/auth/oidc/${providerId}/start` || path === `/auth/oidc/${providerId}/callback`) {
  const auth = await entraAuth(env, baseAuth)
  if (auth.providers?.ids.includes(providerId)) return createOidcHandler(auth.providers)(request)
  return Response.json({ error: 'entra_disabled' }, { status: 403, headers: { 'cache-control': 'no-store' } })
 }
 if (path !== '/api/beam/entra' && !/^\/api\/beam\/entra\/(configure|associate|map)$/.test(path)) return null
 try {
  insist(new URL(request.url).origin === env.AUTH_ORIGIN, 'invalid_origin', 403)
  insist(!request.headers.has('authorization'), 'human_required', 403)
  const actor = await currentActor(env, request); insist(actor, 'sign_in_required', 401)
  if (path === '/api/beam/entra') { insist(request.method === 'GET', 'method_not_allowed', 405); return Response.json(await entraView(env, actor), { headers: { 'cache-control': 'no-store' } }) }
  insist(request.method === 'POST', 'method_not_allowed', 405)
  insist(request.headers.get('origin') === env.AUTH_ORIGIN && request.headers.get('sec-fetch-site') !== 'cross-site', 'invalid_origin', 403)
  const input = Input.of(await body(request))
  const action = path.endsWith('/configure') ? configureEntra : path.endsWith('/associate') ? associateEntraSubject : mapEntraGroup
  return Response.json(await action(env, actor, input), { headers: { 'cache-control': 'no-store' } })
 } catch (error) {
  return Response.json({ error: error instanceof BeamError ? error.code : 'entra_conflict' }, { status: error instanceof BeamError ? error.status : 409, headers: { 'cache-control': 'no-store' } })
 }
}
