// AGENT-008: evaluate and retire ineffective interventions. Once an applied intervention's after period has ended (the
// day after its last day in the business time zone), the owner or the manager who approved its measurement plan closes
// the measurement. Beam then compares intended and observed outcomes by rule, not by a model: the basis is the
// difference against the comparison group when the plan has one, otherwise the exposed group's own change; it is
// "improved" when the approximate 95% interval lies wholly on the better side of zero, "worse" when wholly on the other
// side, "no_improvement" when it includes zero, and "not_measurable" when the basis is hidden. Process changes recorded
// in the periods are named as changed conditions. The evaluation keeps the closing comparison with its uncertainty and
// limits, and proposes alternatives: revised practice, a process fix, and, unless improved and when the intervention
// still has open assignments, retiring them. Closing freezes the imports; the evaluation is never edited or removed.
// Only a person retires: a manager (or the owner) chooses among the intervention's assignments that were open at closing
// and are still open, for people in their teams; each is cancelled with the evaluation as its reason. Completed
// assignments, completions, certificates, outcome values and the evaluation itself never change.
import type { Bindings } from '../auth.server'
import { isManager, type Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt } from './core'
import type { Input } from './input'
import { outcomeComparison } from './outcomes'
import { business } from './people'
import { inScope, requireLearnerScope } from './scope'
import { localDate } from './time'

export const PREPARED_BY_RULE = 'Prepared by rule, not by a model.'
type Finding = 'improved' | 'no_improvement' | 'worse' | 'not_measurable'

function judge(direction: string, interval: number[] | null): Finding {
  if (!interval) return 'not_measurable'
  const [low, high] = interval
  const better = direction === 'lower' ? high < 0 : low > 0
  const worse = direction === 'lower' ? low > 0 : high < 0
  return better ? 'improved' : worse ? 'worse' : 'no_improvement'
}

const SENTENCES: Record<Finding, string> = {
  improved: 'The outcome improved beyond the uncertainty: the interval lies wholly on the better side of zero.',
  no_improvement: 'No observed improvement: the interval includes zero, so the intervention cannot be shown to have helped.',
  worse: 'The outcome moved the wrong way: the interval lies wholly on the worse side of zero.',
  not_measurable: 'Not measurable: the result is hidden by the privacy bound, so improvement cannot be judged.',
}

