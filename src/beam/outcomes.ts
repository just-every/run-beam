import { importErrors } from './diagnosis-evidence'
// AGENT-005: whether learning transfers into work. Before an intervention is applied, a manager approves its
// measurement plan: the operational metric and its unit and better direction, a baseline period and an after period
// (calendar dates in the business time zone, both ends inclusive, the baseline ending before the after period
// starts), whether the rest of the diagnosed role is the comparison group, and the privacy bound (the smallest group
// whose result is shown, 3 at least). The plan fixes the cohort: the diagnosed role's people at approval. The people the
// approved intervention reached are exposed; with "rest of role" the others are the comparison group.
// Imported values are matched by directory employee id and kept only for the cohort's people the importer manages,
// inside the two periods; a blank value is recorded as missing. Process changes are recorded as confounders.
// The comparison is per group, never per person: each person's values are averaged per period, a group's change is the
// mean of its people's after-minus-before changes with an approximate 95% interval (mean ± 1.96 standard errors), and a
// group smaller than the privacy bound, or differing from an earlier plan's group by fewer people than the bound, is
// hidden, and so is the difference when either side is. Readers are the owner, the approving manager and managers whose
// teams include cohort people. Results are rounded to two decimals. Beam never ranks or lists
// employees and never claims the training caused a change: completion proves neither competence nor causation.
import type { Bindings } from '../auth.server'
import { isManager, type Actor } from './actor'
import { all, BeamError, commit, insist, newId, now, one, stmt, type Row } from './core'
import { parseCsv, key } from './directory'
import type { Input } from './input'
import { roleMembers } from './interventions'
import { inScope } from './scope'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const day = (value: string, code: string) => { insist(DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), code); return value }
const round = (value: number) => Math.round(value * 100) / 100
export const CAUSATION = 'This comparison does not show that the intervention caused any change. Completion proves neither competence nor causation.'
export const NO_RANKING = 'Results are shown for groups only; Beam never ranks or lists individual employees.'

async function intervention(env: Bindings, id: string) {
  const row = await one(env, "SELECT id, state, payload_json, result_json FROM beam_agent_proposals WHERE id = ? AND kind = 'intervention'", id)
  insist(row, 'intervention_not_found', 404)
  return { id: row.id as string, state: row.state as string, payload: JSON.parse(row.payload_json), result: row.result_json ? JSON.parse(row.result_json) : null }
}

export async function proposePlan(env: Bindings, actor: Actor, input: Input) {
  insist(isManager(actor), 'forbidden', 403)
  const target = await intervention(env, input.text('intervention', { max: 64 }))
  insist(target.state === 'waiting', 'intervention_already_decided', 409)
  const plan = {
    metric: input.text('metric', { max: 160 }), unit: input.text('unit', { max: 40 }), direction: input.text('direction', { max: 10 }),
    baselineFrom: day(input.text('baselineFrom', { max: 10 }), 'invalid_baselineFrom'), baselineTo: day(input.text('baselineTo', { max: 10 }), 'invalid_baselineTo'),
    afterFrom: day(input.text('afterFrom', { max: 10 }), 'invalid_afterFrom'), afterTo: day(input.text('afterTo', { max: 10 }), 'invalid_afterTo'),
    comparison: input.text('comparison', { max: 20 }), minGroup: input.integer('minGroup', { min: 3, max: 50 })!,
  }
  insist(['higher', 'lower'].includes(plan.direction), 'invalid_direction')
  insist(['rest_of_role', 'none'].includes(plan.comparison), 'invalid_comparison')
  insist(plan.baselineFrom <= plan.baselineTo && plan.afterFrom <= plan.afterTo, 'invalid_period')
  insist(plan.baselineTo < plan.afterFrom, 'baseline_must_precede_after')
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_outcome_plans (id, intervention, metric, unit, direction, baseline_from, baseline_to, after_from, after_to, comparison, min_group, prepared_by, via_agent, prepared_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, target.id, plan.metric, plan.unit, plan.direction, plan.baselineFrom, plan.baselineTo, plan.afterFrom, plan.afterTo, plan.comparison, plan.minGroup, actor.id, actor.agent ? 1 : 0, now())],
    { actor, action: 'outcome.plan', subject: id, detail: { intervention: target.id, ...plan } })
  return { id }
}

