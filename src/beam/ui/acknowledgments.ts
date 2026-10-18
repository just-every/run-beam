// Policy acknowledgment pages (LEARN-010): the person's own requirement, the
// manager's request form and status list on Sources, and My learning's card.
import type { Bindings } from '../../auth.server'
import { isManager, type Actor } from '../actor'
import { acknowledgmentView, type Acknowledgment } from '../acknowledgments'
import { business } from '../people'
import { area, backLink, card, checks, field, form, h, hidden, page, rows, select, when, type Html } from './html'

const STATE: Record<string, string> = { open: 'waiting', signed: 'signed', declined: 'declined' }
export const ackLabel = (item: Acknowledgment) => `${item.kind === 'signature' ? 'Signature' : 'Acknowledgment'} · version ${item.versionNumber} · ${item.state === 'signed' && item.kind === 'acknowledgment' ? 'acknowledged' : STATE[item.state]}`

export async function acknowledgmentPage(env: Bindings, actor: Actor, id: string, url: URL) {
  const item = await acknowledgmentView(env, actor, id)
  const zone = (await business(env))!.timezone
  const own = item.learner === actor.id
  const back = `/app/acknowledgments/${id}`
  const decide = own && item.state === 'open'
    ? h`${item.viewedAt
        ? card(item.kind === 'signature' ? 'Sign' : 'Acknowledge', form('acknowledgment.decide', back, [hidden('acknowledgment', id), hidden('decision', 'sign'), h`<label class="check"><input type="checkbox" name="agree" value="yes" required> ${item.intent}</label>`, item.kind === 'signature' ? field('Type your full name to sign', 'signature', { hint: `As it appears in Beam: ${actor.name}` }) : ''], item.kind === 'signature' ? 'Sign' : 'Acknowledge'))
        : card('Open the document first', h`<p>Open and read the document above; then you can ${item.kind === 'signature' ? 'sign' : 'acknowledge'} it here.</p>`)}
      ${card('Decline', form('acknowledgment.decide', back, [hidden('acknowledgment', id), hidden('decision', 'decline'), area('Why you are declining', 'reason')], 'Decline', { secondary: true }))}`
    : ''
  const decided = item.state !== 'open' ? card('Decision', h`<p>${item.state === 'signed' ? (item.kind === 'signature' ? h`Signed “${item.signature}”` : 'Acknowledged') : h`Declined: ${item.declineReason}`} ${when(item.decidedAt, zone)} by ${item.learnerName}, signed in by ${item.identityMethod}.</p>${item.state === 'signed' ? h`<p class="muted">${item.intent}</p>` : ''}<p><a href="/app/acknowledgments/${id}/evidence">Download the evidence</a></p>`) : ''
  const body = h`${backLink(own ? '/app/learning' : '/app/sources', own ? 'My learning' : 'Sources')}<h1>${item.sourceTitle}</h1>
<p class="subtitle">${ackLabel(item)}${own ? '' : ` · ${item.learnerName}`} · asked by ${item.requestedByName} ${when(item.requestedAt, zone)}</p>
<div class="narrow">${card('Document', h`<p><a href="/app/acknowledgments/${id}/document">Open ${item.document.filename}</a> (version ${item.versionNumber})${item.viewedAt ? h` · opened ${when(item.viewedAt, zone)}` : ''}</p><p class="muted">SHA-256 ${item.document.sha256}</p><p class="muted">An acknowledgment is a record of reading a policy; it does not complete any training.</p>`)}
${decide}${decided}</div>`
  return page(item.sourceTitle, actor, body, { current: own ? '/app/learning' : '/app/sources', url })
}

/** Sources page: ask people about the latest version and see every requirement for this source. */
export function sourceAcknowledgments(actor: Actor, sourceId: string, items: Acknowledgment[], people: { value: string; label: string }[], teams: { value: string; label: string }[], zone: string): Html {
  if (!isManager(actor)) return h``
  const mine = items.filter(item => item.source === sourceId)
  return h`<details><summary>Acknowledgments and signatures${mine.length ? ` (${mine.length})` : ''}</summary>${mine.length ? rows(mine.map(item => ({ title: h`<a href="/app/acknowledgments/${item.id}">${item.learnerName}</a>`, meta: `${ackLabel(item)}${item.decidedAt ? ` ${when(item.decidedAt, zone)}` : ''}` }))) : ''}
${form('acknowledgment.request', '/app/sources', [hidden('source', sourceId), select('Ask for', 'kind', [{ value: 'acknowledgment', label: 'An acknowledgment of the latest version' }, { value: 'signature', label: 'An electronic signature on the latest version' }]), checks('People', 'learners', people, [], { scroll: true }), checks('Teams', 'teams', teams)], 'Ask')}</details>`
}

export const acknowledgmentCard = (items: Acknowledgment[]) => {
  const open = items.filter(item => item.state === 'open')
  return open.length ? card('Policies to acknowledge', rows(open.map(item => ({ title: item.sourceTitle, meta: ackLabel(item), href: `/app/acknowledgments/${item.id}` }))), { id: 'acknowledgments' }) : ''
}
