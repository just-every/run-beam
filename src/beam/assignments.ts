// Flows 4, 5 and renewals: role paths with prerequisites and renewal intervals,
// assignments to individuals and teams with due dates in an explicit time zone.
import { moveOpenAssignments } from './moves'
import type { Bindings } from '../auth.server'
import { accessRule, enrolmentWindow, type Window } from './access'
import { isManager, requireRole, type Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt } from './core'
import type { Input } from './input'
import { requireBusiness } from './people'
import { DAY, addDays, localDate, validTimezone, zonedInstant } from './time'
import { requireCourseRole } from './units'
import { inScope, permits, requireLearnerScope, requireTeamScope, teamScope } from './scope'
import { followOn } from './automation'
import { computeDues, dueRules, DUE_TIME, type Anchor } from './due-rules'

export interface NewAssignment {
  learner: string
  course: string
  dueDate: string
  dueTime: string
  timezone: string
  reason: string
  pathRevision?: string | null
  prerequisite?: string | null
  renewalDays?: number | null
  /** A moved assignment keeps its window; otherwise the path's or course's rule sets it at enrolment (AUTO-009). */
  access?: Window
  /** AUTO-003: the path rule a prerequisite completion re-applies. */
  dueAnchor?: Anchor
  dueDays?: number
}

/** Inserts assignments bound to each course's published revision; an open one for the same learner and course is kept.
 * Each new enrollment runs the AUTO-005 enrollment rules of its course; `depth` counts rule-made steps in a chain. */
export async function insertAssignments(env: Bindings, actor: Actor, items: NewAssignment[], action: string, depth = 0) {
  const created: string[] = [], kept: string[] = []
  for (const item of items) {
    const course = await one<{ published_revision_id: string | null; retired_at: number | null; title: string }>(env, 'SELECT published_revision_id, retired_at, title FROM beam_courses WHERE id = ?', item.course)
    insist(course, 'course_not_found', 404)
    insist(course.published_revision_id, 'course_not_published', 409)
    // AUTHOR-005: a retired course is never newly assigned, by any door (person, team, path or renewal).
    insist(!course.retired_at, 'course_retired', 409, { course: item.course, title: course.title })
    const dueAt = zonedInstant(item.dueDate, item.dueTime, item.timezone)
    const id = newId(), at = now()
    const window = item.access ?? await enrolmentWindow(env, item.course, item.pathRevision, at)
    const [result] = await env.DB.batch([
      stmt(env, "INSERT OR IGNORE INTO beam_assignments (id, learner_id, course_id, course_revision_id, path_revision_id, prerequisite_course_id, renewal_days, due_date, due_time, timezone, due_at, status, reason, assigned_by, assigned_at, access_opens_at, access_closes_at, access_rule, due_anchor, due_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)", id, item.learner, item.course, course.published_revision_id, item.pathRevision ?? null, item.prerequisite ?? null, item.renewalDays ?? null, item.dueDate, item.dueTime, item.timezone, dueAt, item.reason, actor.id, at, window.opensAt, window.closesAt, window.rule, item.dueAnchor ?? null, item.dueDays ?? null),
      stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, ?, ?, ?, ? WHERE changes() = 1', now(), actor.id, action, id, JSON.stringify(item)),
    ])
    ;(result.meta.changes === 1 ? created : kept).push(result.meta.changes === 1 ? id : `${item.learner}:${item.course}`)
  }
  for (const id of created) await followOn(env, 'enrollment', { assignment: id }, depth)
  return { created, kept }
}

