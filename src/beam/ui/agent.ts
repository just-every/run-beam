// Agent work: proposals the owner's agent (or a person) prepared, each with its
// inputs, reasons, exclusions and an exact preview, approved or declined here.
// Course-draft proposals are listed too and decided on their course page.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { listProposals } from '../agent-work'
import { all } from '../core'
import { memberNames } from '../people'
import { outcomeComparison, plansFor } from '../outcomes'
import { measurement } from './outcomes'
import { formatDay, formatInstant, zonedInstant } from '../time'
import { agentName, area, checks, h, hidden, page, select, when, type Html } from './html'

const TABS = [['waiting', 'Waiting'], ['approved', 'Approved'], ['declined', 'Declined']] as const

function preview(proposal: any, names: Map<string, string>, labels: Map<string, string>, assignments: Map<string, any>, zone: string): Html {
  const p = proposal.payload
  const table = (heads: string[], rows: unknown[][]) => h`<div class="table-wrap"><table class="preview"><thead><tr>${heads.map(head => h`<th scope="col">${head}</th>`)}</tr></thead><tbody>${rows.map(row => h`<tr>${row.map(value => h`<td>${value}</td>`)}</tr>`)}</tbody></table></div>`
  switch (proposal.kind) {
    case 'assignment_plan': return table(['Person', 'Course and revision', 'Due'], p.items.map((item: any) => [names.get(item.learner), labels.get(item.courseRevision), formatInstant(zonedInstant(item.dueDate, item.dueTime, item.timezone), item.timezone, zone)]))
    case 'reminders': return table(['Person', 'Course', 'Message'], p.items.map((item: any) => [names.get(assignments.get(item.assignment)?.learner_id), assignments.get(item.assignment)?.title, item.message]))
    case 'scenario': return h`<p>${labels.get(p.courseRevision)} · ${p.steps.length} ${p.steps.length === 1 ? 'step' : 'steps'}</p><details><summary>Rubric and steps</summary><p><strong>Rubric.</strong> ${p.rubric}</p><ol>${p.steps.map((step: any) => h`<li><p>${step.situation}</p><ul>${step.choices.map((choice: any) => h`<li>${choice.label} — <span class="muted">${choice.feedback}</span></li>`)}</ul></li>`)}</ol></details>`
    case 'question_plan': return h`<p><strong>Purpose.</strong> ${p.purpose}</p><ol>${p.questions.map((question: string) => h`<li>${question}</li>`)}</ol><p class="muted">Asks ${p.participants.map((member: string) => names.get(member)).join(', ')} · closes ${formatDay(p.closesOn)}. Answers are optional and shown without names.</p>`
    case 'intervention': return h`<p class="muted">Diagnosed role: ${p.role}. Recommended: ${p.options.find((option: any) => option.id === p.recommended)?.summary}.</p>${table(['Option', 'Kind', 'Expected benefit', 'People', 'Paid time'], p.options.map((option: any) => [h`${option.id === p.recommended ? h`<strong>${option.summary}</strong>` : option.summary}${option.courseRevision ? h`<br><span class="muted">${labels.get(option.courseRevision) ?? ''}</span>` : ''}`, option.kind.replace('_', ' '), option.expectedBenefit, option.people.map((person: string) => names.get(person)).join(', ') || '—', `${option.paidMinutesPerPerson} min each, ${option.totalPaidMinutes} min in all`]))}`
    case 'process_change': return h`<p><strong>${p.summary}</strong></p><p>${p.change}</p><p class="muted">Approving records the decision; changing the procedure is still done by a person.</p>`
  }
  return h``
}

function decided(proposal: any, zone: string): Html {
  return h`<p class="muted">${proposal.state === 'approved' ? 'Approved' : 'Declined'} by ${proposal.decidedByName}, ${when(proposal.decidedAt, zone)}${proposal.note ? ` — “${proposal.note}”` : ''}</p>${resultLine(proposal)}`
}

function resultLine(proposal: any): Html {
  const r = proposal.result
  if (!r) return h``
  if (proposal.kind === 'assignment_plan') return h`<p>${r.created.length} assigned${r.kept.length ? `, ${r.kept.length} already had an open assignment` : ''}.</p>`
  if (proposal.kind === 'reminders') return h`<p>${r.delivered.length} delivered${r.skipped.length ? `, ${r.skipped.length} skipped because the assignment closed` : ''}.</p>`
  if (proposal.kind === 'scenario') return h`<p>Deployed for practice.</p>`
  if (proposal.kind === 'question_plan') return h`<p><a href="/app/questions/${r.plan}">Open the question plan</a></p>`
  return h`<p>Recorded.</p>`
}

