import { Input as RuntimeInput } from '../input'
import { navigationTarget } from './navigation'
import type { Bindings } from '../../auth.server'
import { dashboardAuthority, type Actor } from '../actor'
import { requireAccess } from '../access'
import { all, commit, insist, newId, now, one, stmt, type Row } from '../core'
import { loadAssignment, prerequisiteMet, tryComplete } from '../learning'
import type { Input } from '../input'
import { requireCourseRole } from '../units'
import { packageRecord, revisionPackages } from './catalog'
import { applyRuntime, initialState, outcome, sessionSeconds, totalTime } from './state'
import type { PackageManifest } from './types'

export async function packageRequirements(env: Bindings, assignment: Row) {
  const packages = await revisionPackages(env, assignment.course_revision_id)
  const runs = await all(env, 'SELECT * FROM beam_package_runs WHERE assignment_id=?', assignment.id)
  return packages.map(pkg => ({ id: pkg.id, title: pkg.title, standard: pkg.standard, scos: pkg.manifest.scos.map(sco => {
    const run = runs.find(run => run.package_id === pkg.id && run.sco_id === sco.id)
    return { id: sco.id, title: sco.title, required: sco.required !== false, ...outcome(pkg.manifest.standard, sco, run ? JSON.parse(run.state_json) : {}), run: run?.id ?? null }
  }) }))
}
export async function launchPackage(env: Bindings, actor: Actor, input: Input) {
  insist(!actor.agent && !actor.viewAs, 'human_session_required', 403)
  const pkg = await packageRecord(env, input.text('package'))
  const manifest = pkg.manifest
  const scoId = input.text('sco', { optional: true }) || manifest.scos[0].id
  const sco = manifest.scos.find(sco => sco.id === scoId)
  insist(sco, 'sco_not_found', 404)
  const preview = input.flag('preview')
  let run: Row | null = null
  if (preview) await requireCourseRole(env, actor, pkg.course_id, 'author', 'reviewer')
  else {
    const assignment = await loadAssignment(env, actor, input.text('assignment'))
    insist(assignment.status === 'open', 'assignment_closed', 409)
    requireAccess(assignment)
    insist(await prerequisiteMet(env, assignment), 'prerequisite_incomplete', 409)
    insist(await one(env, 'SELECT 1 FROM beam_revision_packages WHERE course_revision_id=? AND package_id=?', assignment.course_revision_id, pkg.id), 'package_not_assigned', 403)
    const runs = await all(env, 'SELECT * FROM beam_package_runs WHERE assignment_id=? AND package_id=?', assignment.id, pkg.id)
    const satisfied = (id: string) => { const prior = manifest.scos.find(item => item.id === id); const run = runs.find(item => item.sco_id === id); return !!prior && !!run && (outcome(manifest.standard, prior, JSON.parse(run.state_json)).passed && outcome(manifest.standard, prior, JSON.parse(run.state_json)).completed) }
    insist(sco.prerequisites.every(satisfied), 'sco_prerequisite_incomplete', 409)
    const position = manifest.scos.indexOf(sco)
    if (manifest.sequencing?.flow && !manifest.sequencing.choice) {
      for (const prior of manifest.scos.slice(0, position)) insist(await one(env, 'SELECT 1 FROM beam_package_sessions s JOIN beam_package_runs r ON r.id=s.run_id WHERE r.assignment_id=? AND r.package_id=? AND r.sco_id=? AND s.ended_at IS NOT NULL', assignment.id, pkg.id, prior.id), 'sco_sequence_incomplete', 409)
    }
    if (manifest.sequencing?.forwardOnly) insist(!runs.some(run => manifest.scos.findIndex(item => item.id === run.sco_id) > position), 'sco_forward_only', 409)
    run = runs.find(run => run.sco_id === scoId) ?? null
    if (!run) {
      const id = newId()
      await env.DB.prepare('INSERT OR IGNORE INTO beam_package_runs(id,assignment_id,package_id,sco_id,state_json,updated_at) VALUES(?,?,?,?,?,?)').bind(id, assignment.id, pkg.id, scoId, '{}', now()).run()
      run = await one(env, 'SELECT * FROM beam_package_runs WHERE assignment_id=? AND package_id=? AND sco_id=?', assignment.id, pkg.id, scoId)
    }
  }
  const id = newId(), at = now()
  const initial = initialState(manifest.standard, run ? JSON.parse(run.state_json) : {}, { id: actor.id, name: actor.name }, sco)
  initial[manifest.standard === '1.2' ? 'cmi.core.total_time' : 'cmi.total_time'] = totalTime(manifest.standard, run?.total_time ?? 0)
  if (manifest.standard !== '1.2') {
    const at = manifest.scos.indexOf(sco)
    initial['adl.nav.request_valid.continue'] = String(!!manifest.sequencing?.flow && at < manifest.scos.length - 1)
    initial['adl.nav.request_valid.previous'] = String(!!manifest.sequencing?.flow && !manifest.sequencing.forwardOnly && at > 0)
    for (const target of manifest.scos) initial[`adl.nav.request_valid.choice.{target=${target.id}}`] = String(!!manifest.sequencing?.choice)
  }
  await commit(env, [
    ...(run ? [stmt(env, 'UPDATE beam_package_sessions SET ended_at=? WHERE run_id=? AND ended_at IS NULL', at, run.id)] : []),
    stmt(env, 'INSERT INTO beam_package_sessions(id,run_id,package_id,sco_id,actor_id,auth_session_id,preview,expires_at,initial_json) VALUES(?,?,?,?,?,?,?,?,?)', id, run?.id ?? null, pkg.id, scoId, actor.id, actor.sessionId, preview ? 1 : 0, at + 4 * 60 * 60 * 1000, JSON.stringify(initial)),
    stmt(env, 'INSERT INTO beam_package_events(id,run_id,session_id,event,payload_json,at) VALUES(?,?,?,?,?,?)', newId(), run?.id ?? null, id, 'launch', JSON.stringify({ package: pkg.id, sco: scoId, preview, resumed: !!run?.version }), at),
  ], { actor, action: 'package.launch', subject: pkg.id, detail: { preview, sco: scoId, run: run?.id ?? null } })
  return { id, href: `/app/packages/play/${id}` }
}

