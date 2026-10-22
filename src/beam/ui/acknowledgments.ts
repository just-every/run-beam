import { t, message } from '../messages'
import type { Language } from '../language'
// Policy acknowledgment pages (LEARN-010): the person's own requirement, the
// manager's request form and status list on Sources, and My learning's card.
import type { Bindings } from '../../auth.server'
import { isManager, type Actor } from '../actor'
import { acknowledgmentView, type Acknowledgment } from '../acknowledgments'
import { business } from '../people'
import { area, backLink, card, checks, field, form, h, hidden, page, rows, select, when, type Html } from './html'

const STATE: Record<string, string> = { open: 'waiting', signed: 'signed', declined: 'declined' }
export const ackLabel = (item: Acknowledgment, locale: Language = 'en-US') => `${message(locale, item.kind === 'signature' ? 'Signature' : 'Acknowledgment')} · ${message(locale, 'version')} ${new Intl.NumberFormat(locale).format(item.versionNumber)} · ${message(locale, item.state === 'signed' && item.kind === 'acknowledgment' ? 'acknowledged' : STATE[item.state])}`

export async function acknowledgmentPage(env: Bindings, actor: Actor, id: string, url: URL) {
  const item = await acknowledgmentView(env, actor, id)
  const zone = (await business(env))!.timezone, tr = (key: string, values = {}) => t(actor, key, values)
  const at = (value: number | null) => when(value, zone, zone, actor.locale)
  const own = item.learner === actor.id, back = `/app/acknowledgments/${id}`
  const decide = own && item.state === 'open'
    ? h`${item.viewedAt
        ? card(tr(item.kind === 'signature' ? 'Sign' : 'Acknowledge'), form('acknowledgment.decide', back, [hidden('acknowledgment', id), hidden('decision', 'sign'), hidden('intentLocale', item.intentLocale), hidden('intent', item.intent), h`<label class="check"><input type="checkbox" name="agree" value="yes" required> ${item.intent}</label>`, item.kind === 'signature' ? field(tr('Type your full name to sign'), 'signature', { hint: tr('As it appears in Beam: {name}', { name: actor.name }) }) : ''], tr(item.kind === 'signature' ? 'Sign' : 'Acknowledge')))
        : card(tr('Open the document first'), h`<p>${tr(item.kind === 'signature' ? 'Open and read the document above; then you can sign it here.' : 'Open and read the document above; then you can acknowledge it here.')}</p>`)}
      ${card(tr('Decline'), form('acknowledgment.decide', back, [hidden('acknowledgment', id), hidden('decision', 'decline'), area(tr('Why you are declining'), 'reason')], tr('Decline'), { secondary: true }))}`
    : ''
  const decided = item.state !== 'open' ? card(tr('Decision'), h`<p>${item.state === 'signed' ? (item.kind === 'signature' ? tr('Signed “{name}”', { name: item.signature! }) : tr('Acknowledged')) : tr('Declined: {reason}', { reason: item.declineReason! })} ${tr('{date} by {name}, signed in by {method}.', { date: at(item.decidedAt), name: item.learnerName, method: tr(item.identityMethod ?? '') })}</p>${item.state === 'signed' ? h`<p class="muted">${item.intent}</p>` : ''}<p><a href="/app/acknowledgments/${id}/evidence">${tr('Download the evidence')}</a></p>`) : ''
  const body = h`${backLink(own ? '/app/learning' : '/app/sources', tr(own ? 'My learning' : 'Sources'))}<h1>${item.sourceTitle}</h1>
<p class="subtitle">${ackLabel(item, actor.locale)}${own ? '' : ` · ${item.learnerName}`} · ${tr('asked by {name} {date}', { name: item.requestedByName, date: at(item.requestedAt) })}</p>
<div class="narrow">${card(tr('Document'), h`<p><a href="/app/acknowledgments/${id}/document">${tr('Open {title}', { title: item.document.filename })}</a> (${tr('version')} ${new Intl.NumberFormat(actor.locale).format(item.versionNumber)})${item.viewedAt ? ` · ${tr('opened {date}', { date: at(item.viewedAt) })}` : ''}</p><p class="muted dashboard-link">SHA-256 ${item.document.sha256}</p><p class="muted">${tr('An acknowledgment is a record of reading a policy; it does not complete any training.')}</p>`)}
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

export const acknowledgmentCard = (items: Acknowledgment[], locale: Language = 'en-US') => {
  const open = items.filter(item => item.state === 'open')
  return open.length ? card(message(locale, 'Policies to acknowledge'), rows(open.map(item => ({ title: item.sourceTitle, meta: ackLabel(item, locale), href: `/app/acknowledgments/${item.id}` }))), { id: 'acknowledgments' }) : ''
}
