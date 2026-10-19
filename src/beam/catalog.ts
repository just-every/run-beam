// ORG-007: the learner's catalog. Whoever manages a course's catalog (AUTHOR-005) offers it for self-enrollment, on
// approval or only by assignment, to everyone or to chosen teams. A learner searches and browses the courses offered to
// them by subject (folder), skill (tag), role (a role path that includes the course), language and longest duration;
// enrolls in an open course, requests one that needs approval, and withdraws from optional work they chose, which ends
// the assignment as cancelled and keeps its history. Whoever may enroll the learner in that course decides a request.
// Work someone else assigned is required; what the learner chose or asked for is optional. Favorites and saved
// searches belong to their person alone.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { insertAssignments } from './assignments'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { requireBusiness } from './people'
import { manages, permits, requireLearnerScope } from './scope'
import { addDays, localDate } from './time'
import { requireCourseRole } from './units'

export const MODES = ['assigned', 'open', 'request'] as const
/** Self-chosen work is due this many days after enrollment, at 17:00 in the business time zone. */
export const OPTIONAL_DUE_DAYS = 90
const OPTIONAL = ['self', 'request']
export interface CatalogQuery { q: string; subject: string; skill: string; role: string; language: string; maxMinutes: number | null }

export function catalogQuery(url: URL): CatalogQuery {
  const get = (name: string) => (url.searchParams.get(name) ?? '').trim().slice(0, 80)
  const minutes = get('maxMinutes')
  return { q: get('q'), subject: get('subject'), skill: get('skill').toLowerCase(), role: get('role'), language: get('language'), maxMinutes: /^\d{1,4}$/.test(minutes) ? Number(minutes) : null }
}

/** The owner, the course's unit administrator or a courses custom role sets how the course is offered. */
export async function setEnrollment(env: Bindings, actor: Actor, input: Input) {
  const course = input.text('course')
  insist(await one(env, 'SELECT 1 FROM beam_courses WHERE id = ?', course), 'course_not_found', 404)
  await requireCourseRole(env, actor, course)
  const mode = input.text('mode')
  insist((MODES as readonly string[]).includes(mode), 'invalid_mode')
  const teams = [...new Set(input.list('teams'))]
  for (const team of teams) insist(await one(env, 'SELECT 1 FROM beam_teams WHERE id = ?', team), 'team_not_found', 404)
  await commit(env, [stmt(env, 'UPDATE beam_courses SET enrollment_mode = ?, catalog_teams = ? WHERE id = ?', mode, teams.length ? JSON.stringify(teams) : null, course)], { actor, action: 'course.enrollment', subject: course, detail: { mode, teams } })
  return { id: course, mode, teams }
}

/** SQL for the courses offered to a learner (bound: learner): published, not retired or archived, open or on request,
 * to everyone or to a team of theirs. */
const OFFERED = `c.published_revision_id IS NOT NULL AND c.retired_at IS NULL AND c.archived_at IS NULL AND c.enrollment_mode IN ('open', 'request')
  AND (c.catalog_teams IS NULL OR EXISTS (SELECT 1 FROM beam_team_members tm WHERE tm.member_id = ?1 AND tm.team_id IN (SELECT value FROM json_each(c.catalog_teams))))`

async function offered(env: Bindings, actor: Actor, course: string) {
  const row = await one(env, `SELECT c.id, c.title, c.enrollment_mode AS mode FROM beam_courses c WHERE c.id = ?2 AND ${OFFERED}`, actor.id, course)
  insist(row, 'course_not_found', 404)
  return row
}

