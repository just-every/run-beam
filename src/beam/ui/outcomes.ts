// AGENT-005 on an intervention card: choose and approve the measurement plan while the intervention waits, then import
// outcomes and read the group comparison once it is applied. Nothing here names or ranks a person.
// AGENT-008: after the window the measurement is closed into Beam's rule-made evaluation, where a manager retires the
// intervention's remaining open assignments for their own people.
import type { Actor } from '../actor'
import { formatDay } from '../time'
import { checks, field, fileField, form, area, h, hidden, select, type Html } from './html'

const period = (from: string, to: string) => `${formatDay(from)} to ${formatDay(to)}`
const planLine = (plan: any) => h`<p><strong>${plan.metric}</strong> (${plan.unit}, ${plan.direction === 'higher' ? 'higher is better' : 'lower is better'}) · baseline ${period(plan.baselineFrom ?? plan.baseline[0], plan.baselineTo ?? plan.baseline[1])} · after ${period(plan.afterFrom ?? plan.after[0], plan.afterTo ?? plan.after[1])} · ${plan.comparison === 'rest_of_role' ? 'compared with the rest of the role' : 'no comparison group'} · groups under ${plan.minGroup} people hidden</p>`

function groupRows(label: string, group: any, unit: string): Html {
  if (!group) return h``
  const counts = `${group.people} people; ${group.missingBefore} missing before, ${group.missingAfter} missing after`
  if (group.hidden) return h`<tr><th scope="row">${label}</th><td colspan="4">Hidden: ${group.reason === 'below_privacy_bound' ? 'fewer people with both periods than the privacy bound' : 'differs from an earlier plan’s group by fewer people than the privacy bound'} (${counts})</td></tr>`
  return h`<tr><th scope="row">${label}</th><td>${group.before} ${unit}</td><td>${group.after} ${unit}</td><td>${group.change} (${group.interval[0]} to ${group.interval[1]})</td><td>${counts}</td></tr>`
}

function comparisonView(view: any): Html {
  const unit = view.plan.unit
  return h`<div class="outcome-comparison"><h4>Comparison</h4><div class="table-wrap"><table class="preview"><thead><tr><th scope="col">Group</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Change (approx. 95% interval)</th><th scope="col">People and missing data</th></tr></thead><tbody>${groupRows('Reached by the intervention', view.exposed, unit)}${groupRows('Comparison group', view.comparisonGroup, unit)}</tbody></table></div>
${view.difference ? h`<p>Difference in change: ${view.difference.value} ${unit} (${view.difference.interval[0]} to ${view.difference.interval[1]}).</p>` : ''}<p>${view.reading}</p>
${view.confounders.length ? h`<h4>Process changes (possible confounders)</h4><ul>${view.confounders.map((change: any) => h`<li>${formatDay(change.date)}: ${change.description}</li>`)}</ul>` : ''}
${view.limits.length ? h`<h4>Limits</h4><ul>${view.limits.map((limit: string) => h`<li>${limit}</li>`)}</ul>` : ''}<p class="muted"><strong>${view.causation}</strong> ${view.ranking}</p></div>`
}

const FINDINGS: Record<string, string> = { improved: 'Improved', no_improvement: 'No observed improvement', worse: 'Worse', not_measurable: 'Not measurable' }