async function learnersFrom(env: Bindings, input: Input) {
  const learners = new Set(input.list('learners'))
  for (const team of input.list('teams')) {
    insist(await one(env, 'SELECT 1 FROM beam_teams WHERE id = ?', team), 'team_not_found', 404)
    for (const row of await all<{ member_id: string }>(env, 'SELECT member_id FROM beam_team_members WHERE team_id = ?', team)) learners.add(row.member_id)
  }
  for (const learner of learners) insist(await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', learner), 'person_not_found', 404)
  insist(learners.size > 0, 'learners_required')
  return [...learners]
}

export async function assignCourse(env: Bindings, actor: Actor, input: Input) {
  insist(permits(actor, 'enrollment'), 'forbidden', 403)
  const business = await requireBusiness(env)
  const course = input.text('course')
  // A learning administrator enrolls only their units' people in their units' courses (ORG-002); an enrollment
  // permission (ORG-010) reaches any course for its own people.
  if (!actor.grants.enrollment) await requireCourseRole(env, actor, course, 'manager')
  const timezone = input.text('timezone', { optional: true }) || business.timezone
  insist(validTimezone(timezone), 'invalid_timezone')
  const dueDate = input.text('dueDate'), dueTime = input.text('dueTime', { optional: true }) || '17:00'
  zonedInstant(dueDate, dueTime, timezone)
  const learners = await learnersFrom(env, input)
  for (const learner of learners) requireLearnerScope(actor, learner, 'enrollment')
  return await insertAssignments(env, actor, learners.map(learner => ({ learner, course, dueDate, dueTime, timezone, reason: 'assigned' })), 'assignment.create')
}

export async function createPath(env: Bindings, actor: Actor, input: Input) {
  requireRole(actor, 'manager')
  const name = input.text('name', { max: 120 })
  const team = input.text('team')
  insist(await one(env, 'SELECT 1 FROM beam_teams WHERE id = ?', team), 'team_not_found', 404)
  requireTeamScope(actor, team)
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_paths (id, name, team_id, created_at) VALUES (?, ?, ?, ?)', id, name, team, now())], { actor, action: 'path.create', subject: id, detail: { name, team } })
  return { id }
}

/** Saves the path's requirements as a new path revision; earlier assignments keep their revision. */
export async function revisePath(env: Bindings, actor: Actor, input: Input) {
  requireRole(actor, 'manager')
  const path = await one(env, 'SELECT * FROM beam_paths WHERE id = ?', input.text('path'))
  insist(path, 'path_not_found', 404)
  requireTeamScope(actor, path.team_id)
  const courses = input.list('courses', { keepEmpty: true })
  const prerequisites = input.list('prerequisites', { keepEmpty: true })
  const dueDays = input.list('dueDays', { keepEmpty: true })
  const renewalDays = input.list('renewalDays', { keepEmpty: true })
  const rule = dueRules(input)
  const requirements = courses.map((course, index) => ({ course, prerequisite: prerequisites[index] || null, dueDays: dueDays[index] ?? '', renewalDays: renewalDays[index] || null, ...rule(index, prerequisites[index] || null) })).filter(requirement => requirement.course)
  insist(requirements.length > 0, 'requirements_required')
  const included = new Set(requirements.map(requirement => requirement.course))
  insist(included.size === requirements.length, 'duplicate_requirement')
  for (const requirement of requirements) {
    insist(await one(env, 'SELECT 1 FROM beam_courses WHERE id = ?', requirement.course), 'course_not_found', 404)
    insist(requirement.anchor === 'fixed' || (/^\d{1,3}$/.test(requirement.dueDays) && Number(requirement.dueDays) >= 1), 'invalid_due_days')
    insist(requirement.renewalDays === null || (/^\d{1,4}$/.test(requirement.renewalDays) && Number(requirement.renewalDays) >= 1), 'invalid_renewal_days')
    insist(requirement.prerequisite === null || (requirement.prerequisite !== requirement.course && included.has(requirement.prerequisite)), 'invalid_prerequisite')
  }
  const latest = await one<{ number: number }>(env, 'SELECT MAX(number) AS number FROM beam_path_revisions WHERE path_id = ?', path.id)
  const id = newId(), number = (latest?.number ?? 0) + 1
  await commit(env, [
    stmt(env, 'INSERT INTO beam_path_revisions (id, path_id, number, created_by, created_at) VALUES (?, ?, ?, ?, ?)', id, path.id, number, actor.id, now()),
    ...requirements.map((requirement, position) => stmt(env, 'INSERT INTO beam_path_requirements (path_revision_id, position, course_id, prerequisite_course_id, due_days, renewal_days, due_anchor, due_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, position, requirement.course, requirement.prerequisite, requirement.anchor === 'fixed' ? 0 : Number(requirement.dueDays), requirement.renewalDays === null ? null : Number(requirement.renewalDays), requirement.anchor, requirement.dueOn)),
    stmt(env, 'UPDATE beam_paths SET current_revision_id = ? WHERE id = ?', id, path.id),
  ], { actor, action: 'path.revise', subject: path.id, detail: { number, requirements } })
  return { id, number }
}

async function pathDues(env: Bindings, actor: Actor, input: Input) {
  requireRole(actor, 'manager')
  const path = await one(env, 'SELECT * FROM beam_paths WHERE id = ?', input.text('path'))
  insist(path?.current_revision_id, 'path_not_ready', 409)
  requireTeamScope(actor, path.team_id)
  const learners = (await all<{ member_id: string }>(env, 'SELECT member_id FROM beam_team_members WHERE team_id = ?', path.team_id)).map(row => row.member_id)
  return { path, ...await computeDues(env, path.current_revision_id, learners) }
}

/** AUTO-003: the due dates assigning the path now would set, for every member of its team; nothing is written. */
export async function previewPath(env: Bindings, actor: Actor, input: Input) {
  const { path, dues } = await pathDues(env, actor, input)
  return { path: path.id, revision: path.current_revision_id, dues }
}

export async function assignPath(env: Bindings, actor: Actor, input: Input) {
  const { path, requirements, dues } = await pathDues(env, actor, input)
  const items = dues.filter(due => due.dueDate).map(due => {
    const requirement = requirements.find(item => item.course_id === due.course)!
    return { learner: due.learner, course: due.course, dueDate: due.dueDate!, dueTime: DUE_TIME, timezone: due.timezone, reason: 'path', pathRevision: path.current_revision_id, prerequisite: requirement.prerequisite_course_id, renewalDays: requirement.renewal_days, dueAnchor: requirement.due_anchor, dueDays: requirement.due_days }
  })
  return { ...await insertAssignments(env, actor, items, 'assignment.path'), skipped: dues.filter(due => due.skipped).map(due => ({ learner: due.learner, course: due.course, reason: due.skipped })) }
}

/** Role paths of the teams this person manages (all of them for the owner). */
export async function listPaths(env: Bindings, actor: Actor) {
  const teams = teamScope(actor)
  const paths = await all(env, 'SELECT p.id, p.name, p.team_id AS team, p.current_revision_id AS revision, r.number FROM beam_paths p LEFT JOIN beam_path_revisions r ON r.id = p.current_revision_id WHERE (? IS NULL OR p.team_id IN (SELECT value FROM json_each(?))) ORDER BY p.name', teams, teams)
  for (const path of paths) path.access = await accessRule(env, 'path', path.id)
  for (const path of paths) path.requirements = path.revision ? await all(env, 'SELECT course_id AS course, prerequisite_course_id AS prerequisite, due_days AS dueDays, renewal_days AS renewalDays, due_anchor AS dueAnchor, due_on AS dueOn FROM beam_path_requirements WHERE path_revision_id = ? ORDER BY position', path.revision) : []
  return paths
}

/** After a reviewer publishes a new revision: move open assignments, or also reassign everyone who completed earlier. */
export async function reassignAfterPublish(env: Bindings, actor: Actor, course: string, revision: string, mode: string, dueDays: number) {
  if (mode === 'none') return 0
  const business = await requireBusiness(env)
  // AUTHOR-010: open assignments move with their unchanged progress (moves.ts).
  const moved = await moveOpenAssignments(env, actor, course, revision)
  const items: NewAssignment[] = []
  if (mode === 'everyone') {
    const completed = await all(env, `SELECT DISTINCT learner_id FROM beam_completions WHERE course_id = ? AND course_revision_id != ?
      AND learner_id NOT IN (SELECT learner_id FROM beam_assignments WHERE course_id = ? AND status = 'open')`, course, revision, course)
    const dueDate = addDays(localDate(now(), business.timezone), dueDays)
    for (const row of completed) if (!items.some(item => item.learner === row.learner_id)) items.push({ learner: row.learner_id, course, dueDate, dueTime: '17:00', timezone: business.timezone, reason: 'revision' })
  }
  return moved + (await insertAssignments(env, actor, items, 'assignment.revision')).created.length
}

/** Latest completion per learner/course, with no open assignment. The durable
 * audit sequence breaks ties when several offline attendances have one date. */
export async function renewalsDue(env: Bindings) {
  return await all(env, `SELECT c.id AS completion, c.learner_id AS learner, c.course_id AS course, c.expires_at AS expiresAt, origin.renewal_days AS renewalDays, origin.path_revision_id AS pathRevision, origin.prerequisite_course_id AS prerequisite
    FROM beam_completions c JOIN beam_assignments origin ON origin.id = c.assignment_id
    WHERE c.expires_at IS NOT NULL AND c.expires_at <= ? AND c.id = (
      SELECT latest.id FROM beam_completions latest LEFT JOIN beam_audit recorded ON recorded.action = 'completion.record' AND recorded.subject = latest.id
      WHERE latest.learner_id = c.learner_id AND latest.course_id = c.course_id
      ORDER BY latest.completed_at DESC, recorded.id DESC, latest.id DESC LIMIT 1)
    AND NOT EXISTS (SELECT 1 FROM beam_assignments a WHERE a.learner_id = c.learner_id AND a.course_id = c.course_id AND a.status = 'open') ORDER BY c.expires_at`, now() + 30 * DAY)
}

export async function assignRenewals(env: Bindings, actor: Actor, input: Input) {
  requireRole(actor, 'manager')
  const business = await requireBusiness(env)
  const selected = new Set(input.list('completions'))
  const due = (await renewalsDue(env)).filter(row => (selected.size === 0 || selected.has(row.completion)) && inScope(actor, row.learner))
  const items = due.map(row => ({ learner: row.learner, course: row.course, dueDate: localDate(Math.max(row.expiresAt, now()), business.timezone), dueTime: '17:00', timezone: business.timezone, reason: 'renewal', renewalDays: row.renewalDays, pathRevision: row.pathRevision, prerequisite: row.prerequisite }))
  return await insertAssignments(env, actor, items, 'assignment.renewal')
}

/** A retry decision: the manager grants one more quiz attempt after the limit. */
export async function grantAttempt(env: Bindings, actor: Actor, input: Input) {
  requireRole(actor, 'manager')
  const assignment = await one(env, "SELECT id, learner_id FROM beam_assignments WHERE id = ? AND status = 'open'", input.text('assignment'))
  insist(assignment, 'assignment_not_found', 404)
  requireLearnerScope(actor, assignment.learner_id)
  const reason = input.text('reason', { max: 500 })
  // Only when the attempts are used up and the quiz is not passed, so a retried form grants one attempt, not two.
  const result = await env.DB.batch([
    stmt(env, `UPDATE beam_assignments SET extra_attempts = extra_attempts + 1 WHERE id = ? AND status = 'open'
      AND EXISTS (SELECT 1 FROM beam_assessment_revisions s WHERE s.course_revision_id = beam_assignments.course_revision_id AND s.max_attempts IS NOT NULL
        AND (SELECT COUNT(*) FROM beam_attempts t WHERE t.assignment_id = beam_assignments.id AND t.kind = 'quiz' AND t.reset_id IS NULL) >= s.max_attempts + beam_assignments.extra_attempts)
      AND NOT EXISTS (SELECT 1 FROM beam_attempts t WHERE t.assignment_id = beam_assignments.id AND t.kind = 'quiz' AND t.passed = 1 AND t.reset_id IS NULL)`, assignment.id),
    stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, ?, ?, ?, ? WHERE changes() = 1', now(), actor.id, 'attempt.grant', assignment.id, JSON.stringify({ reason })),
  ])
  insist(result[0].meta.changes === 1, 'attempts_remaining', 409)
  return { id: assignment.id }
}

export async function cancelAssignment(env: Bindings, actor: Actor, input: Input) {
  insist(permits(actor, 'enrollment'), 'forbidden', 403)
  const id = input.text('assignment')
  const assignment = await one(env, 'SELECT learner_id, course_id FROM beam_assignments WHERE id = ?', id)
  insist(assignment, 'assignment_not_found', 404)
  if (!actor.grants.enrollment) await requireCourseRole(env, actor, assignment.course_id, 'manager')
  requireLearnerScope(actor, assignment.learner_id, 'enrollment')
  const reason = input.text('reason', { max: 500 })
  const result = await env.DB.batch([stmt(env, "UPDATE beam_assignments SET status = 'cancelled' WHERE id = ? AND status = 'open'", id), stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, ?, ?, ?, ? WHERE changes() = 1', now(), actor.id, 'assignment.cancel', id, JSON.stringify({ reason }))])
  insist(result[0].meta.changes === 1, 'assignment_not_found', 404)
  return { id }
}

/** ORG-004: a manager approves a due-date exception for one open assignment in their teams, with a reason. The due
 * instant moves in the assignment's own zone; the earlier due date stays in the assignment's history. */
export async function moveDueDate(env: Bindings, actor: Actor, input: Input) {
  insist(isManager(actor) || actor.grants.enrollment, 'forbidden', 403)
  const assignment = await one(env, 'SELECT id, learner_id, status, due_date, due_time, timezone, due_at FROM beam_assignments WHERE id = ?', input.text('assignment'))
  insist(assignment, 'assignment_not_found', 404)
  requireLearnerScope(actor, assignment.learner_id, 'enrollment')
  insist(assignment.status === 'open', 'assignment_closed', 409)
  const dueDate = input.text('dueDate'), dueTime = input.text('dueTime', { optional: true }) || assignment.due_time
  const dueAt = zonedInstant(dueDate, dueTime, assignment.timezone)
  const reason = input.text('reason', { max: 500 })
  const id = newId(), at = now()
  const result = await env.DB.batch([
    stmt(env, "UPDATE beam_assignments SET due_date = ?, due_time = ?, due_at = ? WHERE id = ? AND status = 'open' AND due_at = ?", dueDate, dueTime, dueAt, assignment.id, assignment.due_at),
    stmt(env, 'INSERT INTO beam_due_exceptions (id, assignment_id, previous_due_date, previous_due_time, previous_due_at, due_date, due_time, due_at, reason, approved_by, approved_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1', id, assignment.id, assignment.due_date, assignment.due_time, assignment.due_at, dueDate, dueTime, dueAt, reason, actor.id, at),
    stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM beam_due_exceptions WHERE id = ?)', at, actor.id, 'assignment.due', assignment.id, JSON.stringify({ exception: id, from: assignment.due_at, to: dueAt, reason }), id),
  ])
  insist(result[0].meta.changes === 1, 'assignment_changed', 409)
  return { id: assignment.id, dueAt }
}

/** Every due-date exception of one assignment, oldest first. */
export async function dueExceptions(env: Bindings, assignment: string) {
  return await all(env, 'SELECT e.previous_due_at AS previousDueAt, e.due_at AS dueAt, e.reason, e.approved_by AS approvedBy, m.name AS approvedByName, e.approved_at AS approvedAt FROM beam_due_exceptions e JOIN beam_members m ON m.id = e.approved_by WHERE e.assignment_id = ? ORDER BY e.approved_at, e.rowid', assignment)
}