export async function catalog(env: Bindings, actor: Actor, query: CatalogQuery) {
  const needle = `%${query.q.toLowerCase()}%`
  const courses = await all(env, `SELECT c.id, c.title, c.enrollment_mode AS mode, c.folder, c.tags, c.objectives, c.language, c.duration_minutes AS durationMinutes,
      json_extract(c.draft_json, '$.summary') AS summary, EXISTS (SELECT 1 FROM beam_favorites f WHERE f.member_id = ?1 AND f.course_id = c.id) AS favorite,
      (SELECT a.id FROM beam_assignments a WHERE a.learner_id = ?1 AND a.course_id = c.id AND a.status = 'open') AS openAssignment,
      (SELECT a.reason FROM beam_assignments a WHERE a.learner_id = ?1 AND a.course_id = c.id AND a.status = 'open') AS openReason,
      EXISTS (SELECT 1 FROM beam_enrollment_requests r WHERE r.learner_id = ?1 AND r.course_id = c.id AND r.state = 'open') AS requested
    FROM beam_courses c WHERE ${OFFERED}
      AND (?2 = '%%' OR lower(c.title) LIKE ?2 OR lower(COALESCE(json_extract(c.draft_json, '$.summary'), '')) LIKE ?2 OR lower(c.tags) LIKE ?2 OR lower(c.objectives) LIKE ?2)
      AND (?3 = '' OR c.folder = ?3) AND (?4 = '' OR EXISTS (SELECT 1 FROM json_each(c.tags) WHERE value = ?4)) AND (?5 = '' OR c.language = ?5)
      AND (?6 IS NULL OR (c.duration_minutes IS NOT NULL AND c.duration_minutes <= ?6))
      AND (?7 = '' OR c.id IN (SELECT q.course_id FROM beam_path_requirements q JOIN beam_paths p ON p.current_revision_id = q.path_revision_id WHERE p.id = ?7))
    ORDER BY c.title`, actor.id, needle, query.subject, query.skill, query.language, query.maxMinutes, query.role)
  const shaped = courses.map(row => ({ ...row, tags: JSON.parse(row.tags), objectives: JSON.parse(row.objectives), favorite: row.favorite === 1, requested: row.requested === 1,
    standing: row.openAssignment ? (OPTIONAL.includes(row.openReason) ? 'optional' : 'required') : row.requested === 1 ? 'requested' : null }) as Row)
  const [facets, work, requests, searches] = await Promise.all([
    all(env, `SELECT DISTINCT c.folder, c.language, c.tags FROM beam_courses c WHERE ${OFFERED}`, actor.id),
    all(env, "SELECT a.id, c.title AS courseTitle, a.reason, a.due_at AS dueAt, a.timezone, a.status FROM beam_assignments a JOIN beam_courses c ON c.id = a.course_id WHERE a.learner_id = ? AND (a.status = 'open' OR (a.status = 'cancelled' AND a.reason IN ('self', 'request'))) ORDER BY a.due_at", actor.id),
    all(env, 'SELECT r.id, r.course_id AS course, c.title AS courseTitle, r.note, r.state, r.requested_at AS requestedAt, r.reason, m.name AS decidedByName FROM beam_enrollment_requests r JOIN beam_courses c ON c.id = r.course_id LEFT JOIN beam_members m ON m.id = r.decided_by WHERE r.learner_id = ? ORDER BY r.requested_at DESC', actor.id),
    all(env, 'SELECT id, name, query FROM beam_saved_searches WHERE member_id = ? ORDER BY name', actor.id),
  ])
  const roles = await all(env, `SELECT DISTINCT p.id, p.name FROM beam_paths p JOIN beam_path_requirements q ON q.path_revision_id = p.current_revision_id JOIN beam_courses c ON c.id = q.course_id WHERE ${OFFERED} ORDER BY p.name`, actor.id)
  return {
    query, courses: shaped,
    facets: { subjects: [...new Set(facets.map(row => row.folder).filter(Boolean))].sort(), languages: [...new Set(facets.map(row => row.language))].sort(), skills: [...new Set(facets.flatMap(row => JSON.parse(row.tags)))].sort(), roles },
    required: work.filter(row => row.status === 'open' && !OPTIONAL.includes(row.reason)), optional: work.filter(row => row.status === 'open' && OPTIONAL.includes(row.reason)), withdrawn: work.filter(row => row.status === 'cancelled'),
    requests, favorites: shaped.filter(row => row.favorite), searches: searches.map(row => ({ ...row, query: JSON.parse(row.query) }) as Row),
  }
}

async function enrollOptional(env: Bindings, actor: Actor, learner: string, course: string, reason: 'self' | 'request') {
  const business = await requireBusiness(env)
  const { created } = await insertAssignments(env, actor, [{ learner, course, dueDate: addDays(localDate(now(), business.timezone), OPTIONAL_DUE_DAYS), dueTime: '17:00', timezone: business.timezone, reason }], reason === 'self' ? 'assignment.self' : 'assignment.request')
  insist(created.length === 1, 'already_enrolled', 409)
  return created[0]
}

export async function selfEnroll(env: Bindings, actor: Actor, input: Input) {
  const course = await offered(env, actor, input.text('course'))
  insist(course.mode === 'open', 'approval_required', 409)
  return { id: await enrollOptional(env, actor, actor.id, course.id, 'self') }
}

export async function requestEnrollment(env: Bindings, actor: Actor, input: Input) {
  const course = await offered(env, actor, input.text('course'))
  insist(course.mode === 'request', 'enrollment_open', 409)
  insist(!await one(env, "SELECT 1 FROM beam_assignments WHERE learner_id = ? AND course_id = ? AND status = 'open'", actor.id, course.id), 'already_enrolled', 409)
  const note = input.text('note', { optional: true, max: 500 }), id = newId(), at = now()
  const [written] = await env.DB.batch([
    stmt(env, "INSERT OR IGNORE INTO beam_enrollment_requests (id, course_id, learner_id, note, state, requested_at) VALUES (?, ?, ?, ?, 'open', ?)", id, course.id, actor.id, note, at),
    stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, ?, ?, ?, ? WHERE changes() = 1', at, actor.id, 'enrollment.request', course.id, JSON.stringify({ request: id })),
  ])
  insist(written.meta.changes === 1, 'already_requested', 409)
  return { id }
}

