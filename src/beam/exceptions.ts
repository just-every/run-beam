// AUTO-006: leave, blockers and exceptions, handled openly. A learner reports a blocker on their own open assignment;
// whoever may enroll that learner in that course (the owner, their manager, the unit's learning administrator or a
// custom role with the enrollment permission) defers or exempts it within the owner's exception policy, always with a
// reason and an end date, or declines the blocker with a reason. An exception never moves the due date, closes the
// assignment or touches a completion: while it lasts the record reads as deferred or exempt instead of open or overdue,
// and when it ends the record is read as before, against its original due date. Every exception stays on the record.
import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { manages, permits, requireLearnerScope } from './scope'
import { addDays, localDate, zonedInstant } from './time'
import { requireCourseRole } from './units'

export const BLOCKER_KINDS = ['leave', 'access', 'content', 'other'] as const
export const EXCEPTION_KINDS = ['deferral', 'exemption'] as const
export interface Policy { maxDeferralDays: number; maxExemptionDays: number; managerExemptions: boolean }
export const DEFAULT_POLICY: Policy = { maxDeferralDays: 90, maxExemptionDays: 365, managerExemptions: true }

export async function exceptionPolicy(env: Bindings): Promise<Policy> {
  const row = await one(env, 'SELECT max_deferral_days, max_exemption_days, manager_exemptions FROM beam_exception_policy WHERE id = 1')
  return row ? { maxDeferralDays: row.max_deferral_days, maxExemptionDays: row.max_exemption_days, managerExemptions: row.manager_exemptions === 1 } : DEFAULT_POLICY
}