export async function approvePlan(env: Bindings, actor: Actor, input: Input) {
  insist(isManager(actor), 'forbidden', 403)
  insist(!actor.agent, 'human_approval_required', 403)
  const plan = await one(env, 'SELECT * FROM beam_outcome_plans WHERE id = ?', input.text('plan', { max: 64 }))
  insist(plan, 'plan_not_found', 404)
  insist(!plan.approved_at, 'plan_approved', 409)
  const target = await intervention(env, plan.intervention)
  // Measurement is chosen before the intervention: once it is decided, its plan can no longer change.
  insist(target.state === 'waiting', 'intervention_already_decided', 409)
  insist(!await one(env, 'SELECT 1 FROM beam_outcome_plans WHERE intervention = ? AND approved_at IS NOT NULL', target.id), 'plan_approved', 409)
  const cohort = await roleMembers(env, target.payload.role)
  await commit(env, [stmt(env, 'UPDATE beam_outcome_plans SET approved_by = ?, approved_at = ?, cohort_json = ? WHERE id = ? AND approved_at IS NULL', actor.id, now(), JSON.stringify(cohort), plan.id)],
    { actor, action: 'outcome.approve', subject: plan.id, detail: { intervention: target.id, cohort: cohort.length } })
  return { id: plan.id, approved: true, cohort: cohort.length }
}

function groupsOf(plan: Row, reached: string[]) {
  const cohort: string[] = JSON.parse(plan.cohort_json)
  const exposed = reached.filter(person => cohort.includes(person))
  return { cohort, exposed, comparison: plan.comparison === 'rest_of_role' ? cohort.filter(person => !exposed.includes(person)) : [] }
}

async function approvedPlan(env: Bindings, id: string) {
  const plan = await one(env, 'SELECT * FROM beam_outcome_plans WHERE id = ? AND approved_at IS NOT NULL', id)
  insist(plan, 'plan_not_found', 404)
  const target = await intervention(env, plan.intervention)
  insist(target.state === 'approved' && target.result, 'intervention_not_applied', 409)
  return { plan, target, ...groupsOf(plan, target.result.people) }
}

/** Groups of earlier approved, applied plans: a group differing from one of them by fewer than the bound is hidden. */
async function earlierGroups(env: Bindings, plan: Row) {
  const rows = await all(env, "SELECT p.cohort_json, p.comparison, a.result_json FROM beam_outcome_plans p JOIN beam_agent_proposals a ON a.id = p.intervention WHERE p.id <> ? AND p.approved_at IS NOT NULL AND p.approved_at <= ? AND a.state = 'approved' AND a.result_json IS NOT NULL", plan.id, plan.approved_at)
  return rows.flatMap(row => { const groups = groupsOf(row, JSON.parse(row.result_json).people); return [groups.exposed, groups.comparison].filter(group => group.length) })
}
const differing = (one: string[], other: string[]) => one.filter(person => !other.includes(person)).length + other.filter(person => !one.includes(person)).length

