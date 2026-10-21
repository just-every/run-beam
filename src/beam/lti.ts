// PACK-006: LTI 1.3 platform. Human owners select/review resources; tools never publish or bypass native assessment.
import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { all, commit, insist, newId, now, one, sha256Hex, stmt, type Row } from './core'
import { Input } from './input'
import { editDraft } from './courses'
import { assignmentView, tryComplete } from './learning'
import { requireAccess } from './access'
import { dashboardAuthority } from './actor'
import { openSecret, randomSecret, sealSecret } from './integration-secrets'
import { jwtSign, jwtVerify, publicKeys } from './lti-jwt'
import { h, hidden, page } from './ui/html'
export const LTI = 'https://purl.imsglobal.org/spec/lti/claim/'
export const DL = 'https://purl.imsglobal.org/spec/lti-dl/claim/'
export const AGS = 'https://purl.imsglobal.org/spec/lti-ags/'
const digest = (value: string) => sha256Hex(new TextEncoder().encode(value))
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } })
function owner(actor: Actor) { requireOwner(actor); insist(!actor.agent && !actor.viewAs, 'human_session_required', 403) }
function trustedUrl(env: Bindings, value: string) {
  let url: URL
  try { url = new URL(value) } catch { insist(false, 'invalid_lti_url') }
  const hosts = (env.BEAM_LTI_HOSTS ?? '').split(',').map(host => host.trim().toLowerCase())
  insist(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && !url.search && /^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]+$/.test(url.hostname) && !/(?:^|\.)(localhost|local|internal|lan|home)$/.test(url.hostname) && hosts.includes(url.hostname) && url.origin !== env.AUTH_ORIGIN, 'lti_host_not_admitted', 403)
  return url.href
}
async function liveTool(env: Bindings, id: string) {
  const tool = await one(env, 'SELECT * FROM beam_lti_tools WHERE id=? AND revoked_at IS NULL', id)
  insist(tool && (await dashboardAuthority(env, tool.created_by))?.owner, 'lti_deployment_unavailable', 403)
  trustedUrl(env, tool.login_url); trustedUrl(env, tool.redirect_uri)
  return tool
}
export async function registerLti(env: Bindings, actor: Actor, input: Input) {
  owner(actor); insist(input.flag('consent'), 'lti_consent_required')
  const issuer = input.text('issuer', { max: 2048 }), client = input.text('clientId', { max: 100 }), deployment = input.text('deployment', { max: 100 })
  insist(issuer === env.AUTH_ORIGIN, 'lti_issuer_mismatch')
  const id = newId(), login = trustedUrl(env, input.text('loginUrl', { max: 2048 })), redirect = trustedUrl(env, input.text('redirectUri', { max: 2048 })), keys = publicKeys(input.json('jwks'))
  insist(new URL(login).origin === new URL(redirect).origin, 'lti_origin_mismatch')
  insist(!await one(env, 'SELECT 1 FROM beam_lti_tools WHERE client_id=?', client), 'lti_client_registered', 409)
  await commit(env, [stmt(env, 'INSERT INTO beam_lti_tools(id,name,issuer,client_id,deployment,login_url,redirect_uri,keys_json,created_by,consent_at) VALUES(?,?,?,?,?,?,?,?,?,?)', id, input.text('name', { max: 80 }), issuer, client, deployment, login, redirect, JSON.stringify(keys), actor.id, now())], { actor, action: 'lti.register', subject: id, detail: { issuer, client, deployment, login, redirect, consent: true } })
  if (!await one(env, 'SELECT 1 FROM beam_lti_platform_keys WHERE retired_at IS NULL')) await rotateLtiPlatform(env, actor)
  return { id, issuer, clientId: client, deployment, authorizationEndpoint: `${issuer}/api/beam/lti/authorize`, tokenEndpoint: `${issuer}/api/beam/lti/token`, jwks: `${issuer}/api/beam/lti/jwks` }
}
export async function rotateLtiKeys(env: Bindings, actor: Actor, input: Input) {
  owner(actor)
  const tool = await liveTool(env, input.text('tool')), keys = publicKeys(input.json('jwks'))
  const version = input.integer('version')!
  insist(version === tool.key_version, 'lti_keys_changed', 409)
  await commit(env, [stmt(env, 'UPDATE beam_lti_tools SET keys_json=?,key_version=key_version+1 WHERE id=? AND key_version=?', JSON.stringify(keys), tool.id, version), stmt(env, 'DELETE FROM beam_lti_tokens WHERE tool_id=?', tool.id)], { actor, action: 'lti.keys', subject: tool.id, detail: { version: version + 1, kids: keys.keys.map(k => k.kid) } })
  return { id: tool.id, version: version + 1 }
}
export async function revokeLti(env: Bindings, actor: Actor, input: Input) {
  owner(actor)
  const tool = await liveTool(env, input.text('tool'))
  await commit(env, [stmt(env, 'UPDATE beam_lti_tools SET revoked_at=? WHERE id=?', now(), tool.id), stmt(env, 'DELETE FROM beam_lti_tokens WHERE tool_id=?', tool.id)], { actor, action: 'lti.revoke', subject: tool.id })
  return { id: tool.id, revoked: true }
}
export async function rotateLtiPlatform(env: Bindings, actor: Actor) {
  owner(actor)
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign','verify'])
  const id = newId(), publicKey = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: id, use: 'sig', alg: 'RS256' }, privateKey = await crypto.subtle.exportKey('jwk', pair.privateKey)
  await commit(env, [stmt(env, 'UPDATE beam_lti_platform_keys SET retired_at=? WHERE retired_at IS NULL', now()), stmt(env, 'INSERT INTO beam_lti_platform_keys VALUES(?,?,?,?,NULL)', id, JSON.stringify(publicKey), await sealSecret(env, JSON.stringify(privateKey), `lti:${id}`), now())], { actor, action: 'lti.platform.rotate', subject: id })
  return { kid: id }
}
export async function ltiView(env: Bindings, actor: Actor) {
  owner(actor)
  return { tools: await all(env, 'SELECT id,name,issuer,client_id AS clientId,deployment,login_url AS loginUrl,redirect_uri AS redirectUri,keys_json AS jwks,key_version AS keyVersion,consent_at AS consentAt,revoked_at AS revokedAt FROM beam_lti_tools'), resources: await all(env, 'SELECT * FROM beam_lti_resources'), results: await all(env, 'SELECT r.*,l.assignment_id,l.revision_id,l.resource_id FROM beam_lti_results r JOIN beam_lti_lineitems l ON l.id=r.lineitem_id ORDER BY r.rowid DESC LIMIT 100') }
}
async function launch(env: Bindings, actor: Actor, input: Input, deep: boolean) {
  insist(!actor.agent && !actor.viewAs, 'human_session_required', 403)
  let tool: Row, course: string, assignment: string | null = null, resource: Row | null = null
  if (deep) { owner(actor); tool = await liveTool(env, input.text('tool')); course = input.text('course'); insist(await one(env, 'SELECT 1 FROM beam_courses WHERE id=?', course), 'course_not_found', 404) }
  else {
    assignment = input.text('assignment')
    const view = await assignmentView(env, actor, assignment)
    insist(view.assignment.learner === actor.id && view.assignment.status === 'open' && !view.blocked && view.access.state === 'open', 'lti_assignment_unavailable', 403)
    resource = await one(env, 'SELECT * FROM beam_lti_resources WHERE id=? AND course_id=?', input.text('resource'), view.assignment.course)
    insist(resource && view.lessons.some(lesson => (lesson as any).blocks?.some((block: any) => block.kind === 'lti' && block.resource === resource!.id)), 'lti_resource_not_assigned', 403)
    tool = await liveTool(env, resource.tool_id); course = view.assignment.course
  }
  const id = newId(), data = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_lti_launches(id,tool_id,member_id,course_id,assignment_id,resource_id,kind,data,expires_at) VALUES(?,?,?,?,?,?,?,?,?)', id, tool.id, actor.id, course, assignment, resource?.id ?? null, deep ? 'deep_link' : 'resource', data, now() + 300_000)], { actor, action: 'lti.launch.prepare', subject: id, detail: { tool: tool.id, course, assignment, resource: resource?.id ?? null, minimalData: true } })
  const url = new URL(tool.login_url)
  url.search = new URLSearchParams({ iss: env.AUTH_ORIGIN, login_hint: id, lti_message_hint: id, client_id: tool.client_id, target_link_uri: resource?.url ?? tool.redirect_uri }).toString()
  return { loginUrl: url.href }
}
export const deepLinkLti = (env: Bindings, actor: Actor, input: Input) => launch(env, actor, input, true)
export const launchLti = (env: Bindings, actor: Actor, input: Input) => launch(env, actor, input, false)
export async function attachLti(env: Bindings, actor: Actor, input: Input) {
  owner(actor)
  const resource = await one(env, 'SELECT * FROM beam_lti_resources WHERE id=? AND course_id=?', input.text('resource'), input.text('course'))
  insist(resource, 'lti_resource_not_found', 404); await liveTool(env, resource.tool_id)
  const threshold = input.integer('passPercent', { min: 1, max: 100 })!
  return await editDraft(env, actor, input, 'lti.attach', draft => {
    const lesson = draft.lessons.find(item => item.id === input.text('lesson'))
    insist(lesson, 'lesson_not_found', 404)
    ;(lesson.blocks ??= []).push({ id: newId(), kind: 'lti', text: resource.title, resource: resource.id, passPercent: threshold })
  }, { resource: resource.id, tool: resource.tool_id, passPercent: threshold })
}
export async function authorizeLti(env: Bindings, actor: Actor, request: Request) {
  insist(request.method === 'GET' && !actor.agent && !actor.viewAs, 'lti_authorization_refused', 403)
  const q = new URL(request.url).searchParams, row = await one(env, 'SELECT * FROM beam_lti_launches WHERE id=? AND member_id=? AND authorized_at IS NULL AND expires_at>?', q.get('login_hint'), actor.id, now())
  insist(row, 'lti_launch_expired', 403)
  const tool = await liveTool(env, row.tool_id), nonce = q.get('nonce'), state = q.get('state')
  insist(q.get('client_id') === tool.client_id && q.get('redirect_uri') === tool.redirect_uri && q.get('response_type') === 'id_token' && q.get('response_mode') === 'form_post' && q.get('scope') === 'openid' && q.get('prompt') === 'none' && nonce && nonce.length <= 256 && state && state.length <= 1024 && q.get('lti_message_hint') === row.id, 'lti_authorization_refused', 403)
  if (row.kind === 'deep_link') owner(actor)
  else {
    const view = await assignmentView(env, actor, row.assignment_id)
    insist(view.assignment.learner === actor.id && view.assignment.status === 'open' && !view.blocked && view.access.state === 'open' && view.lessons.some(lesson => (lesson as any).blocks?.some((b: any) => b.resource === row.resource_id)), 'lti_assignment_unavailable', 403)
  }
  const key = await one(env, 'SELECT * FROM beam_lti_platform_keys WHERE retired_at IS NULL ORDER BY created_at DESC LIMIT 1')
  insist(key, 'lti_key_unavailable', 409)
  const sec = Math.floor(now() / 1000), subject = await digest(`beam.lti.subject:${tool.id}:${actor.id}`)
  const claims: Record<string, unknown> = { iss: tool.issuer, aud: tool.client_id, sub: subject, iat: sec, exp: sec + 300, nonce, [LTI + 'version']: '1.3.0', [LTI + 'deployment_id']: tool.deployment, [LTI + 'message_type']: row.kind === 'deep_link' ? 'LtiDeepLinkingRequest' : 'LtiResourceLinkRequest', [LTI + 'roles']: [row.kind === 'deep_link' ? 'http://purl.imsglobal.org/vocab/lis/v2/institution/person#Administrator' : 'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'], [LTI + 'context']: { id: row.course_id, type: ['http://purl.imsglobal.org/vocab/lis/v2/course#CourseSection'] } }
  if (row.kind === 'deep_link') claims[DL + 'deep_linking_settings'] = { deep_link_return_url: `${env.AUTH_ORIGIN}/api/beam/lti/deep-link`, accept_types: ['ltiResourceLink'], accept_presentation_document_targets: ['window'], accept_multiple: false, auto_create: false, data: row.data }
  else {
    const resource = (await one(env, 'SELECT * FROM beam_lti_resources WHERE id=?', row.resource_id))!
    trustedUrl(env, resource.url)
    const assignment = (await one(env, 'SELECT * FROM beam_assignments WHERE id=?', row.assignment_id))!
    await env.DB.prepare('INSERT OR IGNORE INTO beam_lti_lineitems VALUES(?,?,?,?,?,?,?,?)').bind(newId(), tool.id, assignment.id, assignment.course_revision_id, resource.id, actor.id, subject, now()).run()
    const lineitem = (await one(env, 'SELECT id FROM beam_lti_lineitems WHERE assignment_id=? AND resource_id=?', assignment.id, resource.id))!
    claims[LTI + 'target_link_uri'] = resource.url
    claims[LTI + 'resource_link'] = { id: resource.id }
    claims[AGS + 'claim/endpoint'] = { scope: [AGS + 'scope/score'], lineitem: `${env.AUTH_ORIGIN}/api/beam/lti/lineitems/${lineitem.id}` }
  }
  const token = await jwtSign(JSON.parse(await openSecret(env, key.private_cipher, `lti:${key.id}`)), key.id, claims)
  const taken = await env.DB.prepare('UPDATE beam_lti_launches SET authorized_at=? WHERE id=? AND authorized_at IS NULL RETURNING id').bind(now(), row.id).all()
  insist(taken.results.length === 1, 'lti_launch_consumed', 409)
  const response = page('Open external learning tool', actor, h`<h1>Open external learning tool</h1><p>Continue to ${tool.name}. Only a tool-specific learner identifier and course context are shared. Your name, email and learning evidence are not included.</p><form method="post" action="${tool.redirect_uri}">${hidden('id_token', token)}${hidden('state', state)}<button type="submit">Continue to external tool</button></form>`)
  response.headers.set('content-security-policy', `default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; form-action ${new URL(tool.redirect_uri).origin}; frame-ancestors 'none'; base-uri 'none'`)
  response.headers.set('cache-control', 'no-store'); response.headers.set('referrer-policy', 'no-referrer')
  return response
}
async function deepLinkResponse(env: Bindings, request: Request) {
  const body = await Input.from(request), token = body.text('JWT', { max: 32_000 })
  // Untrusted issuer only chooses a pinned candidate key set; signature/issuer/audience are checked next.
  let client = ''
  try { client = JSON.parse(atob(token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))).iss } catch { /* refused below */ }
  const row = await one(env, 'SELECT id FROM beam_lti_tools WHERE client_id=?', client)
  insist(row, 'invalid_lti_token', 401)
  const tool = await liveTool(env, row.id), claims = await jwtVerify(token, JSON.parse(tool.keys_json), tool.client_id, env.AUTH_ORIGIN)
  insist(claims[LTI + 'deployment_id'] === tool.deployment && claims[LTI + 'version'] === '1.3.0' && claims[LTI + 'message_type'] === 'LtiDeepLinkingResponse', 'invalid_lti_deployment', 403)
  const pending = await one(env, "SELECT * FROM beam_lti_launches WHERE tool_id=? AND kind='deep_link' AND data=? AND authorized_at IS NOT NULL AND consumed_at IS NULL AND expires_at>?", tool.id, claims[DL + 'data'] ?? '', now())
  insist(pending && (await dashboardAuthority(env, pending.member_id))?.owner, 'lti_deep_link_expired', 409)
  const items = claims[DL + 'content_items']
  insist(Array.isArray(items) && items.length === 1 && items[0].type === 'ltiResourceLink' && typeof items[0].url === 'string' && typeof items[0].title === 'string' && items[0].title.trim().length > 0 && items[0].title.length <= 160, 'invalid_lti_deep_link')
  const target = trustedUrl(env, items[0].url)
  insist(new URL(target).origin === new URL(tool.redirect_uri).origin, 'lti_origin_mismatch')
  const id = newId()
  const consumed = await env.DB.prepare('UPDATE beam_lti_launches SET consumed_at=? WHERE id=? AND consumed_at IS NULL RETURNING id').bind(now(), pending.id).all()
  insist(consumed.results.length === 1, 'lti_deep_link_expired', 409)
  await commit(env, [stmt(env, 'INSERT INTO beam_lti_resources VALUES(?,?,?,?,?,?,?)', id, tool.id, pending.course_id, target, items[0].title.trim(), pending.member_id, now())], { actor: pending.member_id, action: 'lti.deep_link', subject: id, detail: { tool: tool.id, course: pending.course_id, deployment: tool.deployment } })
  return json({ id, state: 'selected_not_published', course: pending.course_id })
}
async function accessToken(env: Bindings, request: Request) {
  const input = await Input.from(request)
  insist(input.text('grant_type') === 'client_credentials' && input.text('client_assertion_type') === 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer' && input.text('scope', { max: 2048 }) === AGS + 'scope/score', 'invalid_lti_grant', 401)
  const row = await one(env, 'SELECT id FROM beam_lti_tools WHERE client_id=?', input.text('client_id'))
  insist(row, 'invalid_lti_token', 401)
  const tool = await liveTool(env, row.id), claims = await jwtVerify(input.text('client_assertion', { max: 32_000 }), JSON.parse(tool.keys_json), tool.client_id, `${env.AUTH_ORIGIN}/api/beam/lti/token`)
  insist(claims.sub === tool.client_id && typeof claims.jti === 'string' && claims.jti.length > 0 && claims.jti.length <= 200, 'invalid_lti_token', 401)
  const taken = await env.DB.prepare('INSERT INTO beam_lti_assertions VALUES(?,?,?) ON CONFLICT DO NOTHING RETURNING jti').bind(tool.id, claims.jti, claims.exp * 1000).all()
  insist(taken.results.length === 1, 'lti_assertion_replayed', 401)
  const token = randomSecret()
  await env.DB.prepare('INSERT INTO beam_lti_tokens VALUES(?,?,?)').bind(await digest(token), tool.id, now() + 300_000).run()
  return json({ access_token: token, token_type: 'Bearer', expires_in: 300, scope: AGS + 'scope/score' })
}
async function score(env: Bindings, request: Request, id: string) {
  const token = (request.headers.get('authorization') ?? '').match(/^Bearer ([A-Za-z0-9+/=]+)$/)?.[1]
  const grant = token ? await one(env, 'SELECT * FROM beam_lti_tokens WHERE hash=? AND expires_at>?', await digest(token), now()) : null
  insist(grant, 'invalid_lti_token', 401)
  const tool = await liveTool(env, grant.tool_id), line = await one(env, 'SELECT * FROM beam_lti_lineitems WHERE id=? AND tool_id=?', id, tool.id)
  insist(line, 'lti_lineitem_not_found', 404)
  const assignment = await one(env, 'SELECT * FROM beam_assignments WHERE id=? AND course_revision_id=? AND learner_id=?', line.assignment_id, line.revision_id, line.learner_id)
  insist(assignment && assignment.status === 'open', 'lti_assignment_closed', 409); requireAccess(assignment)
  const actor = await dashboardAuthority(env, line.learner_id)
  insist(actor && !actor.agent, 'lti_learner_unavailable', 403)
  const view = await assignmentView(env, actor, assignment.id)
  insist(!view.blocked && view.access.state === 'open' && view.lessons.some(lesson => (lesson as any).blocks?.some((b: any) => b.kind === 'lti' && b.resource === line.resource_id)), 'lti_resource_not_assigned', 403)
  const text = await request.text(); insist(text.length <= 8192, 'lti_result_too_large', 413)
  let body: Record<string, any>
  try { body = JSON.parse(text) } catch { insist(false, 'invalid_lti_result') }
  insist(body.userId === line.subject && typeof body.timestamp === 'string' && Number.isFinite(Date.parse(body.timestamp)) && Date.parse(body.timestamp) >= line.launched_at - 30_000 && Date.parse(body.timestamp) <= now() + 30_000, 'invalid_lti_result')
  insist(typeof body.scoreGiven === 'number' && Number.isFinite(body.scoreGiven) && typeof body.scoreMaximum === 'number' && Number.isFinite(body.scoreMaximum) && body.scoreMaximum > 0 && body.scoreGiven >= 0 && body.scoreGiven <= body.scoreMaximum && ['Initialized','Started','InProgress','Submitted','Completed'].includes(body.activityProgress) && ['NotReady','Failed','Pending','PendingManual','FullyGraded'].includes(body.gradingProgress), 'invalid_lti_result')
  const latest = await one(env, 'SELECT timestamp FROM beam_lti_results WHERE lineitem_id=? ORDER BY rowid DESC LIMIT 1', line.id)
  insist(!latest || Date.parse(body.timestamp) > Date.parse(latest.timestamp), 'lti_result_replayed', 409)
  await commit(env, [stmt(env, 'INSERT INTO beam_lti_results VALUES(?,?,?,?,?,?,?,?)', newId(), line.id, body.scoreGiven, body.scoreMaximum, body.activityProgress, body.gradingProgress, body.timestamp, now())], { actor: tool.created_by, action: 'lti.result', subject: assignment.id, detail: { tool: tool.id, deployment: tool.deployment, lineitem: line.id, revision: line.revision_id, resource: line.resource_id } })
  const completion = await tryComplete(env, actor, assignment.id)
  return json({ accepted: true, completion: completion?.id ?? null })
}
/** These protocol doors authenticate signed JWTs/short-lived deployment tokens, never co-present human cookies. */
export async function ltiPublicResponse(env: Bindings, request: Request): Promise<Response | null> {
  const path = new URL(request.url).pathname
  if (path === '/api/beam/lti/jwks' && request.method === 'GET') return json({ keys: (await all(env, 'SELECT public_json FROM beam_lti_platform_keys WHERE retired_at IS NULL OR retired_at>?', now() - 600_000)).map(row => JSON.parse(row.public_json)) })
  const match = path.match(/^\/api\/beam\/lti\/lineitems\/([\w-]+)\/scores$/)
  if (!match && !['/api/beam/lti/token','/api/beam/lti/deep-link'].includes(path)) return null
  insist(request.method === 'POST' && !request.headers.has('cookie'), 'lti_protocol_session_refused', 403)
  insist(Number(request.headers.get('content-length') ?? 0) <= 40_000, 'lti_request_too_large', 413)
  return path.endsWith('/token') ? accessToken(env, request) : match ? score(env, request, match[1]) : deepLinkResponse(env, request)
}
