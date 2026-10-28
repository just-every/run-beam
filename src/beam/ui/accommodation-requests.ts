import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { accommodationRequests } from '../accommodation-requests'
import { card, field, form, h, hidden, select, rows, when } from './html'

export async function accommodationRequestCard(env: Bindings, actor: Actor, assignments: { id: string; courseTitle: string; status: string }[] = []) {
  if (actor.viewAs) return ''
  const requests = await accommodationRequests(env, actor)
  const scope = actor.owner ? 'Requests are visible only to the requester and you. Approvals grant the requested time for future attempts on this course; running quiz deadlines stay unchanged.' : 'Only you and the owner can read this request. Do not provide medical information. Extra time applies only after approval, to future attempts on the selected course; a running quiz keeps its deadline.'
  return card(actor.owner ? 'Extra-time requests' : 'Request extra time', h`<p>${scope}</p>${requests.length ? rows(requests.map(row => ({
    title: `${actor.owner ? row.learnerName + ' · ' : ''}${row.courseTitle}`,
    meta: `${row.amount}${row.kind === 'percent' ? '%' : ' minutes'} extra time · ${row.state} · ${when(row.requestedAt, actor.shell?.zone ?? 'UTC')}`,
    aside: actor.owner && row.state === 'pending' ? form('accommodation.decide', '/app/business', [hidden('request', row.id), select('Decision', 'decision', [{ value: 'approve', label: 'Approve requested extra time' }, { value: 'decline', label: 'Decline request' }])], 'Record decision') : '',
  }))) : h`<p class="muted">No requests.</p>`}${!actor.owner && assignments.some(row => row.status === 'open') ? form('accommodation.request', '/app/learning', [select('Course assignment', 'assignment', assignments.filter(row => row.status === 'open').map(row => ({ value: row.id, label: row.courseTitle }))), select('Extra-time kind', 'kind', [{ value: 'percent', label: 'Percentage of the time limit' }, { value: 'minutes', label: 'Minutes' }]), field('Requested amount', 'amount', { type: 'number', value: 50 })], 'Send extra-time request') : ''}`)
}
