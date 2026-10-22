import type { Bindings } from '../../auth.server'
import { requireOwner, type Actor } from '../actor'
import { all, commit, insist, newId, now, one, stmt } from '../core'
import { editDraft, loadCourse } from '../courses'
import type { Input } from '../input'
import { openSecret, sealSecret } from '../integration-secrets'
import { probeLrs } from './xapi-client'

export function xapiOwner(actor: Actor) { requireOwner(actor); insist(!actor.agent && !actor.viewAs, 'human_session_required', 403) }
/** Explicit deployment allowlist; local HTTP is limited to a local installation's isolated sandbox. */
export function xapiUrl(env: Bindings, value: string) {
  let url: URL
  try { url = new URL(value) } catch { insist(false, 'invalid_xapi_url', 422) }
  const hosts = (env.BEAM_XAPI_HOSTS ?? '').split(',').map(x => x.trim().toLowerCase())
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname) && ['127.0.0.1', 'localhost'].includes(new URL(env.AUTH_ORIGIN).hostname) && env.BEAM_XAPI_LOCAL_SANDBOX === 'true'
  insist(!url.username && !url.password && !url.hash && !url.search && (local && url.protocol === 'http:' || url.protocol === 'https:' && !url.port && hosts.includes(url.hostname) && /^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]+$/.test(url.hostname) && !/(?:^|\.)(localhost|local|internal|lan|home)$/.test(url.hostname)), 'xapi_host_not_admitted', 403)
  return url.href
}
export async function connectLrs(env: Bindings, actor: Actor, input: Input) {
  xapiOwner(actor); insist(input.flag('consent'), 'xapi_consent_required', 422)
  const endpoint = xapiUrl(env, input.text('endpoint', { max: 2048 }))
  insist(endpoint.endsWith('/'), 'xapi_endpoint_needs_slash', 422)
  const username = input.text('key', { max: 512 }), password = input.text('secret', { max: 512 })
  insist(!username.includes(':') && /^[\x21-\x7e]+$/.test(username + password), 'invalid_xapi_credential', 422)
  const authorization = `Basic ${btoa(`${username}:${password}`)}`
  await probeLrs(endpoint, authorization)
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_xapi_connections VALUES(?,?,?,?,?,?,NULL)', id, input.text('name', { max: 120 }), endpoint, await sealSecret(env, authorization, `xapi-lrs:${id}`), actor.id, now())], { actor, action: 'xapi.connect', subject: id, detail: { endpoint, consent: true } })
  return { id }
}
export async function xapiConnection(env: Bindings, id: string) {
  const row = await one(env, 'SELECT * FROM beam_xapi_connections WHERE id=? AND revoked_at IS NULL', id)
  insist(row, 'xapi_connection_unavailable', 403)
  xapiUrl(env, row.endpoint)
  return row!
}
export async function createXapiActivity(env: Bindings, actor: Actor, input: Input) {
  xapiOwner(actor); insist(input.flag('consent'), 'xapi_consent_required', 422)
  const course = await loadCourse(env, input.text('course')), connection = await xapiConnection(env, input.text('connection'))
  insist(course.draft_version === input.integer('draftVersion'), 'stale_draft', 409)
  const activity = xapiUrl(env, input.text('activityIri', { max: 2048 })), launch = xapiUrl(env, input.text('launchUrl', { max: 2048 }))
  insist(new URL(activity).origin === new URL(launch).origin, 'xapi_activity_origin_mismatch', 422)
  const sources = input.list('sources')
  for (const source of sources) insist(await one(env, 'SELECT 1 FROM beam_source_versions WHERE id=?', source), 'source_version_not_found', 404)
  const key = input.text('producerSecret', { max: 512 })
  insist(key.length >= 16 && /^[\x21-\x7e]+$/.test(key), 'invalid_xapi_credential', 422)
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_xapi_activities VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL)', id, course.id, connection.id, input.text('title', { max: 160 }), activity, launch, input.text('objectives', { max: 4000 }), JSON.stringify(sources), await sealSecret(env, key, `xapi-producer:${id}`), 'completed-and-passed', actor.id, now())], { actor, action: 'xapi.activity', subject: id, detail: { course: course.id, connection: connection.id, activity, launch, rule: 'completed-and-passed', consent: true } })
  const edited = await editDraft(env, actor, input, 'xapi.attach', draft => { (draft.xapiActivities ??= []).push(id) })
  return { id, draftVersion: edited.draftVersion, statementEndpoint: `${env.AUTH_ORIGIN}/api/beam/xapi/statements`, producerUsername: id }
}
export async function revokeXapi(env: Bindings, actor: Actor, input: Input) {
  xapiOwner(actor)
  const id = input.text('connection')
  insist(await one(env, 'SELECT 1 FROM beam_xapi_connections WHERE id=?', id), 'xapi_connection_unavailable', 404)
  await commit(env, [stmt(env, 'UPDATE beam_xapi_connections SET revoked_at=? WHERE id=?', now(), id)], { actor, action: 'xapi.revoke', subject: id })
  return { id }
}
export async function removeXapiActivity(env: Bindings, actor: Actor, input: Input) {
  xapiOwner(actor)
  return editDraft(env, actor, input, 'xapi.remove', draft => { draft.xapiActivities = (draft.xapiActivities ?? []).filter(id => id !== input.text('activity')) })
}
export async function xapiView(env: Bindings, actor: Actor) {
  xapiOwner(actor)
  return {
    connections: await all(env, 'SELECT id,name,endpoint,consent_at,revoked_at FROM beam_xapi_connections'),
    activities: await all(env, 'SELECT id,course_id,connection_id,title,activity_iri,launch_url,objectives,rule,created_at,revoked_at FROM beam_xapi_activities'),
  }
}
export async function revisionXapi(env: Bindings, revision: string) {
  return all(env, 'SELECT a.id,a.course_id,a.connection_id,a.title,a.activity_iri,a.launch_url,a.objectives,a.source_version_ids,a.rule FROM beam_revision_xapi r JOIN beam_xapi_activities a ON a.id=r.activity_id WHERE r.course_revision_id=? ORDER BY r.position', revision)
}
export async function lrsAuthorization(env: Bindings, id: string) {
  const connection = await xapiConnection(env, id)
  return { endpoint: connection.endpoint, authorization: await openSecret(env, connection.authorization_sealed, `xapi-lrs:${id}`) }
}