export async function importOutcomes(env: Bindings, actor: Actor, input: Input) {
  const purpose = input.text('purpose', { optional: true, max: 20 })
  insist(!purpose || purpose === 'diagnosis', 'invalid_import_purpose')
  if (purpose === 'diagnosis') return importErrors(env, actor, input)
  insist(isManager(actor), 'forbidden', 403)
  insist(!actor.agent, 'human_import_required', 403)
  const { plan, exposed, comparison } = await approvedPlan(env, input.text('plan', { max: 64 }))
  // AGENT-008: a closed measurement keeps the values it was evaluated on.
  insist(!await one(env, 'SELECT 1 FROM beam_outcome_evaluations WHERE plan = ?', plan.id), 'measurement_closed', 409)
  const file = await input.file('file', { optional: true, maxBytes: 2_000_000 })
  const text = file ? new TextDecoder().decode(file.bytes) : input.text('csv', { max: 2_000_000, optional: true })
  const changes = input.text('processChanges', { max: 4000, optional: true }).split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const match = line.match(/^(\d{4}-\d{2}-\d{2})\s+(.{1,300})$/)
    insist(match, 'invalid_processChanges')
    return { on: day(match[1], 'invalid_processChanges'), description: match[2].trim() }
  })
  insist(text || changes.length, 'outcomes_empty')
  const statements: D1PreparedStatement[] = [], refused: { line: number; reason: string }[] = []
  let stored = 0, blank = 0
  if (text) {
    const [header, ...lines] = parseCsv(text.replace(/^﻿/, ''))
    const columns = (header ?? []).map(key)
    const at = { employee: columns.indexOf('employeeid'), date: columns.indexOf('date'), value: columns.indexOf('value') }
    insist(at.employee >= 0 && at.date >= 0 && at.value >= 0 && lines.length <= 20_000, 'outcome_headers', 400, { needs: ['Employee ID', 'Date', 'Value'] })
    const members = new Map((await all<{ id: string; employee_id: string }>(env, 'SELECT id, employee_id FROM beam_members WHERE employee_id IS NOT NULL')).map(row => [row.employee_id.toLowerCase(), row.id]))
    const cohort = new Set([...exposed, ...comparison])
    for (const [index, cells] of lines.entries()) {
      if (cells.every(cell => !cell.trim())) continue
      const line = index + 2, refuse = (reason: string) => refused.push({ line, reason })
      const member = members.get((cells[at.employee] ?? '').trim().toLowerCase())
      const date = (cells[at.date] ?? '').trim(), raw = (cells[at.value] ?? '').trim()
      if (!member) { refuse('unknown_employee'); continue }
      if (!cohort.has(member)) { refuse('outside_cohort'); continue }
      if (!inScope(actor, member)) { refuse('outside_your_people'); continue }
      if (!DATE.test(date)) { refuse('invalid_date'); continue }
      if (!(date >= plan.baseline_from && date <= plan.baseline_to) && !(date >= plan.after_from && date <= plan.after_to)) { refuse('outside_periods'); continue }
      if (raw && !/^-?\d+(\.\d+)?$/.test(raw)) { refuse('invalid_value'); continue }
      if (raw) stored++; else blank++
      statements.push(stmt(env, 'INSERT INTO beam_outcome_values (plan, member, observed_on, value, imported_by, imported_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (plan, member, observed_on) DO UPDATE SET value = excluded.value, imported_by = excluded.imported_by, imported_at = excluded.imported_at', plan.id, member, date, raw ? Number(raw) : null, actor.id, now()))
    }
  }
  for (const change of changes) statements.push(stmt(env, 'INSERT INTO beam_outcome_changes (id, plan, changed_on, description, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?)', newId(), plan.id, change.on, change.description, actor.id, now()))
  const result = { id: plan.id, stored, blank, refused, processChanges: changes.length }
  // The audit keeps counts and line numbers only, never a person's value.
  await commit(env, statements, { actor, action: 'outcome.import', subject: plan.id, detail: { stored, blank, refused: refused.length, processChanges: changes.length } })
  return result
}

type Values = Map<string, number[]>
const hiddenLimit = (label: string, reason: string, bound: number) => reason === 'below_privacy_bound'
  ? `The ${label} has fewer than ${bound} people with both periods, so its result is hidden.`
  : `The ${label} differs from an earlier plan's group by fewer than ${bound} people, so its result is hidden.`
function group(people: string[], before: Values, after: Values, minGroup: number, earlier: string[][]) {
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
  const reported = (values: Values) => people.filter(person => values.get(person)?.length).length
  const changes = people.filter(person => before.get(person)?.length && after.get(person)?.length).map(person => mean(after.get(person)!) - mean(before.get(person)!))
  const counts = { people: people.length, reportedBefore: reported(before), reportedAfter: reported(after), missingBefore: people.length - reported(before), missingAfter: people.length - reported(after), paired: changes.length }
  if (changes.length < minGroup) return { ...counts, hidden: true as const, reason: 'below_privacy_bound' }
  if (earlier.some(other => { const count = differing(people, other); return count > 0 && count < minGroup })) return { ...counts, hidden: true as const, reason: 'differs_from_earlier_plan' }
  const average = mean(changes)
  const se = Math.sqrt(changes.reduce((sum, value) => sum + (value - average) ** 2, 0) / (changes.length - 1) / changes.length)
  const pick = (values: Values) => people.filter(person => values.get(person)?.length).map(person => mean(values.get(person)!))
  return { ...counts, hidden: false as const, before: round(mean(pick(before))), after: round(mean(pick(after))), change: round(average), mean: average, standardError: se, interval: [round(average - 1.96 * se), round(average + 1.96 * se)] }
}

