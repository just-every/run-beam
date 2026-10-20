// CONNECT-014: the versioned application API under /api/beam/v1/. Reads are cursor-paged ({ data, next }; pass
// `cursor=next` for the following page; `limit` 1-200, default 50) in a stable order. An enrollment needs an
// `idempotencyKey`: replaying it returns the first result with `replayed: true`, and reusing it for a different
// enrollment is refused. Every row stays inside the credential's teams.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { assignCourse } from './assignments'
import { uploadCertificate } from './external'
import { all, BeamError, commit, insist, now, one, sha256Hex, stmt } from './core'
import { Input } from './input'
import { reportFilters, trainingReport } from './report'

function paged<T>(rows: T[], key: (row: T) => string, url: URL) {
  const limit = Number(url.searchParams.get('limit') ?? 50)
  insist(Number.isInteger(limit) && limit >= 1 && limit <= 200, 'invalid_limit')
  const cursor = url.searchParams.get('cursor') ?? ''
  insist(cursor.length <= 200, 'invalid_cursor')
  const sorted = [...rows].sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)
  const rest = cursor ? sorted.filter(row => key(row) > cursor) : sorted
  const data = rest.slice(0, limit)
  return { data, next: rest.length > limit ? key(data[data.length - 1]) : null }
}

async function people(env: Bindings, actor: Actor, url: URL) {
  const rows = await all<{ id: string; teams: string }>(env, "SELECT m.id, m.name, m.employee_id AS employeeId, m.job_role AS jobRole, m.employment, (SELECT json_group_array(t.team_id) FROM beam_team_members t WHERE t.member_id = m.id) AS teams FROM beam_members m WHERE ? IS NULL OR m.id IN (SELECT value FROM json_each(?))",
    actor.learners ? 1 : null, JSON.stringify(actor.learners ?? []))
  return paged(rows.map(row => ({ ...row, teams: JSON.parse(row.teams) })), row => row.id, url)
}

async function courses(env: Bindings, url: URL) {
  const rows = await all(env, 'SELECT id, title, published_revision_id AS publishedRevision FROM beam_courses WHERE published_revision_id IS NOT NULL AND retired_at IS NULL AND archived_at IS NULL')
  return paged(rows, row => row.id, url)
}

async function enroll(env: Bindings, actor: Actor, request: Request) {
  const input = await Input.from(request)
  const key = input.text('idempotencyKey', { max: 100 })
  const fields = { learner: input.text('learner', { max: 64 }), course: input.text('course', { max: 64 }), dueDate: input.text('dueDate', { max: 10 }), dueTime: input.text('dueTime', { max: 5, optional: true }) || '17:00', timezone: input.text('timezone', { max: 64, optional: true }) }
  const body = await sha256Hex(new TextEncoder().encode(JSON.stringify(fields)))
  const earlier = await one(env, 'SELECT body_sha256, response_json FROM beam_app_requests WHERE credential = ? AND idempotency_key = ?', actor.app!.id, key)
  if (earlier) {
    insist(earlier.body_sha256 === body, 'idempotency_key_reused', 409)
    return { ...JSON.parse(earlier.response_json), replayed: true }
  }
  const result = await assignCourse(env, actor, Input.of({ course: fields.course, learners: [fields.learner], dueDate: fields.dueDate, dueTime: fields.dueTime, timezone: fields.timezone }))
  const response = { idempotencyKey: key, ...fields, created: result.created, kept: result.kept, replayed: false }
  await commit(env, [stmt(env, 'INSERT INTO beam_app_requests (credential, idempotency_key, body_sha256, response_json, created_at) VALUES (?, ?, ?, ?, ?)', actor.app!.id, key, body, JSON.stringify(response), now())],
    { actor, action: 'app.enroll', subject: fields.learner, detail: { idempotencyKey: key, course: fields.course, created: result.created } })
  return response
}

/** Runs the one route requireAppScope admitted. */
export async function applicationCall(env: Bindings, actor: Actor, request: Request, url: URL, path: string) {
  if (path === 'v1/report') {
    const report = await trainingReport(env, actor, reportFilters(url))
    return { summary: report.summary, ...paged(report.rows as any[], row => row.assignment, url) }
  }
  if (path === 'v1/people') return await people(env, actor, url)
  if (path === 'v1/courses') return await courses(env, url)
  if (path === 'v1/enrollments') return await enroll(env, actor, request)
  // An external result goes into LIB-006 review like any upload: pending until its named reviewer decides.
  if (path === 'v1/results') return await uploadCertificate(env, actor, await Input.from(request))
  throw new BeamError('not_found', 404)
}
