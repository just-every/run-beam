// AUTO-006 on the assignment page: the learner's blocker report, the deferral or exemption that holds the assignment,
// and the decision forms for whoever may enroll the learner. Every report and exception stays listed after it ends.
import type { assignmentView } from '../learning'
import type { ComplianceView } from '../compliance'
import { formatDay } from '../time'
import type { Policy } from '../exceptions'
import { area, card, field, form, h, hidden, raw, rows, select, when } from './html'

type View = Awaited<ReturnType<typeof assignmentView>>
const KINDS = [{ value: 'leave', label: 'Leave or time off' }, { value: 'access', label: 'I cannot get to what it needs' }, { value: 'content', label: 'Something in the course is wrong' }, { value: 'other', label: 'Something else' }]
const kindLabel = (kind: string) => KINDS.find(option => option.value === kind)?.label ?? kind
const exceptionLabel = (kind: string) => kind === 'exemption' ? 'Exempt' : 'Deferred'
const STATE: Record<string, string> = { open: 'waiting for a decision', granted: 'answered with an exception', declined: 'declined' }

/** The exception holding the assignment now, said plainly with the due date it keeps. */
export function exceptionNotice(view: View, a: View['assignment'], zone: string) {
  const current = view.exceptions.find(row => row.active)
  if (!current || a.status !== 'open') return ''
  return h`<p class="flash" role="status">${exceptionLabel(current.kind)} through ${formatDay(current.endsOn)}, granted by ${current.grantedByName} (reason: “${current.reason}”). The due date stays ${when(a.dueAt, a.timezone, zone)}; ${current.kind === 'exemption' ? 'this requirement is waived until then' : 'it is not counted overdue until then'}.</p>`
}

const history = (view: View, zone: string) => rows([
  ...view.blockers.map(row => ({ title: `Blocker: ${kindLabel(row.kind)}`, meta: h`${row.note} · reported ${when(row.reportedAt, zone)} · ${STATE[row.state]}${row.decisionReason ? h` by ${row.decidedByName}: ${row.decisionReason}` : ''}` })),
  ...view.exceptions.map(row => ({ title: `${exceptionLabel(row.kind)} through ${formatDay(row.endsOn)}${row.active ? '' : ' (ended)'}`, meta: `${row.grantedByName}, ${when(row.grantedAt, zone)}: ${row.reason}` })),
])

export function blockerCard(view: View, id: string, zone: string) {
  const waiting = view.blockers.some(row => row.state === 'open')
  const open = view.assignment.status === 'open'
  if (!open && !view.blockers.length) return ''
  return card('Something in the way?', h`${view.blockers.length || view.exceptions.length ? history(view, zone) : ''}${open && !waiting ? h`<p class="muted">Tell your manager what is keeping you from this course. They can move the deadline, defer or exempt it; the due date and your work stay on record.</p>${form('blocker.report', `/app/learn/${id}`, [hidden('assignment', id), select('What is in the way', 'kind', KINDS), area('Details', 'note')], 'Report a blocker', { secondary: true })}` : ''}`)
}

export function exceptionCard(view: View, id: string, zone: string) {
  const blocker = view.blockers.find(row => row.state === 'open')
  const holding = view.exceptions.some(row => row.active)
  const open = view.assignment.status === 'open'
  if (!open && !view.blockers.length && !view.exceptions.length) return ''
  return card('Blockers and exceptions', h`${view.blockers.length || view.exceptions.length ? history(view, zone) : h`<p class="muted">No blocker reported and no exception granted.</p>`}
${open && !holding ? h`<p class="muted">A deferral keeps the assignment out of the overdue count until its end date; an exemption waives it until then. Neither moves the due date or touches completions.</p>${form('exception.grant', `/app/learn/${id}`, [hidden('assignment', id), blocker ? hidden('blocker', blocker.id) : '', select('Exception', 'kind', [{ value: 'deferral', label: 'Defer' }, { value: 'exemption', label: 'Exempt' }]), field('Through', 'endsOn', { type: 'date' }), area('Reason', 'reason')], 'Grant the exception', { secondary: true })}` : ''}
${blocker ? form('blocker.decline', `/app/learn/${id}`, [hidden('blocker', blocker.id), area('Why not', 'reason')], 'Decline the blocker', { secondary: true }) : ''}`)
}

/** Manage: blockers waiting for a decision and the records an exception holds now, each linking to its assignment. */
export function manageExceptions(view: ComplianceView, zone: string) {
  if (!view.blockers.length && !view.excepted.length) return ''
  return card('Blockers and exceptions', rows([
    ...view.blockers.map(row => ({ title: `${row.learnerName} — ${row.courseTitle}`, meta: `Blocker: ${kindLabel(row.kind)}, reported ${when(row.reportedAt, zone)}`, href: `/app/learn/${row.assignment}` })),
    ...view.excepted.map(row => ({ title: `${row.learnerName} — ${row.courseTitle}`, meta: `${exceptionLabel(row.exception.kind)} through ${formatDay(row.exception.endsOn)} by ${row.exception.by}; due ${when(row.dueAt, row.timezone, zone)}`, href: `/app/learn/${row.assignment}` })),
  ]), { id: 'exceptions' })
}

const checkbox = (label: string, name: string, checked: boolean) => h`<label class="check"><input type="checkbox" name="${name}" value="on"${checked ? raw(' checked') : ''}> ${label}</label>`

/** The owner's exception policy, on the business settings page. */
export function policyCard(policy: Policy) {
  return card('Deferrals and exemptions', h`<p class="muted">Managers and learning administrators grant these for the people they manage, always with a reason and an end date. Due dates and completions are never changed.</p>${form('exception.policy', '/app/business', [field('Longest deferral (days)', 'maxDeferralDays', { type: 'number', value: policy.maxDeferralDays }), field('Longest exemption (days)', 'maxExemptionDays', { type: 'number', value: policy.maxExemptionDays }), checkbox('Managers may exempt (learning administrators always may)', 'managerExemptions', policy.managerExemptions)], 'Save policy', { secondary: true })}`, { id: 'exception-policy' })
}