export async function playbackSession(env: Bindings, id: string, actor?: Actor) {
  const session = await one(env, 'SELECT * FROM beam_package_sessions WHERE id=?', id)
  insist(session && session.expires_at > now() && !session.ended_at, 'package_session_ended', 403)
  insist(!actor || actor.id === session.actor_id && actor.sessionId === session.auth_session_id && !actor.agent && !actor.viewAs, 'package_session_forbidden', 403)
  // Asset capabilities remain narrow and expire with the human's parent session and current access.
  const alive = await one(env, 'SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id JOIN beam_members m ON m.operator_id=o.id WHERE s.id=? AND m.id=? AND s.expires_at>? AND s.revoked_at IS NULL AND o.status=\'active\' AND s.operator_version=o.version AND (s.kind!=\'oidc\' OR EXISTS(SELECT 1 FROM oa_provider_sessions p JOIN oa_auth_settings a ON a.singleton=1 WHERE p.session_id=s.id AND a.idp_sign_in=1 AND a.generation=p.generation))', session.auth_session_id, session.actor_id, now())
  insist(alive, 'package_session_ended', 403)
  const current = actor ?? await dashboardAuthority(env, session.actor_id)
  insist(current, 'package_session_ended', 403)
  const pkg = await packageRecord(env, session.package_id), sco = pkg.manifest.scos.find(sco => sco.id === session.sco_id)!
  const run = session.run_id ? await one(env, 'SELECT * FROM beam_package_runs WHERE id=?', session.run_id) : null
  if (session.preview) await requireCourseRole(env, current, pkg.course_id, 'author', 'reviewer')
  else {
    insist(run, 'package_run_missing', 404)
    const assignment = await loadAssignment(env, current, run.assignment_id)
    requireAccess(assignment)
    insist(assignment.status === 'open' && await prerequisiteMet(env, assignment), 'assignment_closed', 409)
  }
  return { session, pkg, sco, run, actor: current }
}
export async function saveRuntime(env: Bindings, actor: Actor, input: Input) {
  const { session, pkg, sco, run } = await playbackSession(env, input.text('session'), actor)
  insist(!session.preview, 'preview_does_not_record', 409)
  const expected = input.integer('version', { min: 0 })!
  insist(expected === session.version, 'stale_package_session', 409)
  const values = input.json('values')
  insist(values && typeof values === 'object' && !Array.isArray(values), 'invalid_runtime_values', 422)
  const earlier = await one<{ payload_json: string }>(env, 'SELECT payload_json FROM beam_package_events WHERE session_id=? AND event IN (\'commit\',\'terminate\') ORDER BY at DESC,rowid DESC LIMIT 1', session.id)
  const initial = JSON.parse(earlier?.payload_json ?? session.initial_json) as Record<string, string>
  let state: Record<string, string>
  try { state = applyRuntime(pkg.manifest, sco, initial, values as Record<string, string>) } catch (error) {
    insist(false, 'invalid_runtime_data', 422, { reason: error instanceof Error ? error.message : 'invalid CMI' })
  }
  const event = input.text('event')
  insist(event === 'commit' || event === 'terminate', 'invalid_runtime_event')
  // Session time is cumulative within this launch; commits replace that contribution, never add it twice.
  const priorSeconds = earlier ? sessionSeconds(pkg.manifest.standard, JSON.parse(earlier.payload_json)) : 0
  const seconds = sessionSeconds(pkg.manifest.standard, state)
  insist(seconds >= priorSeconds, 'session_time_went_backwards', 422)
  const at = now()
  await commit(env, [
    stmt(env, 'UPDATE beam_package_runs SET state_json=?, total_time=total_time+?, version=version+1, updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM beam_package_sessions WHERE id=? AND version=? AND ended_at IS NULL)', JSON.stringify(state), seconds - priorSeconds, at, run!.id, session.id, expected),
    stmt(env, 'INSERT INTO beam_package_events(id,run_id,session_id,event,payload_json,at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM beam_package_sessions WHERE id=? AND version=? AND ended_at IS NULL)', newId(), run!.id, session.id, event, JSON.stringify(state), at, session.id, expected),
    stmt(env, 'UPDATE beam_package_sessions SET version=version+1, ended_at=? WHERE id=? AND version=? AND ended_at IS NULL', event === 'terminate' ? at : null, session.id, expected),
  ], { actor, action: 'package.runtime', subject: run!.id, detail: { event, version: expected } })
  const completion = await tryComplete(env, actor, run!.assignment_id)
  let next: string | null = null, navigationError: string | null = null
  if (!completion && event === 'terminate' && pkg.manifest.standard !== '1.2') {
    try {
      const target = navigationTarget(pkg.manifest, sco.id, state['adl.nav.request'])
      if (target?.exit) next = `/app/learn/${run!.assignment_id}`
      else if (target?.sco) next = (await launchPackage(env, actor, RuntimeInput.of({ package: pkg.id, assignment: run!.assignment_id, sco: target.sco }))).href
    } catch (error) { navigationError = error instanceof Error ? error.message : 'package_navigation_not_available' }
  }
  return { version: expected + 1, ...outcome(pkg.manifest.standard, sco, state), completion, next, navigationError }
}

export async function runtimeEvidence(env: Bindings, actor: Actor, assignment: string) {
  await loadAssignment(env, actor, assignment, { manage: true })
  const runs = await all(env, 'SELECT id,package_id,sco_id,state_json,total_time,version,updated_at FROM beam_package_runs WHERE assignment_id=? ORDER BY rowid', assignment)
  const events = await all(env, 'SELECT e.id,e.run_id,e.event,e.payload_json,e.at FROM beam_package_events e JOIN beam_package_runs r ON r.id=e.run_id WHERE r.assignment_id=? ORDER BY e.at,e.rowid', assignment)
  return { runs: runs.map(run => ({ ...run, state: JSON.parse(run.state_json) } as Row & {state: Record<string,string>})), events: events.map(event => ({ ...event, values: JSON.parse(event.payload_json) } as Row & {values: Record<string,string>})) }
}
