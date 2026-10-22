import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt } from './core'
import type { Input } from './input'
export function erasureOwner(actor: Actor) { requireOwner(actor); insist(!actor.agent && !actor.viewAs, 'human_session_required', 403) }
export async function erasureSettings(env: Bindings, actor: Actor) {
  erasureOwner(actor)
  const [policy, holds, jobs] = await Promise.all([
    one(env, 'SELECT * FROM beam_erasure_policy WHERE singleton=1'),
    all(env, 'SELECT * FROM beam_erasure_holds ORDER BY placed_at DESC'),
    all(env, 'SELECT id,kind,subject_id,requested_at,phase,state,failure FROM beam_erasure_jobs ORDER BY requested_at DESC LIMIT 100'),
  ])
  return { policy, holds, jobs }
}
export async function saveErasurePolicy(env: Bindings, actor: Actor, input: Input) {
  erasureOwner(actor)
  const days = input.integer('assessmentDays', { max: 36500 })!, justification = input.text('justification', { max: 2000 })
  insist(input.flag('consent'), 'retention_consent_required', 409)
  await commit(env, [stmt(env, 'INSERT INTO beam_erasure_policy VALUES(1,?,?,1,?) ON CONFLICT(singleton) DO UPDATE SET assessment_days=excluded.assessment_days,justification=excluded.justification,version=beam_erasure_policy.version+1,changed_at=excluded.changed_at', days, justification, now())], { actor, action: 'erasure.policy', subject: 'retention', detail: { assessmentDays: days } })
  return erasureSettings(env, actor)
}
export async function placeErasureHold(env: Bindings, actor: Actor, input: Input) {
  erasureOwner(actor)
  const kind = input.text('kind'), subject = input.text('subject'), justification = input.text('justification', { max: 2000 })
  insist(['person', 'source'].includes(kind), 'invalid_erasure_kind')
  insist(await one(env, `SELECT 1 FROM ${kind === 'person' ? 'beam_members' : 'beam_sources'} WHERE id=?`, subject), 'subject_not_found', 404)
  insist(!await one(env, "SELECT 1 FROM beam_erasure_jobs WHERE kind=? AND subject_id=? AND state!='complete'", kind, subject), 'erasure_in_progress', 409)
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_erasure_holds(id,kind,subject_id,justification,placed_by,placed_at) VALUES(?,?,?,?,?,?)', id, kind, subject, justification, actor.id, now())], { actor, action: 'erasure.hold', subject: id, detail: { kind, subject } })
  return { id }
}
export async function releaseErasureHold(env: Bindings, actor: Actor, input: Input) {
  erasureOwner(actor)
  const hold = await one(env, 'SELECT * FROM beam_erasure_holds WHERE id=? AND released_at IS NULL', input.text('hold'))
  insist(hold, 'hold_not_found', 404)
  insist(input.text('justification', { max: 2000 }), 'hold_release_reason')
  insist(!await one(env, "SELECT 1 FROM beam_erasure_jobs WHERE kind=? AND subject_id=? AND state!='complete'", hold.kind, hold.subject_id), 'erasure_in_progress', 409)
  await commit(env, [stmt(env, 'UPDATE beam_erasure_holds SET released_at=?,released_by=? WHERE id=?', now(), actor.id, hold.id)], { actor, action: 'erasure.hold.release', subject: hold.id })
  return { id: hold.id }
}