/** Whoever may enroll the learner in that course approves (creating optional work) or declines with a reason. */
export async function decideRequest(env: Bindings, actor: Actor, input: Input) {
  const request = await one(env, "SELECT * FROM beam_enrollment_requests WHERE id = ? AND state = 'open'", input.text('request'))
  insist(request, 'request_not_open', 404)
  insist(permits(actor, 'enrollment'), 'forbidden', 403)
  if (!actor.grants.enrollment) await requireCourseRole(env, actor, request.course_id, 'manager')
  requireLearnerScope(actor, request.learner_id, 'enrollment')
  const decision = input.text('decision')
  insist(decision === 'approve' || decision === 'decline', 'invalid_decision')
  const reason = input.text('reason', { optional: decision === 'approve', max: 500 }) || null
  const assignment = decision === 'approve' ? await enrollOptional(env, actor, request.learner_id, request.course_id, 'request') : null
  await commit(env, [stmt(env, "UPDATE beam_enrollment_requests SET state = ?, decided_by = ?, decided_at = ?, reason = ?, assignment_id = ? WHERE id = ? AND state = 'open'", decision === 'approve' ? 'approved' : 'declined', actor.id, now(), reason, assignment, request.id)],
    { actor, action: `enrollment.${decision}`, subject: request.id, detail: { course: request.course_id, learner: request.learner_id, assignment, reason } })
  return { id: request.id, assignment }
}

/** Requests waiting for this person's decision. */
export async function waitingRequests(env: Bindings, actor: Actor) {
  if (!permits(actor, 'enrollment')) return []
  const rows = await all(env, "SELECT r.id, r.course_id AS course, c.title AS courseTitle, r.learner_id AS learner, m.name AS learnerName, r.note, r.requested_at AS requestedAt FROM beam_enrollment_requests r JOIN beam_courses c ON c.id = r.course_id JOIN beam_members m ON m.id = r.learner_id WHERE r.state = 'open' ORDER BY r.requested_at")
  return rows.filter(row => manages(actor, row.learner, 'enrollment'))
}

/** The learner leaves optional work they chose; the assignment ends as cancelled with its progress kept. */
export async function withdraw(env: Bindings, actor: Actor, input: Input) {
  const assignment = await one(env, 'SELECT id, learner_id, reason, status FROM beam_assignments WHERE id = ?', input.text('assignment'))
  insist(assignment && assignment.learner_id === actor.id, 'assignment_not_found', 404)
  insist(OPTIONAL.includes(assignment.reason), 'required_work', 409)
  insist(assignment.status === 'open', 'assignment_closed', 409)
  await commit(env, [stmt(env, "UPDATE beam_assignments SET status = 'cancelled' WHERE id = ? AND status = 'open'", assignment.id)], { actor, action: 'assignment.withdraw', subject: assignment.id, detail: { reason: 'withdrawn by the learner' } })
  return { id: assignment.id }
}

export async function setFavorite(env: Bindings, actor: Actor, input: Input) {
  const course = await offered(env, actor, input.text('course'))
  const on = input.text('favorite', { optional: true }) !== 'false'
  if (on) await env.DB.prepare('INSERT OR IGNORE INTO beam_favorites (member_id, course_id, created_at) VALUES (?, ?, ?)').bind(actor.id, course.id, now()).run()
  else await env.DB.prepare('DELETE FROM beam_favorites WHERE member_id = ? AND course_id = ?').bind(actor.id, course.id).run()
  return { course: course.id, favorite: on }
}

export async function saveSearch(env: Bindings, actor: Actor, input: Input) {
  const name = input.text('name', { max: 80 })
  const url = new URL('https://catalog.invalid/')
  for (const key of ['q', 'subject', 'skill', 'role', 'language', 'maxMinutes']) url.searchParams.set(key, input.text(key, { optional: true, max: 80 }))
  const query = catalogQuery(url)
  insist(((await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM beam_saved_searches WHERE member_id = ?', actor.id))?.n ?? 0) < 20, 'too_many_searches', 409)
  const id = newId()
  await env.DB.prepare('INSERT INTO beam_saved_searches (id, member_id, name, query, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, actor.id, name, JSON.stringify(query), now()).run()
  return { id }
}

