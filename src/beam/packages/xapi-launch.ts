import type { Bindings } from '../../auth.server'
import { dashboardAuthority, type Actor } from '../actor'
import { requireAccess } from '../access'
import { all, commit, insist, newId, now, one, stmt, type Row } from '../core'
import type { Input } from '../input'
import { loadAssignment, prerequisiteMet } from '../learning'
import { revisionXapi, xapiConnection, xapiUrl } from './xapi-catalog'

export async function xapiActor(env: Bindings, id: string, connection: string) {
  await env.DB.prepare('INSERT OR IGNORE INTO beam_xapi_actors VALUES(?,?,?)').bind(connection, id, newId()).run()
  const identity = await one(env, 'SELECT actor_name FROM beam_xapi_actors WHERE connection_id=? AND learner_id=?', connection, id)
  return { objectType: 'Agent', account: { homePage: env.AUTH_ORIGIN, name: identity!.actor_name as string } }
}
export async function xapiRequirements(env: Bindings, assignment: Row) {
  const activities = await revisionXapi(env, assignment.course_revision_id)
  const result = []
  for (const activity of activities) {
    const launch = await one(env, 'SELECT id,registration,outcome FROM beam_xapi_launches WHERE assignment_id=? AND activity_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1', assignment.id, activity.id)
    const trusted = await one(env, 'SELECT 1 FROM beam_xapi_activities a JOIN beam_xapi_connections c ON c.id=a.connection_id WHERE a.id=? AND a.revoked_at IS NULL AND c.revoked_at IS NULL', activity.id)
    result.push({ ...activity, id: activity.id as string, title: activity.title as string, launch_url: activity.launch_url as string, rule: activity.rule as string, launch: launch?.id ?? null, registration: launch?.registration ?? null, passed: !!trusted && launch?.outcome === 'passed', failed: launch?.outcome === 'failed' })
  }
  return result
}
export async function launchXapi(env: Bindings, actor: Actor, input: Input) {
  insist(!actor.agent && !actor.viewAs, 'human_session_required', 403)
  const assignment = await loadAssignment(env, actor, input.text('assignment'))
  insist(assignment.learner_id === actor.id && assignment.status === 'open', 'xapi_assignment_unavailable', 403)
  requireAccess(assignment); insist(await prerequisiteMet(env, assignment), 'prerequisite_incomplete', 409)
  const activity = await one(env, 'SELECT a.* FROM beam_xapi_activities a JOIN beam_revision_xapi r ON r.activity_id=a.id WHERE r.course_revision_id=? AND a.id=? AND a.revoked_at IS NULL', assignment.course_revision_id, input.text('activity'))
  insist(activity, 'xapi_activity_not_assigned', 403)
  await xapiConnection(env, activity.connection_id)
  const href = new URL(xapiUrl(env, activity.launch_url))
  const prior = await one(env, 'SELECT * FROM beam_xapi_launches WHERE assignment_id=? AND activity_id=? AND auth_session_id=? AND expires_at>? AND ended_at IS NULL ORDER BY created_at DESC,rowid DESC LIMIT 1', assignment.id, activity.id, actor.sessionId, now())
  const id = prior?.id ?? newId(), registration = prior?.registration ?? newId(), at = now()
  if (!prior) await commit(env, [stmt(env, 'UPDATE beam_xapi_launches SET ended_at=? WHERE assignment_id=? AND activity_id=? AND ended_at IS NULL', at, assignment.id, activity.id), stmt(env, 'INSERT INTO beam_xapi_launches(id,assignment_id,activity_id,actor_id,auth_session_id,registration,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)', id, assignment.id, activity.id, actor.id, actor.sessionId, registration, at, at + 4 * 60 * 60 * 1000)], { actor, action: 'xapi.launch', subject: id, detail: { assignment: assignment.id, activity: activity.id, registration } })
  const identity = await xapiActor(env, actor.id, activity.connection_id)
  href.searchParams.set('actor', JSON.stringify(identity))
  href.searchParams.set('registration', registration)
  href.searchParams.set('activity_id', activity.activity_iri)
  href.searchParams.set('endpoint', `${env.AUTH_ORIGIN}/api/beam/xapi/`)
  return { id, registration, href: href.href, actor: identity, activity: activity.activity_iri }
}
export async function liveXapiLaunch(env: Bindings, launch: Row, { duplicate = false } = {}) {
  const alive = await one(env, "SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id JOIN beam_members m ON m.operator_id=o.id WHERE s.id=? AND m.id=? AND s.expires_at>? AND s.revoked_at IS NULL AND o.status='active' AND s.operator_version=o.version AND (s.kind!='oidc' OR EXISTS(SELECT 1 FROM oa_provider_sessions p JOIN oa_auth_settings a ON a.singleton=1 WHERE p.session_id=s.id AND a.idp_sign_in=1 AND a.generation=p.generation))", launch.auth_session_id, launch.actor_id, now())
  insist(alive && launch.expires_at > now(), 'xapi_launch_expired', 403)
  insist(duplicate || !launch.ended_at, 'xapi_launch_ended', 409)
  const actor = await dashboardAuthority(env, launch.actor_id)
  insist(actor, 'xapi_launch_expired', 403)
  const assignment = await loadAssignment(env, actor!, launch.assignment_id)
  requireAccess(assignment)
  insist((duplicate || assignment.status === 'open') && await prerequisiteMet(env, assignment) && await one(env, 'SELECT 1 FROM beam_revision_xapi WHERE course_revision_id=? AND activity_id=?', assignment.course_revision_id, launch.activity_id), 'xapi_assignment_unavailable', 403)
  return actor!
}
export async function xapiEvidence(env: Bindings, actor: Actor, assignment: string) {
  await loadAssignment(env, actor, assignment, { manage: true })
  const launches = await all(env, 'SELECT id,activity_id,registration,created_at,expires_at,ended_at,outcome FROM beam_xapi_launches WHERE assignment_id=? ORDER BY created_at,rowid', assignment)
  const statements = await all(env, 'SELECT s.* FROM beam_xapi_statements s JOIN beam_xapi_launches l ON l.id=s.launch_id WHERE l.assignment_id=? ORDER BY s.received_at,s.rowid', assignment)
  const attachments = await all(env, 'SELECT a.* FROM beam_xapi_attachments a JOIN beam_xapi_statements s ON s.id=a.statement_id JOIN beam_xapi_launches l ON l.id=s.launch_id WHERE l.assignment_id=?', assignment)
  return { launches, statements: statements.map(s => ({ ...s, statement: JSON.parse(s.original_json) } as Row & { statement: unknown })), attachments }
}