/** The comparison for one approved plan: group results only, never a person's value or rank. */
export async function outcomeComparison(env: Bindings, actor: Actor, id: string, url?: URL) {
  insist(isManager(actor) && !actor.agent, 'forbidden', 403)
  if (url && ['person', 'member', 'by', 'rank', 'sort', 'employee'].some(name => url.searchParams.has(name))) throw new BeamError('individual_results_refused', 400)
  const { plan, target, cohort, exposed, comparison } = await approvedPlan(env, id)
  // Readers: the owner, the approving manager, and managers whose teams include cohort people.
  insist(actor.owner || plan.approved_by === actor.id || await one(env, 'SELECT 1 FROM beam_team_members WHERE team_id IN (SELECT value FROM json_each(?)) AND member_id IN (SELECT value FROM json_each(?))', JSON.stringify(actor.managedTeams), JSON.stringify(cohort)), 'forbidden', 403)
  const rows = await all<{ member: string; observed_on: string; value: number | null }>(env, 'SELECT member, observed_on, value FROM beam_outcome_values WHERE plan = ?', plan.id)
  const before: Values = new Map(), after: Values = new Map()
  for (const row of rows) {
    if (row.value === null) continue
    const into = row.observed_on <= plan.baseline_to ? before : after
    into.set(row.member, [...into.get(row.member) ?? [], row.value])
  }
  const blankRows = rows.filter(row => row.value === null).length
  const earlier = await earlierGroups(env, plan)
  const exposedGroup = group(exposed, before, after, plan.min_group, earlier)
  const comparisonGroup = plan.comparison === 'rest_of_role' ? group(comparison, before, after, plan.min_group, earlier) : null
  const comparable = !exposedGroup.hidden && comparisonGroup && !comparisonGroup.hidden
  const difference = comparable ? (() => {
    const se = Math.sqrt(exposedGroup.standardError ** 2 + comparisonGroup.standardError ** 2), value = exposedGroup.mean - comparisonGroup.mean
    return { value: round(value), interval: [round(value - 1.96 * se), round(value + 1.96 * se)] }
  })() : null
  const changes = await all(env, 'SELECT changed_on AS date, description FROM beam_outcome_changes WHERE plan = ? ORDER BY changed_on, recorded_at', plan.id)
  const strip = (value: ReturnType<typeof group> | null) => {
    if (!value || value.hidden) return value
    const { mean: _mean, ...shown } = value
    return { ...shown, standardError: round(value.standardError) }
  }
  const limits = [
    ...exposedGroup.hidden ? [hiddenLimit('exposed group', exposedGroup.reason, plan.min_group)] : [],
    ...plan.comparison === 'none' ? ['No comparison group was chosen, so the before/after change cannot be separated from what would have happened anyway.'] : comparisonGroup?.hidden ? [hiddenLimit('comparison group', comparisonGroup.reason, plan.min_group)] : [],
    ...exposedGroup.missingBefore + exposedGroup.missingAfter + (comparisonGroup ? comparisonGroup.missingBefore + comparisonGroup.missingAfter : 0) + blankRows ? [`Missing data: ${blankRows} blank ${blankRows === 1 ? 'row' : 'rows'}; people without a value are left out of the change.`] : [],
    ...exposedGroup.paired < 30 ? ['Small sample: with fewer than 30 people the interval is rough.'] : [],
  ]
  const contains = (interval: number[]) => interval[0] <= 0 && interval[1] >= 0
  const reading = difference ? (contains(difference.interval) ? 'No clear difference from the comparison group: the interval includes zero.' : `The exposed group's change differs from the comparison group's by ${difference.value} ${plan.unit}; the interval excludes zero, but that alone does not show cause.`) : 'No comparison can be shown.'
  return {
    plan: { id: plan.id, intervention: target.id, metric: plan.metric, unit: plan.unit, direction: plan.direction, baseline: [plan.baseline_from, plan.baseline_to], after: [plan.after_from, plan.after_to], comparison: plan.comparison, minGroup: plan.min_group, approvedBy: plan.approved_by, approvedAt: plan.approved_at },
    exposed: strip(exposedGroup), comparisonGroup: strip(comparisonGroup), difference, blankRows, confounders: changes, limits, reading, causation: CAUSATION, ranking: NO_RANKING,
  }
}

/** Plans for these interventions, for the intervention cards on Agent work. */
export async function plansFor(env: Bindings, interventions: string[]) {
  if (!interventions.length) return []
  return await all(env, 'SELECT id, intervention, metric, unit, direction, baseline_from AS baselineFrom, baseline_to AS baselineTo, after_from AS afterFrom, after_to AS afterTo, comparison, min_group AS minGroup, prepared_by AS preparedBy, via_agent AS viaAgent, approved_by AS approvedBy, approved_at AS approvedAt FROM beam_outcome_plans WHERE intervention IN (SELECT value FROM json_each(?)) ORDER BY prepared_at', JSON.stringify(interventions))
}
