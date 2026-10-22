import type { Bindings } from '../../auth.server'
import { dashboardAuthority, type Actor } from '../actor'
import { requireAccess } from '../access'
import { all, commit, insist, newId, now, one, sha256Hex, stmt, type Row } from '../core'
import type { Input } from '../input'
import { loadAssignment, prerequisiteMet } from '../learning'
import { requireCourseRole } from '../units'
import { packageRecord } from './catalog'
import { xapiActor } from './xapi-launch'
import { xapiConnection } from './xapi-catalog'
import { recordCmi5 } from './cmi5-statements'
export const CMI5 = 'https://w3id.org/xapi/cmi5/'
export const CMI5_SESSION = `${CMI5}context/extensions/sessionid`
export const cmi5Hash = (text: string) => sha256Hex(new TextEncoder().encode(text))
export function cmi5Satisfied(moveOn: string, state: Row) {
  return moveOn === 'NotApplicable' || moveOn === 'Passed' && state.passed === true || moveOn === 'Completed' && state.completed === true || moveOn === 'CompletedAndPassed' && state.completed === true && state.passed === true || moveOn === 'CompletedOrPassed' && (state.completed === true || state.passed === true)
}
export async function cmi5Session(env: Bindings, id: string, { ended = false, replacingActor }: { ended?: boolean; replacingActor?: Actor } = {}) {
  const session = await one(env, 'SELECT s.*,c.registration,c.session_uuid,c.fetch_hash,c.auth_hash,c.fetched_at,c.lifecycle,c.resumed,c.busy,p.connection_id FROM beam_package_sessions s JOIN beam_cmi5_sessions c ON c.session_id=s.id JOIN beam_cmi5_packages p ON p.package_id=s.package_id WHERE s.id=?', id)
  insist(session && (replacingActor?.id === session.actor_id || session.expires_at > now()) && (ended || !session.ended_at), 'cmi5_session_ended', 403)
  const alive = await one(env, "SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id JOIN beam_members m ON m.operator_id=o.id WHERE s.id=? AND m.id=? AND s.expires_at>? AND s.revoked_at IS NULL AND o.status='active' AND s.operator_version=o.version AND (s.kind!='oidc' OR EXISTS(SELECT 1 FROM oa_provider_sessions p JOIN oa_auth_settings a ON a.singleton=1 WHERE p.session_id=s.id AND a.idp_sign_in=1 AND a.generation=p.generation))", session.auth_session_id, session.actor_id, now())
  insist(alive || replacingActor?.id === session.actor_id, 'cmi5_session_ended', 403)
  const actor = replacingActor ?? await dashboardAuthority(env, session.actor_id); insist(actor, 'cmi5_session_ended', 403)
  const pkg = await packageRecord(env, session.package_id), sco = pkg.manifest.scos.find(s => s.id === session.sco_id)!
  await xapiConnection(env, session.connection_id)
  const run = session.run_id ? await one(env, 'SELECT * FROM beam_package_runs WHERE id=?', session.run_id) : null
  if (session.preview) await requireCourseRole(env, actor, pkg.course_id, 'author', 'reviewer')
  else {
    insist(run, 'cmi5_run_missing', 403)
    const assignment = await loadAssignment(env, actor, run.assignment_id); requireAccess(assignment)
    insist(assignment.learner_id === actor.id && (ended || assignment.status === 'open') && await prerequisiteMet(env, assignment) && await one(env, 'SELECT 1 FROM beam_revision_packages WHERE course_revision_id=? AND package_id=?', assignment.course_revision_id, pkg.id), 'cmi5_assignment_unavailable', 403)
  }
  return { session, actor, pkg, sco, run, identity: await xapiActor(env, actor.id, session.connection_id) }
}
export type Cmi5Session = Awaited<ReturnType<typeof cmi5Session>>
export function cmi5Context(value: Cmi5Session) {
  return { registration: value.session.registration, contextActivities: { grouping: [{ id: value.sco.id }], category: [{ id: `${CMI5}context/categories/cmi5` }] }, extensions: { [CMI5_SESSION]: value.session.session_uuid } }
}
export async function launchCmi5(env: Bindings, actor: Actor, input: Input) {
  insist(!actor.agent && !actor.viewAs, 'human_session_required', 403)
  const pkg = await packageRecord(env, input.text('package')), sco = pkg.manifest.scos.find(s => s.id === (input.text('sco', { optional: true }) || pkg.manifest.scos[0].id))
  insist(pkg.standard === 'cmi5' && sco, 'cmi5_au_not_found', 404)
  const connection = await one(env, 'SELECT * FROM beam_cmi5_packages WHERE package_id=?', pkg.id); insist(connection, 'cmi5_connection_missing', 403)
  await xapiConnection(env, connection.connection_id)
  const preview = input.flag('preview'), at = now(), id = newId(), fetchToken = newId() + newId()
  let run: Row | null = null, registration = newId()
  if (preview) await requireCourseRole(env, actor, pkg.course_id, 'author', 'reviewer')
  else {
    const assignment = await loadAssignment(env, actor, input.text('assignment'))
    insist(assignment.learner_id === actor.id && assignment.status === 'open', 'cmi5_assignment_unavailable', 403)
    requireAccess(assignment); insist(await prerequisiteMet(env, assignment), 'prerequisite_incomplete', 409)
    insist(await one(env, 'SELECT 1 FROM beam_revision_packages WHERE course_revision_id=? AND package_id=?', assignment.course_revision_id, pkg.id), 'package_not_assigned', 403)
    await env.DB.prepare('INSERT OR IGNORE INTO beam_cmi5_registrations VALUES(?,?,?)').bind(assignment.id, pkg.id, registration).run()
    registration = (await one(env, 'SELECT registration FROM beam_cmi5_registrations WHERE assignment_id=? AND package_id=?', assignment.id, pkg.id))!.registration
    await env.DB.prepare("INSERT OR IGNORE INTO beam_package_runs(id,assignment_id,package_id,sco_id,state_json,updated_at) VALUES(?,?,?,?,'{}',?)").bind(newId(), assignment.id, pkg.id, sco.id, at).run()
    run = await one(env, 'SELECT * FROM beam_package_runs WHERE assignment_id=? AND package_id=? AND sco_id=?', assignment.id, pkg.id, sco.id)
    // End all interrupted AUs in this course registration, retaining their distinct sessions and original statements.
    const interrupted = await all(env, 'SELECT s.id,c.busy FROM beam_package_sessions s JOIN beam_cmi5_sessions c ON c.session_id=s.id WHERE c.registration=? AND s.ended_at IS NULL', registration)
    for (const prior of interrupted) {
      insist(!prior.busy || prior.busy < now(), 'cmi5_session_busy', 409)
      const value = await cmi5Session(env, prior.id, { ended: true, replacingActor: actor })
      await recordCmi5(env, value, 'abandoned')
      await commit(env, [stmt(env, 'UPDATE beam_package_sessions SET ended_at=? WHERE id=?', at, prior.id), stmt(env, "UPDATE beam_cmi5_sessions SET lifecycle='abandoned',auth_hash=NULL,active_registration=NULL WHERE session_id=?", prior.id)], { actor, action: 'cmi5.abandon', subject: value.session.session_uuid })
    }
  }
  const sessionUuid = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_package_sessions(id,run_id,package_id,sco_id,actor_id,auth_session_id,preview,expires_at,initial_json) VALUES(?,?,?,?,?,?,?,?,?)', id, run?.id ?? null, pkg.id, sco.id, actor.id, actor.sessionId, preview ? 1 : 0, at + 4 * 60 * 60 * 1000, '{}'), stmt(env, 'INSERT INTO beam_cmi5_sessions(session_id,registration,session_uuid,fetch_hash,resumed,active_registration) VALUES(?,?,?,?,?,?)', id, registration, sessionUuid, await cmi5Hash(fetchToken), run?.version ? 1 : 0, registration)], { actor, action: 'cmi5.launch', subject: sessionUuid, detail: { package: pkg.id, sco: sco.id, registration, preview, resumed: !!run?.version } })
  const value = await cmi5Session(env, id)
  await recordCmi5(env, value, 'launched')
  await env.DB.prepare("UPDATE beam_cmi5_sessions SET lifecycle='launched' WHERE session_id=?").bind(id).run()
  const asset = new URL(`/beam-package/${id}/${sco.launch.split('/').map(encodeURIComponent).join('/')}`, env.AUTH_ORIGIN)
  asset.searchParams.set('endpoint', `${env.AUTH_ORIGIN}/api/beam/cmi5/${id}/`)
  asset.searchParams.set('fetch', `${env.AUTH_ORIGIN}/api/beam/cmi5/${id}/fetch/${fetchToken}`)
  asset.searchParams.set('actor', JSON.stringify(value.identity)); asset.searchParams.set('registration', registration); asset.searchParams.set('activityId', sco.id)
  // Store only the one-time fetch capability in the session's existing private initial payload; archives withhold it.
  await env.DB.prepare('UPDATE beam_package_sessions SET initial_json=? WHERE id=?').bind(JSON.stringify({ cmi5Asset: asset.href }), id).run()
  return { id, href: `/app/packages/play/${id}`, registration, sessionId: value.session.session_uuid }
}
export async function cmi5Evidence(env: Bindings, actor: Actor, assignment: string) {
  await loadAssignment(env, actor, assignment, { manage: true })
  const sessions = await all(env, 'SELECT s.id,s.package_id,s.sco_id,s.preview,s.ended_at,c.registration,c.session_uuid,c.lifecycle,c.resumed FROM beam_package_sessions s JOIN beam_cmi5_sessions c ON c.session_id=s.id JOIN beam_package_runs r ON r.id=s.run_id WHERE r.assignment_id=? ORDER BY s.rowid', assignment)
  const statements = await all(env, 'SELECT t.* FROM beam_cmi5_statements t JOIN beam_package_sessions s ON s.id=t.session_id JOIN beam_package_runs r ON r.id=s.run_id WHERE r.assignment_id=? ORDER BY t.received_at,t.rowid', assignment)
  return { sessions, statements: statements.map(s => ({ ...s, statement: JSON.parse(s.original_json) } as Row & {statement: unknown})) }
}
