import type { Bindings } from '../../auth.server'
import { BeamError, commit, insist, now, one, sha256Hex, stmt, type Row } from '../core'
import { openSecret } from '../integration-secrets'
import { store, serve } from '../files'
import { tryComplete, loadAssignment } from '../learning'
import type { Actor } from '../actor'
import { lrsAuthorization, xapiConnection } from './xapi-catalog'
import { liveXapiLaunch, xapiActor } from './xapi-launch'
import { getStatement, sendStatements } from './xapi-client'
import { normalizeUuid, parseXapiRequest, statementDigest, statementOutcome, validateStatement, type XapiStatement } from './xapi-protocol'

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-experience-api-version': '1.0.3' } })
const digest = (value: string) => sha256Hex(new TextEncoder().encode(value))
function same(left: string, right: string) { let difference = left.length ^ right.length; for (let i = 0; i < Math.max(left.length, right.length); i++) difference |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0); return difference === 0 }
function contains(actual: unknown, expected: unknown): boolean {
  if (!expected || typeof expected !== 'object') return actual === expected
  if (!actual || typeof actual !== 'object' || Array.isArray(actual) !== Array.isArray(expected)) return false
  if (Array.isArray(expected) && (actual as unknown[]).length !== expected.length) return false
  return Object.entries(expected).every(([key, value]) => contains((actual as Record<string, unknown>)[key], value))
}
async function producer(env: Bindings, request: Request) {
  const header = request.headers.get('authorization') ?? ''
  insist(header.startsWith('Basic '), 'xapi_producer_required', 401)
  let decoded = ''
  try { decoded = atob(header.slice(6)) } catch { /* uniform credential refusal below */ }
  const split = decoded.indexOf(':'), id = decoded.slice(0, split), key = decoded.slice(split + 1)
  const activity = await one(env, 'SELECT * FROM beam_xapi_activities WHERE id=? AND revoked_at IS NULL', id)
  insist(activity && split > 0 && same(await digest(key), await digest(await openSecret(env, activity.producer_sealed, `xapi-producer:${id}`))), 'xapi_producer_required', 401)
  await xapiConnection(env, activity.connection_id)
  return activity!
}
async function ingest(env: Bindings, request: Request) {
  const activity = await producer(env, request)
  insist(request.headers.get('x-experience-api-version') === '1.0.3', 'xapi_version_required', 400)
  const batch = await parseXapiRequest(request)
  const url = new URL(request.url)
  if (request.method === 'PUT') insist(batch.statements.length === 1 && normalizeUuid(url.searchParams.get('statementId')) === normalizeUuid(batch.statements[0].id), 'xapi_statement_id_mismatch', 400)
  const validated: { original: XapiStatement; statement: XapiStatement; launch: Row; digest: string; duplicate: boolean; actor: Actor }[] = []
  for (const original of batch.statements) {
    const registration = normalizeUuid(original.context?.registration)
    const launch = await one(env, 'SELECT * FROM beam_xapi_launches WHERE registration=? AND activity_id=?', registration, activity.id)
    insist(launch, 'xapi_registration_mismatch', 403)
    const statement = validateStatement(original, { actor: await xapiActor(env, launch.actor_id, activity.connection_id), activity: activity.activity_iri, registration })
    const fingerprint = await statementDigest(statement), prior = await one(env, 'SELECT * FROM beam_xapi_statements WHERE id=?', statement.id)
    insist(!prior || prior.launch_id === launch.id && prior.digest === fingerprint, 'xapi_statement_conflict', 409)
    const duplicate = prior?.status === 'accepted', actor = await liveXapiLaunch(env, launch, { duplicate })
    const outcome = statementOutcome(statement)
    const other = validated.find(item => item.launch.id === launch.id && ['passed', 'failed'].includes(statementOutcome(item.statement)) && statementOutcome(item.statement) !== outcome)
    insist(duplicate || !(outcome === 'passed' && ['failed', 'pending-failed'].includes(launch.outcome) || outcome === 'failed' && ['passed', 'pending-passed'].includes(launch.outcome) || ['passed', 'failed'].includes(outcome) && other), 'xapi_contradictory_result', 409)
    validated.push({ original, statement, launch, digest: fingerprint, duplicate, actor })
  }
  const fresh = validated.filter(item => !item.duplicate)
  if (!fresh.length) return request.method === 'PUT' ? new Response(null, { status: 204, headers: { 'x-experience-api-version': '1.0.3' } }) : json(validated.map(item => item.statement.id))
  // Reserve terminal outcome atomically before a network write; competing contradictory results cannot both map.
  for (const item of fresh) {
    const outcome = statementOutcome(item.statement)
    if (!['passed', 'failed'].includes(outcome)) continue
    const claim = await env.DB.prepare("UPDATE beam_xapi_launches SET outcome=CASE WHEN outcome='pending' THEN ? ELSE outcome END WHERE id=? AND ended_at IS NULL AND outcome IN ('pending',?)").bind(`pending-${outcome}`, item.launch.id, `pending-${outcome}`).run()
    insist(claim.meta.changes === 1, 'xapi_contradictory_result', 409)
  }
  const at = now()
  const stored = await Promise.all(batch.attachments.map(async part => ({ ...part, stored: await store(env, { filename: `${part.sha256}.bin`, bytes: part.bytes }) })))
  await commit(env, fresh.flatMap(item => [
    stmt(env, "INSERT OR IGNORE INTO beam_xapi_statements(id,launch_id,digest,original_json,status,received_at) VALUES(?,?,?,?,'pending',?)", item.statement.id, item.launch.id, item.digest, JSON.stringify(item.original), at),
    ...stored.filter(part => (item.statement.attachments ?? []).some((metadata: Row) => metadata.sha2 === part.sha256)).map(part => stmt(env, 'INSERT OR IGNORE INTO beam_xapi_attachments VALUES(?,?,?,?,?)', item.statement.id, part.sha256, part.bytes.length, part.contentType, part.stored.filename)),
  ]), { actor: fresh[0].actor, action: 'xapi.receive', subject: activity.id, detail: { statements: fresh.map(item => item.statement.id), registration: fresh[0].launch.registration } })
  // A concurrent same-ID submission must match the row actually retained before any outbound write.
  for (const item of fresh) {
    const retained = await one(env, 'SELECT digest,launch_id FROM beam_xapi_statements WHERE id=?', item.statement.id)
    insist(retained?.digest === item.digest && retained.launch_id === item.launch.id, 'xapi_statement_conflict', 409)
  }
  try {
    const connection = await lrsAuthorization(env, activity.connection_id)
    const attachments = batch.attachments.filter(part => fresh.some(item => (item.statement.attachments ?? []).some((metadata: Row) => metadata.sha2 === part.sha256)))
    await sendStatements(connection.endpoint, connection.authorization, fresh.map(item => item.statement), attachments)
    for (const item of fresh) {
      const receipt = await getStatement(connection.endpoint, connection.authorization, item.statement.id, true)
      insist(contains(receipt.statement, item.statement), 'xapi_lrs_readback_mismatch', 502)
      for (const part of attachments.filter(part => (item.statement.attachments ?? []).some((metadata: Row) => metadata.sha2 === part.sha256))) insist(receipt.attachments.some(stored => stored.sha256 === part.sha256 && stored.bytes.length === part.bytes.length), 'xapi_lrs_attachment_mismatch', 502)
      await liveXapiLaunch(env, item.launch)
      await xapiConnection(env, activity.connection_id)
      const outcome = statementOutcome(item.statement), accepted = now()
      await commit(env, [
        stmt(env, "UPDATE beam_xapi_statements SET status='accepted',accepted_at=?,lrs_stored=?,failure=NULL WHERE id=? AND digest=?", accepted, typeof receipt.statement.stored === 'string' ? receipt.statement.stored : null, item.statement.id, item.digest),
        ...(['passed', 'failed'].includes(outcome) ? [stmt(env, 'UPDATE beam_xapi_launches SET outcome=?,ended_at=? WHERE id=? AND outcome IN (\'pending\',?)', outcome, accepted, item.launch.id, `pending-${outcome}`)] : []),
      ], { actor: item.actor, action: 'xapi.accept', subject: item.statement.id, detail: { launch: item.launch.id, outcome, rule: activity.rule } })
    }
    for (const item of fresh) await tryComplete(env, item.actor, item.launch.assignment_id)
    return request.method === 'PUT' ? new Response(null, { status: 204, headers: { 'x-experience-api-version': '1.0.3' } }) : json(validated.map(item => item.statement.id))
  } catch (error) {
    const code = error instanceof BeamError ? error.code : 'xapi_lrs_unavailable'
    for (const item of fresh) await env.DB.prepare("UPDATE beam_xapi_statements SET failure=? WHERE id=? AND status='pending'").bind(code, item.statement.id).run()
    throw error
  }
}
/** A producer credential is independent of every learner's browser credentials. */
export async function xapiPublicResponse(env: Bindings, request: Request): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/beam/xapi/statements') return null
  if (!['POST', 'PUT'].includes(request.method)) return json({ error: 'method_not_allowed' }, 405)
  try { return await ingest(env, request) } catch (error) { return json({ error: error instanceof BeamError ? error.code : 'xapi_refused' }, error instanceof BeamError ? error.status : 500) }
}
export async function xapiAttachment(env: Bindings, actor: Actor, statement: string, hash: string) {
  const row = await one(env, 'SELECT a.*,l.assignment_id FROM beam_xapi_attachments a JOIN beam_xapi_statements s ON s.id=a.statement_id JOIN beam_xapi_launches l ON l.id=s.launch_id WHERE a.statement_id=? AND a.sha256=?', statement, hash)
  insist(row, 'not_found', 404)
  await loadAssignment(env, actor, row.assignment_id, { manage: true })
  return serve(env, { filename: row.filename, mediaType: row.media_type, size: row.size, sha256: row.sha256 }, { download: true })
}
