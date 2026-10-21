// AUTO-009: access windows. The owner sets a window on a course, a path or one
// assignment; a learning administrator (ORG-002) sets and extends the window of
// an assignment they created for someone in their units: closing a set number of days after enrolment, or
// opening and closing on fixed dates in the employer's time zone. Each new
// assignment takes its window from the path's rule, else the course's, when it
// is created, so a renewal gets a fresh window under the same rule. Outside
// its window an assignment's lessons and assessments are refused through every
// door while its records stay readable; a closed window never completes,
// cancels or hides the assignment. A manager extends the close with a reason.
import type { Bindings } from '../auth.server'
import { isManager, requireOwner, type Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { requireBusiness } from './people'
import { withinTeam } from './resets'
import { inScope } from './scope'
import { DAY, addDays, zonedInstant } from './time'

export interface AccessRule { kind: 'after_enrolment' | 'dates'; closeDays?: number | null; openDate?: string | null; closeDate?: string | null; timezone?: string | null; source: 'course' | 'path' | 'assignment' }
export interface Window { opensAt: number | null; closesAt: number | null; rule: string | null }

const NO_WINDOW: Window = { opensAt: null, closesAt: null, rule: null }

/** The window a rule gives an assignment enrolled at `enrolledAt`; fixed dates run from the start of the opening day to the end of the closing day. */
export function windowFrom(rule: AccessRule, enrolledAt: number): Window {
  if (rule.kind === 'after_enrolment') return { opensAt: null, closesAt: enrolledAt + rule.closeDays! * DAY, rule: JSON.stringify(rule) }
  return { opensAt: zonedInstant(rule.openDate!, '00:00', rule.timezone!), closesAt: zonedInstant(addDays(rule.closeDate!, 1), '00:00', rule.timezone!), rule: JSON.stringify(rule) }
}

async function ruleFor(env: Bindings, scope: 'course' | 'path', target: string): Promise<AccessRule | null> {
  const row = await one(env, 'SELECT kind, close_days, open_date, close_date, timezone FROM beam_access_rules WHERE scope = ? AND target_id = ?', scope, target)
  return row ? { kind: row.kind, closeDays: row.close_days, openDate: row.open_date, closeDate: row.close_date, timezone: row.timezone, source: scope } : null
}

/** A new assignment's window: the path's rule first, then the course's. */
export async function enrolmentWindow(env: Bindings, course: string, pathRevision: string | null | undefined, enrolledAt: number): Promise<Window> {
  const path = pathRevision ? await one<{ path_id: string }>(env, 'SELECT path_id FROM beam_path_revisions WHERE id = ?', pathRevision) : null
  const rule = (path && await ruleFor(env, 'path', path.path_id)) || await ruleFor(env, 'course', course)
  return rule ? windowFrom(rule, enrolledAt) : NO_WINDOW
}

export type AccessState = 'open' | 'not_open' | 'ended'
export const accessState = (row: { access_opens_at?: number | null; access_closes_at?: number | null }, at = now()): AccessState =>
  row.access_opens_at && at < row.access_opens_at ? 'not_open' : row.access_closes_at && at >= row.access_closes_at ? 'ended' : 'open'

/** Refuses learning outside the window, naming when it opens or when it closed. */
export function requireAccess(row: { access_opens_at?: number | null; access_closes_at?: number | null }) {
  const state = accessState(row)
  insist(state !== 'not_open', 'access_not_open', 403, { opensAt: row.access_opens_at })
  insist(state !== 'ended', 'access_ended', 403, { closedAt: row.access_closes_at })
}

/** The window as the assignment's readers see it, with every recorded extension. */
export async function accessView(env: Bindings, row: Row) {
  const extensions = await all<{ days: number; reason: string; previousClosesAt: number; closesAt: number; extendedBy: string; extendedByName: string; extendedAt: number }>(env, 'SELECT e.days, e.reason, e.previous_closes_at AS previousClosesAt, e.closes_at AS closesAt, e.extended_by AS extendedBy, m.name AS extendedByName, e.extended_at AS extendedAt FROM beam_access_extensions e JOIN beam_members m ON m.id = e.extended_by WHERE e.assignment_id = ? ORDER BY e.extended_at, e.rowid', row.id)
  return { state: accessState(row), opensAt: row.access_opens_at ?? null, closesAt: row.access_closes_at ?? null, rule: row.access_rule ? JSON.parse(row.access_rule) as AccessRule : null, extensions }
}

async function ruleInput(env: Bindings, input: Input, source: AccessRule['source']): Promise<AccessRule | null> {
  const kind = input.text('kind')
  if (kind === 'none') return null
  insist(kind === 'after_enrolment' || kind === 'dates', 'invalid_kind')
  if (kind === 'after_enrolment') return { kind, closeDays: input.integer('closeDays', { min: 1, max: 3650 }), source }
  const timezone = (await requireBusiness(env)).timezone
  const openDate = input.text('openDate'), closeDate = input.text('closeDate')
  insist(zonedInstant(openDate, '00:00', timezone) < zonedInstant(addDays(closeDate, 1), '00:00', timezone), 'window_closes_before_it_opens')
  return { kind, openDate, closeDate, timezone, source }
}

/** The owner sets or clears a course's or a path's rule; it applies to assignments created from then on. */
export async function setAccessRule(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const scope = input.text('scope'), target = input.text('target')
  insist(scope === 'course' || scope === 'path', 'invalid_scope')
  insist(await one(env, `SELECT 1 FROM ${scope === 'course' ? 'beam_courses' : 'beam_paths'} WHERE id = ?`, target), `${scope}_not_found`, 404)
  const rule = await ruleInput(env, input, scope)
  await commit(env, [rule
    ? stmt(env, 'INSERT INTO beam_access_rules (scope, target_id, kind, close_days, open_date, close_date, timezone, set_by, set_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (scope, target_id) DO UPDATE SET kind = excluded.kind, close_days = excluded.close_days, open_date = excluded.open_date, close_date = excluded.close_date, timezone = excluded.timezone, set_by = excluded.set_by, set_at = excluded.set_at', scope, target, rule.kind, rule.closeDays ?? null, rule.openDate ?? null, rule.closeDate ?? null, rule.timezone ?? null, actor.id, now())
    : stmt(env, 'DELETE FROM beam_access_rules WHERE scope = ? AND target_id = ?', scope, target)], { actor, action: 'access.rule', subject: target, detail: { scope, rule } })
  return { id: target, rule }
}

export async function accessRule(env: Bindings, scope: 'course' | 'path', target: string) {
  return await ruleFor(env, scope, target)
}

/** A learning administrator's own enrollment of someone in their units: its window is theirs to set and extend. */
const ownEnrollment = (actor: Actor, assignment: Row) =>
  actor.adminUnits.length > 0 && assignment.assigned_by === actor.id && inScope(actor, assignment.learner_id)

/** The owner, or the learning administrator who created it, sets one open assignment's own window, counted from its enrolment. */
export async function setAssignmentWindow(env: Bindings, actor: Actor, input: Input) {
  if (!actor.owner) insist(actor.adminUnits.length, 'owner_required', 403)
  const assignment = await one(env, "SELECT id, learner_id, assigned_by, assigned_at FROM beam_assignments WHERE id = ? AND status = 'open'", input.text('assignment'))
  insist(assignment, 'assignment_not_found', 404)
  insist(actor.owner || ownEnrollment(actor, assignment), 'not_your_enrollment', 403)
  const rule = await ruleInput(env, input, 'assignment')
  const window = rule ? windowFrom(rule, assignment.assigned_at) : NO_WINDOW
  await commit(env, [stmt(env, "UPDATE beam_assignments SET access_opens_at = ?, access_closes_at = ?, access_rule = ? WHERE id = ? AND status = 'open'", window.opensAt, window.closesAt, window.rule, assignment.id)],
    { actor, action: 'assignment.window', subject: assignment.id, detail: { rule, opensAt: window.opensAt, closesAt: window.closesAt } })
  return { id: assignment.id, ...window }
}

/** A manager (for people in one of their teams), the owner, or the learning administrator who created the assignment
 * moves an open assignment's close later, with a reason: N days are added to its current closing instant, also when
 * that instant has passed, so a window closed longer ago than N days stays closed. The due date does not move. */
export async function extendAccess(env: Bindings, actor: Actor, input: Input) {
  insist(isManager(actor) || actor.adminUnits.length, 'forbidden', 403)
  const assignment = await one(env, 'SELECT id, learner_id, assigned_by, status, access_closes_at FROM beam_assignments WHERE id = ?', input.text('assignment'))
  insist(assignment, 'assignment_not_found', 404)
  insist((isManager(actor) && await withinTeam(env, actor, assignment.learner_id)) || ownEnrollment(actor, assignment), actor.adminUnits.length ? 'not_your_enrollment' : 'learner_outside_your_team', 403)
  insist(assignment.status === 'open', 'assignment_closed', 409)
  insist(assignment.access_closes_at, 'no_access_window', 409)
  const days = input.integer('days', { min: 1, max: 365 })!
  const reason = input.text('reason', { max: 500 })
  const at = now(), closesAt = assignment.access_closes_at + days * DAY, id = newId()
  const result = await env.DB.batch([
    stmt(env, "UPDATE beam_assignments SET access_closes_at = ? WHERE id = ? AND status = 'open' AND access_closes_at = ?", closesAt, assignment.id, assignment.access_closes_at),
    stmt(env, 'INSERT INTO beam_access_extensions (id, assignment_id, days, reason, previous_closes_at, closes_at, extended_by, extended_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1', id, assignment.id, days, reason, assignment.access_closes_at, closesAt, actor.id, at),
    stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM beam_access_extensions WHERE id = ?)', at, actor.id, 'access.extend', assignment.id, JSON.stringify({ extension: id, days, reason, previousClosesAt: assignment.access_closes_at, closesAt }), id),
  ])
  insist(result[0].meta.changes === 1, 'assignment_changed', 409)
  return { id: assignment.id, closesAt }
}
