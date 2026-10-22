// MOVE-009's credit decision, the foundation REPORT-001 counts. A learning administrator of the course's unit (or the
// owner) approves one decision per mapped course with a written reason and a renewal interval. Before approval a
// write-free preview lists who will be credited and names each exclusion: a completion older than the interval
// (expired), an imported person with no Beam match (unmatched), a person who already holds a current native completion
// (which always wins) or a live credit. Where one person has several imported completions the latest counts. A credited
// person counts as current, "credited from <source> history", until the historical completion date plus the interval in
// the employer's time zone. The imported rows stay labelled history: Beam issues no completion or certificate for them,
// and undoing a decision changes no imported row, assignment, attempt or completion.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { requireBusiness } from './people'
import { DAY, addDays, zonedInstant } from './time'
import { manages, permits } from './scope'

/** Only a human owner, or a learning administrator of the course's unit, decides credit. */
async function approver(env: Bindings, actor: Actor, course: string) {
  insist(!actor.agent && !actor.viewAs, 'human_session_required', 403)
  const row = await one(env, 'SELECT id, title, unit_id FROM beam_courses WHERE id = ?', course)
  insist(row, 'course_not_found', 404)
  insist(actor.owner || (row.unit_id && actor.adminUnits.includes(row.unit_id)), 'credit_approver_required', 403)
  return row
}

async function plan(env: Bindings, course: string, intervalDays: number) {
  const at = now(), zone = (await requireBusiness(env)).timezone
  const imported = (await all(env, "SELECT id, payload FROM beam_imported_history WHERE kind = 'completion'"))
    .map(row => ({ id: row.id as string, ...JSON.parse(row.payload) })).filter(row => row.mappedCourse === course && row.completedOn)
  const credited = new Set((await liveCredits(env)).filter(row => row.course === course && row.expiresAt > at).map(row => row.member))
  const current = new Set((await all(env, 'SELECT learner_id FROM beam_completions WHERE course_id = ? AND (expires_at IS NULL OR expires_at > ?)', course, at)).map(row => row.learner_id))
  const names = new Map((await all(env, 'SELECT id, name FROM beam_members')).map(row => [row.id, row.name]))
  const latest = new Map<string, Row>()
  for (const row of imported) if (row.member && names.has(row.member) && (!latest.has(row.member) || row.completedOn > latest.get(row.member)!.completedOn)) latest.set(row.member, row)
  const credit: Row[] = [], excluded: Row[] = []
  for (const row of imported) if (!row.member || !names.has(row.member)) excluded.push({ history: row.id, name: row.name, source: row.source, completedOn: row.completedOn, reason: 'unmatched' })
  for (const [member, row] of [...latest].sort((a, b) => names.get(a[0])!.localeCompare(names.get(b[0])!))) {
    const expiresOn = addDays(row.completedOn, intervalDays), expiresAt = zonedInstant(expiresOn, '00:00', zone)
    const item = { member, name: names.get(member), history: row.id, source: row.source, completedOn: row.completedOn, expiresOn, expiresAt }
    const reason = expiresAt <= at ? 'expired' : current.has(member) ? 'native_current' : credited.has(member) ? 'already_credited' : null
    if (reason) excluded.push({ ...item, reason })
    else credit.push(item)
  }
  return { course, intervalDays, credit, excluded }
}

const decision = (input: Input) => ({ course: input.text('course'), intervalDays: input.integer('intervalDays', { min: 1, max: 3650 })! })

export async function previewCredit(env: Bindings, actor: Actor, input: Input) {
  const { course, intervalDays } = decision(input)
  await approver(env, actor, course)
  return await plan(env, course, intervalDays)
}