function evaluationView(actor: Actor, view: any, back: string, names: Map<string, string>): Html {
  const observed = view.observed.interval ? h`${view.observed.kind === 'difference' ? 'Difference against the comparison group' : 'Change in the reached group'}: ${view.observed.value} ${view.intended.unit} (approx. 95% interval ${view.observed.interval[0]} to ${view.observed.interval[1]})` : h`No result can be shown.`
  const retire = view.retirable.length && !actor.agent && ['no_improvement', 'worse'].includes(view.finding) ? form('outcome.retire', back, [hidden('plan', view.plan),
    checks('Future assignments to retire (completed ones are never changed)', 'assignments', view.retirable.map((item: any) => ({ value: item.assignment, label: `${item.name} — ${item.course}` }))), area('Note (optional)', 'note', '', false)], 'Retire the selected assignments', { secondary: true }) : h``
  return h`<div class="outcome-evaluation"><h4>Evaluation: ${FINDINGS[view.finding]}</h4><p class="muted">${view.preparedBy} Closed by ${names.get(view.closedBy)}.</p>
<p>Intended: ${view.intended.metric} ${view.intended.direction === 'lower' ? 'lower' : 'higher'}. ${observed}.</p><p>${view.reading}</p>
${view.processChanged ? h`<p>Conditions changed during the measurement: ${view.confounders.map((change: any) => `${formatDay(change.date)} ${change.description}`).join('; ')}.</p>` : ''}
<h4>Alternatives</h4><ul>${view.alternatives.map((item: any) => h`<li>${item.summary}</li>`)}</ul>
${view.retirements.map((item: any) => h`<p>${names.get(item.decidedBy)} retired ${item.assignments.length} ${item.assignments.length === 1 ? 'assignment' : 'assignments'}${item.note ? ` — “${item.note}”` : ''}.</p>`)}
${retire}<p class="muted">This finding stays on the intervention; completions, certificates and imported outcomes are never changed by it.</p></div>`
}

export function measurement(actor: Actor, proposal: any, plans: any[], comparison: any, names: Map<string, string>, evaluations: Map<string, any> = new Map()): Html {
  if (proposal.kind !== 'intervention') return h``
  const approved = plans.find(plan => plan.approvedAt)
  const back = '/app/agent?state=' + proposal.state
  const choose = proposal.state === 'waiting' && proposal.canDecide && !approved
  const offered = choose ? plans.map(plan => h`<li>${planLine(plan)}<p class="muted">Prepared by ${names.get(plan.preparedBy)}${plan.viaAgent ? "'s agent" : ''}</p>${form('outcome.approve', back, hidden('plan', plan.id), 'Approve this measurement plan')}</li>`) : []
  const planForm = choose ? form('outcome.plan', back, [hidden('intervention', proposal.id), field('Operational outcome', 'metric'), field('Unit', 'unit', { hint: 'For example: missed logs per 10 openings' }),
    select('Better direction', 'direction', [{ value: 'lower', label: 'Lower is better' }, { value: 'higher', label: 'Higher is better' }]),
    field('Baseline from', 'baselineFrom', { type: 'date' }), field('Baseline to', 'baselineTo', { type: 'date' }), field('After from', 'afterFrom', { type: 'date' }), field('After to', 'afterTo', { type: 'date' }),
    select('Comparison group', 'comparison', [{ value: 'rest_of_role', label: 'The rest of the diagnosed role' }, { value: 'none', label: 'None' }]),
    field('Privacy bound (smallest group shown)', 'minGroup', { type: 'number', value: 5 })], 'Propose measurement plan', { secondary: true }) : h``
  const evaluated = approved ? evaluations.get(approved.id) : null
  const closeForm = approved && comparison && !evaluated && !actor.agent ? form('outcome.close', back, hidden('plan', approved.id), 'Close the measurement and evaluate', { secondary: true }) : h``
  const importForm = approved && proposal.state === 'approved' && !actor.agent && !evaluated ? form('outcome.import', back, [hidden('plan', approved.id), fileField('Outcomes CSV (Employee ID, Date, Value; a blank value is missing)', 'file', { accept: '.csv,text/csv' }), area('Process changes in these periods (one per line: YYYY-MM-DD what changed)', 'processChanges', '', false)], 'Import outcomes', { multipart: true, secondary: true }) : h``
  return h`<section class="outcome-plan" aria-label="Measuring the outcome"><h3>Measuring the outcome</h3>
${approved ? h`${planLine(approved)}<p class="muted">Approved by ${names.get(approved.approvedBy)} before the intervention was decided.</p>` : proposal.state === 'waiting' ? h`<p class="muted">Choose the outcome, periods, comparison and privacy bound before deciding the intervention.</p>` : h`<p class="muted">No measurement plan was approved before this intervention was decided.</p>`}
${offered.length ? h`<ul class="plain">${offered}</ul>` : ''}${planForm}${comparison ? comparisonView(comparison) : ''}${evaluated ? evaluationView(actor, evaluated, back, names) : ''}${importForm}${closeForm}</section>`
}