export async function closeMeasurement(env: Bindings, actor: Actor, input: Input) {
  insist(isManager(actor) && !actor.agent, 'forbidden', 403)
  const id = input.text('plan', { max: 64 })
  const view = await outcomeComparison(env, actor, id)
  insist(actor.owner || view.plan.approvedBy === actor.id, 'forbidden', 403)
  insist(!await one(env, 'SELECT 1 FROM beam_outcome_evaluations WHERE plan = ?', id), 'measurement_closed', 409)
  const zone = (await business(env))!.timezone
  insist(localDate(now(), zone) > view.plan.after[1], 'measurement_window_open', 409, { after: view.plan.after })
  const basis = view.plan.comparison === 'rest_of_role'
    ? { kind: 'difference', value: view.difference?.value ?? null, interval: view.difference?.interval ?? null }
    : { kind: 'exposed_change', value: view.exposed && !view.exposed.hidden ? view.exposed.change : null, interval: view.exposed && !view.exposed.hidden ? view.exposed.interval : null }
  const finding = judge(view.plan.direction, basis.interval)
  const intervention = await one(env, 'SELECT result_json FROM beam_agent_proposals WHERE id = ?', view.plan.intervention)
  const created: string[] = JSON.parse(intervention!.result_json).assignments ?? []
  const open = (await all<{ id: string }>(env, "SELECT id FROM beam_assignments WHERE id IN (SELECT value FROM json_each(?)) AND status = 'open' ORDER BY id", JSON.stringify(created))).map(row => row.id)
  const confounders = view.confounders as { date: string; description: string }[]
  const alternatives = [
    ...finding === 'improved' ? [{ kind: 'keep', summary: 'Keep the intervention: the outcome improved, though that alone does not show it caused the change.' }] : [],
    { kind: 'revised_practice', summary: 'Replace further course time with targeted practice on the diagnosed step, measured with a new plan.' },
    { kind: 'process_fix', summary: confounders.length ? `Look at the process first: ${confounders.map(change => `${change.date} ${change.description}`).join('; ')} changed conditions during the measurement.` : 'Look at the process itself: training that does not move the outcome often points at the work, not the people.' },
    ...finding !== 'improved' && open.length ? [{ kind: 'retire_future', summary: `Retire the ${open.length} open ${open.length === 1 ? 'assignment' : 'assignments'} this intervention created; completed ones and their evidence stay.`, assignments: open.length }] : [],
  ]
  const evaluation = {
    finding, reading: SENTENCES[finding], intended: { metric: view.plan.metric, unit: view.plan.unit, direction: view.plan.direction }, observed: basis,
    processChanged: confounders.length > 0, confounders, comparison: { exposed: view.exposed, comparisonGroup: view.comparisonGroup, difference: view.difference, limits: view.limits },
    alternatives, preparedBy: PREPARED_BY_RULE, causation: view.causation,
  }
  await commit(env, [stmt(env, 'INSERT INTO beam_outcome_evaluations (plan, intervention, finding, evaluation_json, retirable_json, closed_by, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, view.plan.intervention, finding, JSON.stringify(evaluation), JSON.stringify(finding === 'improved' ? [] : open), actor.id, now())],
    { actor, action: 'outcome.close', subject: id, detail: { intervention: view.plan.intervention, finding, retirable: finding === 'improved' ? 0 : open.length } })
  return { id, finding }
}

/** The closed evaluation for its comparison's readers, with the retirable assignments of the reader's own people. */
export async function evaluation(env: Bindings, actor: Actor, id: string) {
  await outcomeComparison(env, actor, id)
  const row = await one(env, 'SELECT * FROM beam_outcome_evaluations WHERE plan = ?', id)
  insist(row, 'measurement_open', 404)
  const listed: string[] = JSON.parse(row.retirable_json)
  const retirable = await all(env, "SELECT a.id AS assignment, a.learner_id AS learner, m.name, c.title AS course FROM beam_assignments a JOIN beam_members m ON m.id = a.learner_id JOIN beam_courses c ON c.id = a.course_id WHERE a.id IN (SELECT value FROM json_each(?)) AND a.status = 'open' ORDER BY m.name, a.id", JSON.stringify(listed))
  const retirements = await all(env, 'SELECT id, assignments_json, note, decided_by AS decidedBy, decided_at AS decidedAt FROM beam_outcome_retirements WHERE plan = ? ORDER BY decided_at', id)
  return {
    plan: id, intervention: row.intervention, closedBy: row.closed_by, closedAt: row.closed_at, ...JSON.parse(row.evaluation_json),
    retirable: retirable.filter(item => inScope(actor, item.learner as string)),
    retirements: retirements.map(({ assignments_json, ...rest }) => ({ ...rest, assignments: JSON.parse(assignments_json as string) })),
  }
}

export async function evaluationsFor(env: Bindings, actor: Actor, plans: string[]) {
  const closed = await all(env, 'SELECT plan FROM beam_outcome_evaluations WHERE plan IN (SELECT value FROM json_each(?))', JSON.stringify(plans))
  return new Map(await Promise.all(closed.map(async row => [row.plan as string, await evaluation(env, actor, row.plan).catch(() => null)] as const)))
}

export async function retireAssignments(env: Bindings, actor: Actor, input: Input) {
  insist(isManager(actor), 'forbidden', 403)
  insist(!actor.agent, 'human_approval_required', 403)
  const id = input.text('plan', { max: 64 })
  const row = await one(env, 'SELECT finding, retirable_json FROM beam_outcome_evaluations WHERE plan = ?', id)
  insist(row, 'measurement_open', 409)
  insist(row.finding === 'no_improvement' || row.finding === 'worse', 'retirement_needs_negative_finding', 409, { finding: row.finding })
  const chosen = [...new Set(input.list('assignments'))]
  insist(chosen.length > 0, 'assignments_required')
  const listed: string[] = JSON.parse(row.retirable_json)
  const rows = await all<{ id: string; learner_id: string; status: string }>(env, 'SELECT id, learner_id, status FROM beam_assignments WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(chosen))
  for (const assignment of chosen) {
    const found = rows.find(item => item.id === assignment)
    // Only the intervention's assignments still open: completed work and anything else is never retired.
    insist(found && listed.includes(assignment) && found.status === 'open', 'assignment_not_retirable', 409, { assignment })
    requireLearnerScope(actor, found.learner_id)
  }
  const note = input.text('note', { max: 1000, optional: true }) || null
  const retirement = newId(), reason = JSON.stringify({ reason: `retired after measurement ${id} found no improvement`, retirement })
  // One batch: each still-open assignment is cancelled with its audit line, beside the retirement record.
  await commit(env, [
    ...chosen.flatMap(assignment => [stmt(env, "UPDATE beam_assignments SET status = 'cancelled' WHERE id = ? AND status = 'open'", assignment), stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, ?, ?, ?, ? WHERE changes() = 1', now(), actor.id, 'assignment.retire', assignment, reason)]),
    stmt(env, 'INSERT INTO beam_outcome_retirements (id, plan, assignments_json, note, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, ?)', retirement, id, JSON.stringify(chosen), note, actor.id, now()),
  ], { actor, action: 'outcome.retire', subject: id, detail: { retirement, assignments: chosen.length } })
  return { id: retirement, plan: id, retired: chosen }
}
