// REPORT-001: the decision behind current imported credit, without issuing a Beam completion.
import type { Actor } from '../actor'
import type { Row } from '../core'
import { t } from '../messages'
import { formatDate, formatDay } from '../time'
import { card, h, pill, rows } from './html'

export function historyCredits(actor: Actor, credits: Row[], zone: string) {
  if (!credits.length) return ''
  return card(t(actor, 'History credits'), rows(credits.map(credit => ({
    title: h`${credit.courseTitle} · ${pill(credit.nativeCurrent ? 'completed' : credit.state, t(actor, credit.nativeCurrent ? 'Native completion applies' : credit.state))}`,
    meta: h`<strong>${t(actor, 'credited from {source} history', { source: credit.source })}</strong><br>${t(actor, 'Historical completion: {date}', { date: formatDay(credit.completedOn, actor.locale) })}<br>${t(actor, 'Credited until {date}', { date: formatDate(credit.expiresAt, zone, actor.locale) })}<br>${t(actor, 'Decision by {name} on {date}: {reason}', { name: credit.approvedByName, date: formatDate(credit.approvedAt, zone, actor.locale), reason: credit.reason })}`,
  }))))
}