export async function approveCredit(env: Bindings, actor: Actor, input: Input) {
  const { course, intervalDays } = decision(input), reason = input.text('reason', { max: 1000 })
  await approver(env, actor, course)
  const preview = await plan(env, course, intervalDays)
  insist(preview.credit.length > 0, 'nothing_to_credit', 409)
  const id = newId(), at = now()
  await commit(env, [
    stmt(env, 'INSERT INTO beam_history_credits (id, course_id, interval_days, reason, approved_by, approved_at) VALUES (?, ?, ?, ?, ?, ?)', id, course, intervalDays, reason, actor.id, at),
    ...preview.credit.map(item => stmt(env, 'INSERT INTO beam_history_credit_people (credit_id, member_id, history_id, source, completed_on, expires_at) VALUES (?, ?, ?, ?, ?, ?)', id, item.member, item.history, item.source, item.completedOn, item.expiresAt)),
  ], { actor, action: 'credit.approve', subject: id, detail: { course, intervalDays, reason, credited: preview.credit.map(item => ({ member: item.member, history: item.history })), excluded: preview.excluded.map(item => ({ history: item.history, reason: item.reason })) } })
  return { id, ...preview }
}

export async function undoCredit(env: Bindings, actor: Actor, input: Input) {
  const credit = await one(env, 'SELECT * FROM beam_history_credits WHERE id = ?', input.text('credit'))
  insist(credit, 'credit_not_found', 404)
  await approver(env, actor, credit.course_id)
  insist(!credit.undone_at, 'credit_undone', 409)
  const reason = input.text('reason', { max: 1000 })
  await commit(env, [stmt(env, 'UPDATE beam_history_credits SET undone_by = ?, undone_at = ?, undo_reason = ? WHERE id = ? AND undone_at IS NULL', actor.id, now(), reason, credit.id)],
    { actor, action: 'credit.undo', subject: credit.id, detail: { course: credit.course_id, reason } })
  return { id: credit.id, undone: true }
}

/** Every person a live (not undone) decision credits, with the decision behind it. */
export async function liveCredits(env: Bindings) {
  return await all(env, `SELECT p.member_id AS member, k.course_id AS course, p.source, p.completed_on AS completedOn, p.expires_at AS expiresAt, p.history_id AS history,
      k.id AS credit, k.reason, k.interval_days AS intervalDays, k.approved_at AS approvedAt, m.name AS approvedByName
    FROM beam_history_credit_people p JOIN beam_history_credits k ON k.id = p.credit_id JOIN beam_members m ON m.id = k.approved_by
    WHERE k.undone_at IS NULL ORDER BY p.expires_at DESC`)
}

/** The credit decisions an approver may read: all for the owner, their units' courses for a learning administrator. */
export async function creditsView(env: Bindings, actor: Actor) {
  insist(!actor.agent && (actor.owner || actor.adminUnits.length > 0), 'forbidden', 403)
  const decisions = await all(env, `SELECT k.id, k.course_id AS course, c.title AS courseTitle, k.interval_days AS intervalDays, k.reason, k.approved_at AS approvedAt, a.name AS approvedByName,
      k.undone_at AS undoneAt, k.undo_reason AS undoReason, (SELECT COUNT(*) FROM beam_history_credit_people p WHERE p.credit_id = k.id) AS people
    FROM beam_history_credits k JOIN beam_courses c ON c.id = k.course_id JOIN beam_members a ON a.id = k.approved_by
    WHERE ? = 1 OR c.unit_id IN (SELECT value FROM json_each(?)) ORDER BY k.approved_at DESC`, actor.owner ? 1 : 0, JSON.stringify(actor.adminUnits))
  return { decisions }
}

/** Report readers can drill into the same person's credit decision as coverage. It does not widen learner reads. */
export async function recordCredits(env: Bindings, actor: Actor, member: string, native: Row[], days: number) {
  if (!permits(actor, 'reports') || !manages(actor, member, 'reports')) return []
  const at = now(), seen = new Set<string>(), output: Row[] = []
  for (const credit of (await liveCredits(env)).filter(row => row.member === member)) {
    if (seen.has(credit.course)) continue
    seen.add(credit.course)
    const course = await one(env, 'SELECT title FROM beam_courses WHERE id=?', credit.course)
    output.push({ ...credit, courseTitle: course?.title, nativeCurrent: native.some(row => row.course === credit.course && (!row.expiresAt || row.expiresAt > at)), state: credit.expiresAt <= at ? 'missing' : credit.expiresAt <= at + days * DAY ? 'expiring' : 'current' })
  }
  return output
}