export async function agentPage(env: Bindings, actor: Actor, url: URL, zone: string) {
  const state = url.searchParams.get('state') ?? 'waiting'
  const [proposals, waiting, names, revisions, assignmentRows, drafts] = await Promise.all([
    listProposals(env, actor, state), state === 'waiting' ? null : listProposals(env, actor, 'waiting'), memberNames(env),
    all(env, 'SELECT id, title, number FROM beam_course_revisions'),
    all(env, 'SELECT a.id, a.learner_id, c.title FROM beam_assignments a JOIN beam_courses c ON c.id = a.course_id'),
    state === 'waiting' && (actor.owner || actor.roles.has('author') || actor.roles.has('reviewer')) ? all(env, "SELECT p.id, p.course_id AS course, c.title, p.summary, p.agent, p.prepared_by AS preparedBy FROM beam_proposals p JOIN beam_courses c ON c.id = p.course_id WHERE p.state = 'open' ORDER BY p.created_at DESC") : [],
  ])
  const labels = new Map(revisions.map(row => [row.id, `${row.title} — revision ${row.number}`]))
  const plans = await plansFor(env, proposals.filter(proposal => proposal.kind === 'intervention').map(proposal => proposal.id))
  const comparisons = new Map(await Promise.all(plans.filter(plan => plan.approvedAt && state === 'approved').map(async plan => [plan.intervention, await outcomeComparison(env, actor, plan.id).catch(() => null)] as const)))
  const assignments = new Map(assignmentRows.map(row => [row.id, row]))
  const count = (waiting ?? proposals).length
  const by = (proposal: any) => proposal.viaAgent || proposal.agent ? `${proposal.preparedByName}'s agent${proposal.agent ? ` (${agentName(proposal.agent)})` : ''}` : proposal.preparedByName
  const body = h`<h1>Agent work</h1><p class="lede">Your agent prepares; nothing reaches staff until you approve it.</p>
<nav class="tabs" aria-label="Proposal state"><ul>${TABS.map(([value, label]) => h`<li><a href="/app/agent?state=${value}"${value === state ? h` aria-current="page"` : ''}>${label}${value === 'waiting' ? ` (${count + drafts.length})` : ''}</a></li>`)}</ul></nav>
${proposals.length || drafts.length ? '' : h`<p class="card">${state === 'waiting' ? 'Nothing is waiting for you.' : `No ${state} proposals.`}</p>`}
${proposals.map(proposal => h`<article class="card proposal" aria-labelledby="p-${proposal.id}">
<div class="proposal-who"><span class="tag">${proposal.label}</span><h2 id="p-${proposal.id}">${proposal.title}</h2><p class="muted">Prepared by ${by(proposal)}${proposal.inputs.length ? h`<br>from: ${proposal.inputs.map((input: any) => input.label).join(', ')}` : ''}</p></div>
<div class="proposal-why"><h3>Reasons</h3><ul>${proposal.reasons.map((reason: string) => h`<li>${reason}</li>`)}</ul>${proposal.excluded.length ? h`<h3>Excluded</h3><ul>${proposal.excluded.map((item: any) => h`<li>${item.item} — ${item.reason}</li>`)}</ul>` : ''}</div>
<div class="proposal-what"><h3>Preview (will ${proposal.kind === 'process_change' ? 'record' : 'create'})</h3>${preview(proposal, names, labels, assignments, zone)}${proposal.state !== 'waiting' ? decided(proposal, zone) : proposal.canDecide ? decisionForm(proposal, names) : h`<p class="muted">Waiting for a decision.</p>`}${measurement(actor, proposal, plans.filter(plan => plan.intervention === proposal.id), comparisons.get(proposal.id), names)}</div>
</article>`)}
${drafts.map(draft => h`<article class="card proposal" aria-labelledby="d-${draft.id}"><div class="proposal-who"><span class="tag">Course draft</span><h2 id="d-${draft.id}">${draft.title}</h2><p class="muted">Prepared by ${names.get(draft.preparedBy)}${draft.agent ? `'s agent (${agentName(draft.agent)})` : ''}</p></div><div class="proposal-why"><h3>Summary</h3><p>${draft.summary}</p></div><div class="proposal-what"><p><a class="button" href="/app/courses/${draft.course}">Review on the course page</a></p></div></article>`)}`
  return page('Agent work', actor, body, { current: '/app/agent', url })
}

function decisionForm(proposal: any, names: Map<string, string>): Html {
  const p = proposal.payload
  // AGENT-003: the manager chooses the option and its people; the broad course is chosen only here, never by default.
  const choose = proposal.kind === 'intervention' ? [select('Option to apply', 'option', p.options.map((option: any) => ({ value: option.id, label: `${option.summary} (${option.kind.replace('_', ' ')})` })), p.recommended), checks('People to include (none ticked: everyone the option names)', 'people', [...new Set(p.options.flatMap((option: any) => option.people))].map((person: any) => ({ value: person, label: names.get(person) ?? person })))] : []
  const fields = [hidden('proposal', proposal.id), hidden('sha256', proposal.sha256), ...choose, area('Note (optional)', 'note', '', false)]
  return h`<form method="post" action="/app/do/agent.decide" class="decide-form">${hidden('returnTo', '/app/agent')}${fields}<div class="actions"><button type="submit" name="decision" value="approve">Approve</button><button type="submit" name="decision" value="decline" class="secondary">Decline</button></div></form>`
}
