// AGENT-002 imports use AGENT-005's Employee ID, Date, Value CSV shape. Only minimized values survive.
import type { Bindings } from '../auth.server'
import { isManager, type Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt } from './core'
import { key, parseCsv } from './directory'
import type { Input } from './input'
import { requireBusiness } from './people'
import { zonedInstant } from './time'

export const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().startsWith(value)
export async function diagnosisImport(env: Bindings, actor: Actor, id: string) {
 const row = await one(env, 'SELECT i.*, m.name AS actor_name FROM beam_diagnosis_imports i JOIN beam_members m ON m.id = i.actor WHERE i.id = ?', id)
 insist(row, 'import_not_found', 404)
 insist(actor.owner || row.actor === actor.id || row.reviewer === actor.id, 'forbidden', 403)
 return row
}
export async function importErrors(env: Bindings, actor: Actor, input: Input) {
 insist(isManager(actor), 'forbidden', 403)
 insist(!actor.agent, 'human_import_required', 403)
 const course = await one(env, 'SELECT id, published_revision_id, reviewer_id FROM beam_courses WHERE id = ?', input.text('course'))
 insist(course?.published_revision_id, 'course_not_published', 409)
 const role = input.text('jobRole', { max: 120 }), metric = input.text('metric', { max: 160 }), unit = input.text('unit', { max: 40 })
 const from = input.text('from', { max: 10 }), to = input.text('to', { max: 10 })
 insist(validDay(from) && validDay(to) && from <= to, 'invalid_period')
 const business = await requireBusiness(env), start = zonedInstant(from, '00:00', business.timezone)
 // A manager's administered units never widen their managed cohort.
 const members = await all(env, `SELECT DISTINCT m.id, m.employee_id FROM beam_members m WHERE lower(m.job_role) = lower(?) AND m.employment <> 'terminated' AND (? = 1 OR m.id IN (SELECT member_id FROM beam_team_members WHERE team_id IN (SELECT value FROM json_each(?))))`, role, actor.owner ? 1 : 0, JSON.stringify(actor.managedTeams))
 const cohort = members.map(m => m.id as string)
 insist(cohort.length, 'empty_managed_cohort')
 const trained = (await all(env, 'SELECT DISTINCT learner_id FROM beam_completions WHERE course_revision_id = ? AND completed_at < ? AND (expires_at IS NULL OR expires_at > ?)', course.published_revision_id, start, start)).map(row => row.learner_id).filter(id => cohort.includes(id))
 const planId = input.text('questionPlan', { optional: true })
 if (planId) {
  const plan = await one(env, 'SELECT approved_by FROM beam_question_plans WHERE id = ?', planId)
  insist(plan && (actor.owner || plan.approved_by === actor.id), 'question_plan_outside_scope', 403)
 }
 const file = await input.file('file', { optional: true, maxBytes: 2_000_000 })
 const csv = file ? new TextDecoder().decode(file.bytes) : input.text('csv', { max: 2_000_000 })
 const [header, ...lines] = parseCsv(csv.replace(/^\uFEFF/, '')), columns = (header ?? []).map(key)
 const employee = columns.indexOf('employeeid'), date = columns.indexOf('date'), value = columns.indexOf('value')
 insist(employee >= 0 && date >= 0 && value >= 0 && lines.length <= 20_000, 'outcome_headers')
 const lookup = new Map(members.filter(m => m.employee_id).map(m => [m.employee_id.toLowerCase(), m.id]))
 const id = newId(), statements: D1PreparedStatement[] = [], refused: { line: number; reason: string }[] = []
 let kept = 0, rows = 0
 for (const [index, cells] of lines.entries()) {
  if (cells.every(cell => !cell.trim())) continue
  rows++
  const member = lookup.get((cells[employee] ?? '').trim().toLowerCase()), on = (cells[date] ?? '').trim(), raw = (cells[value] ?? '').trim(), line = index + 2
  const reason = !member ? 'outside_managed_cohort' : !validDay(on) ? 'invalid_date' : on < from || on > to ? 'outside_window' : raw && (!/^\d+(\.\d+)?$/.test(raw) || !Number.isFinite(Number(raw))) ? 'invalid_value' : null
  if (reason) { refused.push({ line, reason }); continue }
  kept++
  statements.push(stmt(env, 'INSERT INTO beam_diagnosis_observations (import_id, member, on_day, value, line) VALUES (?, ?, ?, ?, ?)', id, member, on, raw ? Number(raw) : null, line))
 }
 const at = now(), filename = file?.filename ?? 'inline.csv'
 await commit(env, [stmt(env, 'INSERT INTO beam_diagnosis_imports (id, course, revision, job_role, metric, unit, from_day, to_day, timezone, actor, reviewer, imported_at, filename, row_count, kept, refused_json, cohort_json, trained_json, question_plan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, course.id, course.published_revision_id, role, metric, unit, from, to, business.timezone, actor.id, course.reviewer_id, at, filename, rows, kept, JSON.stringify(refused), JSON.stringify(cohort), JSON.stringify(trained), planId || null), ...statements], { actor, action: 'diagnosis.import', subject: id, detail: { filename, rows, kept, refused: refused.length } })
 return { id, actor: actor.id, importedAt: at, filename, rows, kept, refused }
}
export async function withdrawErrors(env: Bindings, actor: Actor, input: Input) {
 insist(!actor.agent, 'human_withdrawal_required', 403)
 const row = await diagnosisImport(env, actor, input.text('import'))
 insist(actor.owner || row.actor === actor.id, 'forbidden', 403)
 insist(!row.withdrawn_at, 'import_withdrawn', 409)
 await commit(env, [stmt(env, 'UPDATE beam_diagnosis_imports SET withdrawn_at = ? WHERE id = ?', now(), row.id), stmt(env, 'DELETE FROM beam_diagnosis_observations WHERE import_id = ?', row.id)], { actor, action: 'diagnosis.withdraw', subject: row.id })
 return { id: row.id, withdrawn: true }
}
