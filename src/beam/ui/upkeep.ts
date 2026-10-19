// AUTHOR-006 on the course page: who the course's upkeep reaches, its fallback owner and next review date, scheduled
// reviews waiting for a decision, and every reminder or escalation mail with any held or failed send.
import type { Actor } from '../actor'
import type { courseDetail } from '../courses'
import { area, card, field, form, h, hidden, rows, select, when } from './html'

type Course = Awaited<ReturnType<typeof courseDetail>>
const ROUTE: Record<string, string> = { responsible: 'responsible owner', fallback: 'fallback owner (escalated)', owner: 'installation owner (escalated)' }
const STATE: Record<string, string> = { open: 'Waiting for a decision', no_material_change: 'No material change', draft_updated: 'Training needs updating' }

export const decisionFields = () => [select('Decision', 'decision', [{ value: 'no_material_change', label: 'No material change to the training' }, { value: 'draft_updated', label: 'Training needs updating (the draft is being revised)' }]), area('Reason', 'note'), field('Next review date', 'nextReviewOn', { type: 'date', hint: 'A date after today, in the business time zone.' })]

export function upkeepCard(actor: Actor, course: Course, manages: boolean, people: { value: string; label: string }[], names: Map<string, string>, zone: string) {
  const upkeep = course.upkeep, back = `/app/courses/${course.id}`
  const decides = actor.owner || (actor.roles.has('reviewer') && course.reviewer === actor.id)
  const settings = h`<p>Responsible owner: ${names.get(upkeep.responsible) ?? '—'} · fallback owner: ${upkeep.fallbackOwner ? names.get(upkeep.fallbackOwner) : 'none'} · next review: ${upkeep.nextReviewOn ?? 'not set'}.</p><p class="muted">Reminders now reach ${names.get(upkeep.reachesNow ?? '') ?? 'nobody'} as ${ROUTE[upkeep.route]}${upkeep.reason ? `: ${upkeep.reason}` : ''}.</p>`
  const edit = manages ? form('course.upkeep', back, [hidden('course', course.id), select('Fallback owner', 'fallbackOwner', people, upkeep.fallbackOwner ?? '', { required: false, blank: 'No fallback owner' }), field('Next review date', 'nextReviewOn', { type: 'date', value: upkeep.nextReviewOn ?? '', hint: 'A date after today, in the business time zone.' })], 'Save upkeep', { secondary: true }) : ''
  const open = upkeep.reviews.filter(review => review.state === 'open').map(review => h`<h3>Scheduled review due ${review.dueOn}</h3>${decides ? form('review.decide', back, [hidden('review', review.id), ...decisionFields()], 'Record decision') : h`<p class="muted">The named reviewer or the owner records the decision.</p>`}`)
  const decided = upkeep.reviews.filter(review => review.state !== 'open').map(review => ({ title: `Review due ${review.dueOn}: ${STATE[review.state]}`, meta: `${names.get(review.decidedBy) ?? ''}, ${when(review.decidedAt, zone)} · next review ${review.nextReviewOn} · ${review.note}` }))
  const mail = [
    ...upkeep.failures.map(failure => ({ title: `Not sent to ${names.get(failure.recipient) ?? 'someone'} (${ROUTE[failure.route]})`, meta: `${failure.outcome}: ${failure.failure ?? 'waiting'}` })),
    ...upkeep.messages.map(message => ({ title: `${message.itemKind === 'review' ? 'Review reminder' : 'Source notice'} ${message.status === 'accepted' ? 'accepted by the mail provider' : 'written to the development outbox (not delivered)'} for ${names.get(message.recipient)}`, meta: `${ROUTE[message.route]}${message.reason ? ` · ${message.reason}` : ''} · ${when(message.sentAt, zone)}` })),
  ]
  const replay = actor.owner && upkeep.failures.length ? form('upkeep.run', back, [], 'Send held mail now', { secondary: true }) : ''
  return card('Content upkeep', h`${settings}${edit}${open}${decided.length ? h`<h3>Decided reviews</h3>${rows(decided)}` : ''}${mail.length ? h`<h3>Reminder mail</h3>${rows(mail)}${replay}` : ''}`, { id: 'upkeep' })
}
