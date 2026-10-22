import type { Bindings } from '../../auth.server'
import { BeamError, all, commit, insist, newId, now, one, stmt } from '../core'
import { tryComplete } from '../learning'
import { canonicalJSON, parseXapiRequest, statementDigest, validateStatement, readBoundedBytes, parseXapiJson } from './xapi-protocol'
import { CMI5, CMI5_SESSION, cmi5Context, cmi5Hash, cmi5Session, cmi5Satisfied, type Cmi5Session } from './cmi5-runtime'
import { cmi5Contains, recordCmi5, retainCmi5, verbs } from './cmi5-statements'
const headers = { 'cache-control': 'no-store', 'x-experience-api-version': '1.0.3', 'access-control-allow-origin': 'null', 'access-control-allow-methods': 'GET,POST,PUT,OPTIONS', 'access-control-allow-headers': 'Authorization,Content-Type,X-Experience-API-Version,If-Match,If-None-Match', 'access-control-expose-headers': 'ETag' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
async function accept(env: Bindings, request: Request, value: Cmi5Session) {
  const batch = await parseXapiRequest(request)
  insist(batch.statements.length === 1 && !batch.attachments.length, 'cmi5_single_statement_without_attachments_required', 422)
  const original = batch.statements[0], statement = validateStatement(original, { actor: value.identity, activity: value.sco.id, registration: value.session.registration })
  if (request.method === 'PUT') insist(new URL(request.url).searchParams.get('statementId') === statement.id, 'cmi5_statement_id_mismatch', 400)
  insist(cmi5Contains(statement.context, cmi5Context(value)), 'cmi5_context_mismatch', 403)
  const digest = await statementDigest(statement), prior = await one(env, 'SELECT * FROM beam_cmi5_statements WHERE id=?', statement.id)
  insist(!prior || prior.digest === digest && prior.session_id === value.session.id, 'cmi5_statement_conflict', 409)
  if (prior?.status === 'accepted') return json([statement.id])
  insist(!value.session.ended_at && !['abandoned', 'terminated', 'restored', 'launching'].includes(value.session.lifecycle), 'cmi5_session_ended', 403)
  const verb = Object.keys(verbs).find(name => verbs[name] === statement.verb.id) ?? 'allowed'
  insist(!['launched', 'abandoned', 'satisfied'].includes(verb), 'cmi5_lms_verb_forbidden', 403)
  const sessionVerbs = await all(env, "SELECT verb,id FROM beam_cmi5_statements WHERE session_id=? AND status='accepted'", value.session.id)
  insist(verb === 'initialized' ? !sessionVerbs.some(s => s.verb !== 'launched') : sessionVerbs.some(s => s.verb === 'initialized'), 'cmi5_initialize_first', 409)
  insist(verb === 'allowed' || !sessionVerbs.some(s => s.verb === verb), 'cmi5_duplicate_verb', 409)
  insist(!(verb === 'passed' && sessionVerbs.some(s => s.verb === 'failed') || verb === 'failed' && sessionVerbs.some(s => s.verb === 'passed')), 'cmi5_contradictory_result', 409)
  insist(!value.session.preview || ['initialized', 'terminated', 'allowed'].includes(verb), 'cmi5_preview_does_not_record', 409)
  const state = JSON.parse(value.run?.state_json ?? '{}')
  insist(!(verb === 'completed' && state.completed || verb === 'passed' && state.passed || verb === 'failed' && state.passed), 'cmi5_registration_result_already_recorded', 409)
  const result = statement.result
  if (verb === 'passed' || verb === 'failed') {
    insist(result?.success === (verb === 'passed') && typeof result.duration === 'string', 'cmi5_invalid_result', 422)
    if (value.sco.masteryScore !== null && result.score?.scaled !== undefined) insist((result.score.scaled >= value.sco.masteryScore) === (verb === 'passed'), 'cmi5_mastery_score_mismatch', 422)
  }
  if (verb === 'completed') insist(result?.completion === true && typeof result.duration === 'string', 'cmi5_invalid_result', 422)
  if (verb === 'terminated') insist(typeof result?.duration === 'string', 'cmi5_duration_required', 422)
  const moveon = statement.context.contextActivities?.category?.some((a: {id:string}) => a.id === `${CMI5}context/categories/moveon`)
  insist(!!moveon === (result?.success !== undefined || result?.completion !== undefined), 'cmi5_moveon_category_mismatch', 422)
  await retainCmi5(env, value, original, verb)
  // Current access is checked again after the external write and verified readback.
  await cmi5Session(env, value.session.id)
  if (value.run && !value.session.preview) {
    const accepted = await all(env, "SELECT t.verb FROM beam_cmi5_statements t JOIN beam_package_sessions s ON s.id=t.session_id WHERE s.run_id=? AND t.status='accepted'", value.run.id)
    const next = { completed: accepted.some(s => s.verb === 'completed'), passed: accepted.some(s => s.verb === 'passed'), failed: verb === 'failed' || state.failed === true && !accepted.some(s => s.verb === 'passed') }
    await commit(env, [stmt(env, 'UPDATE beam_package_runs SET state_json=?,version=version+1,updated_at=? WHERE id=?', JSON.stringify(next), now(), value.run.id)], { actor: value.actor, action: 'cmi5.progress', subject: value.run.id, detail: { session: value.session.session_uuid, registration: value.session.registration, verb } })
  }
  if (verb === 'terminated') await commit(env, [stmt(env, 'UPDATE beam_package_sessions SET ended_at=? WHERE id=?', now(), value.session.id), stmt(env, "UPDATE beam_cmi5_sessions SET lifecycle='terminated',active_registration=NULL WHERE session_id=?", value.session.id)], { actor: value.actor, action: 'cmi5.terminate', subject: value.session.id })
  else if (verb === 'initialized') await env.DB.prepare("UPDATE beam_cmi5_sessions SET lifecycle='initialized' WHERE session_id=?").bind(value.session.id).run()
  // Wait for termination before closing the assignment, so the AU can finish its protocol.
  if (verb === 'terminated' && value.run) {
    const runs = await all(env, 'SELECT sco_id,state_json FROM beam_package_runs WHERE assignment_id=? AND package_id=?', value.run.assignment_id, value.pkg.id)
    if (value.pkg.manifest.scos.every(sco => cmi5Satisfied(sco.moveOn!, JSON.parse(runs.find(r => r.sco_id === sco.id)?.state_json ?? '{}')))) await recordCmi5(env, value, 'satisfied')
    await tryComplete(env, value.actor, value.run.assignment_id)
  }
  return request.method === 'PUT' ? new Response(null, { status: 204, headers }) : json([statement.id])
}
async function stateResponse(env: Bindings, request: Request, value: Cmi5Session) {
  insist(!value.session.ended_at, 'cmi5_session_ended', 403)
  const url = new URL(request.url), id = url.searchParams.get('stateId')
  let agent: unknown
  try { agent = JSON.parse(url.searchParams.get('agent') ?? '') } catch { insist(false, 'cmi5_agent_required', 400) }
  insist(canonicalJSON(agent) === canonicalJSON(value.identity) && url.searchParams.get('activityId') === value.sco.id && url.searchParams.get('registration') === value.session.registration, 'cmi5_state_scope_mismatch', 403)
  insist(id && id.length <= 200, 'cmi5_state_id_required', 422)
  if (id === 'LMS.LaunchData') {
    insist(request.method === 'GET', 'cmi5_launch_data_read_only', 403)
    return json({ contextTemplate: cmi5Context(value), launchMode: value.session.preview ? 'Browse' : 'Normal', moveOn: value.sco.moveOn, ...(value.sco.masteryScore === null ? {} : { masteryScore: value.sco.masteryScore }), launchParameters: value.sco.launchParameters ?? '' })
  }
  insist(!id.startsWith('LMS.'), 'cmi5_reserved_state', 403)
  insist(value.run && !value.session.preview, 'cmi5_preview_does_not_record', 409)
  const args = [value.run.assignment_id, value.pkg.id, value.sco.id, id]
  const row = await one(env, 'SELECT * FROM beam_cmi5_state WHERE assignment_id=? AND package_id=? AND sco_id=? AND state_id=?', ...args)
  if (request.method === 'GET') return row ? new Response(row.body, { headers: { ...headers, 'content-type': 'application/json', etag: row.etag } }) : new Response(null, { status: 404, headers })
  insist(request.method === 'PUT', 'method_not_allowed', 405)
  insist(request.headers.get('content-type')?.startsWith('application/json'), 'cmi5_json_state_required', 415)
  const body = JSON.stringify(parseXapiJson(await readBoundedBytes(request, 64000))), etag = `"${await cmi5Hash(body)}"`
  insist(row ? request.headers.get('if-match') === row.etag : request.headers.get('if-none-match') === '*', 'cmi5_state_precondition', 412)
  const saved = row ? await env.DB.prepare('UPDATE beam_cmi5_state SET body=?,etag=? WHERE assignment_id=? AND package_id=? AND sco_id=? AND state_id=? AND etag=?').bind(body, etag, ...args, row.etag).run() : await env.DB.prepare('INSERT OR IGNORE INTO beam_cmi5_state VALUES(?,?,?,?,?,?)').bind(...args, body, etag).run()
  insist(saved.meta.changes === 1, 'cmi5_state_precondition', 412)
  return new Response(null, { status: 204, headers: { ...headers, etag } })
}
export async function cmi5PublicResponse(env: Bindings, request: Request): Promise<Response | null> {
  const url = new URL(request.url), match = url.pathname.match(/^\/api\/beam\/cmi5\/([\w-]+)\/(fetch\/[\w-]+|statements|activities\/state)$/)
  if (!match) return null
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  try {
    const value = await cmi5Session(env, match[1], { ended: true })
    if (match[2].startsWith('fetch/')) {
      insist(request.method === 'POST', 'method_not_allowed', 405)
      insist(!value.session.ended_at && value.session.lifecycle === 'launched' && await cmi5Hash(match[2].slice(6)) === value.session.fetch_hash, 'cmi5_fetch_refused', 403)
      const token = btoa(`${value.session.id}:${newId()}${newId()}`)
      const fetched = await env.DB.prepare('UPDATE beam_cmi5_sessions SET auth_hash=?,fetched_at=? WHERE session_id=? AND fetched_at IS NULL').bind(await cmi5Hash(`Basic ${token}`), now(), value.session.id).run()
      return fetched.meta.changes === 1 ? json({ 'auth-token': token }) : json({ error: { code: '1', text: 'Already used' } })
    }
    insist(value.session.auth_hash && await cmi5Hash(request.headers.get('authorization') ?? '') === value.session.auth_hash, 'cmi5_scoped_credential_required', 401)
    insist(request.headers.get('x-experience-api-version') === '1.0.3', 'xapi_version_required', 400)
    if (match[2] === 'activities/state') return await stateResponse(env, request, value)
    insist(['POST', 'PUT'].includes(request.method), 'method_not_allowed', 405)
    const lock = await env.DB.prepare('UPDATE beam_cmi5_sessions SET busy=1 WHERE session_id=? AND busy=0').bind(value.session.id).run()
    insist(lock.meta.changes === 1, 'cmi5_session_busy', 409)
    try { return await accept(env, request, await cmi5Session(env, value.session.id, { ended: true })) }
    finally { await env.DB.prepare('UPDATE beam_cmi5_sessions SET busy=0 WHERE session_id=?').bind(value.session.id).run() }
  } catch (error) { return json({ error: error instanceof BeamError ? error.code : 'cmi5_refused' }, error instanceof BeamError ? error.status : 500) }
}