/** The owner sets how long a deferral or an exemption may last and whether managers may exempt. */
export async function setExceptionPolicy(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const policy: Policy = { maxDeferralDays: input.integer('maxDeferralDays', { min: 1, max: 365 })!, maxExemptionDays: input.integer('maxExemptionDays', { min: 1, max: 730 })!, managerExemptions: ['on', 'true', '1', 'yes'].includes(input.text('managerExemptions', { optional: true, max: 5 }).toLowerCase()) }
  await commit(env, [stmt(env, `INSERT INTO beam_exception_policy (id, max_deferral_days, max_exemption_days, manager_exemptions, updated_by, updated_at) VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET max_deferral_days = excluded.max_deferral_days, max_exemption_days = excluded.max_exemption_days, manager_exemptions = excluded.manager_exemptions, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    policy.maxDeferralDays, policy.maxExemptionDays, policy.managerExemptions ? 1 : 0, actor.id, now())], { actor, action: 'exception.policy', subject: 'policy', detail: policy })
  return policy
}

/** A learner reports what keeps them from an open assignment of their own; one open report per assignment. */
export async function reportBlocker(env: Bindings, actor: Actor, input: Input) {
  const assignment = await one(env, 'SELECT id, learner_id, status FROM beam_assignments WHERE id = ?', input.text('assignment'))
  insist(assignment && assignment.learner_id === actor.id, 'assignment_not_found', 404)
  insist(assignment.status === 'open', 'assignment_closed', 409)
  const kind = input.text('kind')
  insist((BLOCKER_KINDS as readonly string[]).includes(kind), 'invalid_kind')
  const note = input.text('note', { max: 1000 })
  const id = newId(), at = now()
  const [written] = await env.DB.batch([
    stmt(env, "INSERT INTO beam_blockers (id, assignment_id, learner_id, kind, note, reported_at, state) SELECT ?, ?, ?, ?, ?, ?, 'open' WHERE NOT EXISTS (SELECT 1 FROM beam_blockers WHERE assignment_id = ? AND state = 'open')", id, assignment.id, actor.id, kind, note, at, assignment.id),
    stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, ?, ?, ?, ? WHERE changes() = 1', at, actor.id, 'blocker.report', assignment.id, JSON.stringify({ blocker: id, kind })),
  ])
  insist(written.meta.changes === 1, 'blocker_already_reported', 409)
  return { id }
}

/** Whoever may cancel this assignment may decide on it (the same authority as assignment.cancel). */
async function decidable(env: Bindings, actor: Actor, assignmentId: string) {
  insist(permits(actor, 'enrollment'), 'forbidden', 403)
  const assignment = await one(env, 'SELECT id, learner_id, course_id, status, timezone FROM beam_assignments WHERE id = ?', assignmentId)
  insist(assignment, 'assignment_not_found', 404)
  if (!actor.grants.enrollment) await requireCourseRole(env, actor, assignment.course_id, 'manager')
  requireLearnerScope(actor, assignment.learner_id, 'enrollment')
  return assignment
}

/** Defers or exempts one open assignment until the end of a date in the assignment's own zone, within the policy. */
export async function grantException(env: Bindings, actor: Actor, input: Input) {
  const assignment = await decidable(env, actor, input.text('assignment'))
  insist(assignment.status === 'open', 'assignment_closed', 409)
  const kind = input.text('kind')
  insist((EXCEPTION_KINDS as readonly string[]).includes(kind), 'invalid_kind')
  const policy = await exceptionPolicy(env)
  // A manager's own authority exempts only when the owner's policy allows it; administrators always may.
  const administrator = actor.owner || actor.adminUnits.length > 0 || !!actor.grants.enrollment
  insist(kind === 'deferral' || administrator || policy.managerExemptions, 'exemption_not_allowed', 403)
  const endsOn = input.text('endsOn', { max: 10 })
  const today = localDate(now(), assignment.timezone)
  const endsAt = zonedInstant(addDays(endsOn, 1), '00:00', assignment.timezone)
  const limit = kind === 'deferral' ? policy.maxDeferralDays : policy.maxExemptionDays
  insist(endsOn >= today, 'exception_ends_in_past')
  insist(endsOn <= addDays(today, limit), 'exception_too_long', 400, { maxDays: limit })
  const reason = input.text('reason', { max: 500 })
  const blocker = input.text('blocker', { optional: true, max: 64 }) || null
  if (blocker) insist(await one(env, "SELECT 1 FROM beam_blockers WHERE id = ? AND assignment_id = ? AND state = 'open'", blocker, assignment.id), 'blocker_not_open', 409)
  const id = newId(), at = now()
  const [written] = await env.DB.batch([
    stmt(env, 'INSERT INTO beam_exceptions (id, assignment_id, kind, ends_on, ends_at, reason, blocker_id, granted_by, granted_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM beam_exceptions WHERE assignment_id = ? AND ends_at > ?)',
      id, assignment.id, kind, endsOn, endsAt, reason, blocker, actor.id, at, assignment.id, at),
    stmt(env, "UPDATE beam_blockers SET state = 'granted', decided_by = ?, decided_at = ?, decision_reason = ? WHERE id = ? AND state = 'open' AND EXISTS (SELECT 1 FROM beam_exceptions WHERE id = ?)", actor.id, at, reason, blocker, id),
    stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM beam_exceptions WHERE id = ?)', at, actor.id, `exception.${kind}`, assignment.id, JSON.stringify({ exception: id, endsOn, endsAt, reason, blocker }), id),
  ])
  insist(written.meta.changes === 1, 'exception_active', 409)
  return { id, kind, endsOn, endsAt }
}

/** Declines a reported blocker with a reason; the assignment and its due date stay as they were. */
export async function declineBlocker(env: Bindings, actor: Actor, input: Input) {
  const blocker = await one(env, 'SELECT id, assignment_id FROM beam_blockers WHERE id = ?', input.text('blocker'))
  insist(blocker, 'blocker_not_open', 404)
  await decidable(env, actor, blocker.assignment_id)
  const reason = input.text('reason', { max: 500 }), at = now()
  const [written] = await env.DB.batch([
    stmt(env, "UPDATE beam_blockers SET state = 'declined', decided_by = ?, decided_at = ?, decision_reason = ? WHERE id = ? AND state = 'open'", actor.id, at, reason, blocker.id),
    stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, ?, ?, ?, ? WHERE changes() = 1', at, actor.id, 'blocker.decline', blocker.assignment_id, JSON.stringify({ blocker: blocker.id, reason })),
  ])
  insist(written.meta.changes === 1, 'blocker_not_open', 409)
  return { id: blocker.id }
}

/** Every blocker and exception of one assignment, oldest first, with who decided and whether the exception still holds. */
export async function assignmentExceptions(env: Bindings, assignment: string) {
  const at = now()
  const [blockers, exceptions] = await Promise.all([
    all(env, 'SELECT b.id, b.kind, b.note, b.reported_at AS reportedAt, b.state, b.decided_at AS decidedAt, b.decision_reason AS decisionReason, m.name AS decidedByName FROM beam_blockers b LEFT JOIN beam_members m ON m.id = b.decided_by WHERE b.assignment_id = ? ORDER BY b.reported_at, b.rowid', assignment),
    all(env, 'SELECT e.id, e.kind, e.ends_on AS endsOn, e.ends_at AS endsAt, e.reason, e.blocker_id AS blocker, e.granted_by AS grantedBy, m.name AS grantedByName, e.granted_at AS grantedAt FROM beam_exceptions e JOIN beam_members m ON m.id = e.granted_by WHERE e.assignment_id = ? ORDER BY e.granted_at, e.rowid', assignment),
  ])
  return { blockers, exceptions: exceptions.map(row => ({ ...row, active: row.endsAt > at }) as Row) }
}

/** Open blockers of the people this person may decide for (all of them for the owner). */
export async function openBlockers(env: Bindings, actor: Actor) {
  if (!permits(actor, 'enrollment')) return []
  const rows = await all(env, "SELECT b.id, b.assignment_id AS assignment, b.learner_id AS learner, m.name AS learnerName, c.title AS courseTitle, b.kind, b.note, b.reported_at AS reportedAt FROM beam_blockers b JOIN beam_members m ON m.id = b.learner_id JOIN beam_assignments a ON a.id = b.assignment_id JOIN beam_courses c ON c.id = a.course_id WHERE b.state = 'open' AND a.status = 'open' ORDER BY b.reported_at")
  return rows.filter(row => manages(actor, row.learner, 'enrollment'))
}

/** SQL: the assignment's latest exception as a JSON object, or null (the column holding the assignment id follows). */
export const LATEST_EXCEPTION = (column: string) => `(SELECT json_object('kind', e.kind, 'endsOn', e.ends_on, 'endsAt', e.ends_at, 'reason', e.reason, 'by', em.name, 'grantedAt', e.granted_at)
  FROM beam_exceptions e JOIN beam_members em ON em.id = e.granted_by WHERE e.assignment_id = ${column} ORDER BY e.granted_at DESC, e.rowid DESC LIMIT 1)`

/** SQL: an exception holds this assignment now (bind the instant after it). */
export const EXCEPTED = (column: string) => `EXISTS (SELECT 1 FROM beam_exceptions e WHERE e.assignment_id = ${column} AND e.ends_at > ?)`
