import { message } from '../messages'
import type { Language } from '../language'
// AUTO-009 on the pages: what a learner sees of an access window, the owner's
// window forms for a course, a path or one assignment, and a manager's extension.
import type { AccessRule, accessView } from '../access'
import { formatDate } from '../time'
import { area, card, field, form, h, hidden, select, when } from './html'

type Access = Awaited<ReturnType<typeof accessView>>

// A window closes at the start of the day after its last day; people read the last day.
const lastDay = (closesAt: number, zone: string, locale: Language = 'en-US') => formatDate(closesAt - 1, zone, locale)

/** The short line on My learning and the course page subtitle. */
export function accessNote(access: Pick<Access, 'state' | 'opensAt' | 'closesAt'>, zone: string, locale: Language = 'en-US') {
  const date = access.state === 'not_open' ? formatDate(access.opensAt!, zone, locale) : access.closesAt ? lastDay(access.closesAt, zone, locale) : ''
  return date ? message(locale, access.state === 'not_open' ? 'opens {date}' : access.state === 'ended' ? 'access ended {date}' : 'access through {date}', { date }) : ''
}

export function accessBanner(access: Access, zone: string, locale: Language = 'en-US') {
  if (access.state === 'not_open') return h`<p class="flash" role="status">${message(locale, 'This course opens on {date}. You can see it now and start it from that day.', { date: formatDate(access.opensAt!, zone, locale) })}</p>`
  if (access.state === 'ended') return h`<p class="flash" role="status">${message(locale, 'Access ended on {date}. Lessons and assessments are closed; your progress, results and certificates stay here. Your manager can extend access.', { date: lastDay(access.closesAt!, zone, locale) })}</p>`
  return ''
}

export const describeRule = (rule: AccessRule | null) => !rule ? 'No access window: open until completed.'
  : rule.kind === 'after_enrolment' ? `Closes ${rule.closeDays} ${rule.closeDays === 1 ? 'day' : 'days'} after enrolment.`
  : `Opens ${rule.openDate} and closes at the end of ${rule.closeDate} (${rule.timezone}).`

const KINDS = [{ value: 'none', label: 'No window' }, { value: 'after_enrolment', label: 'Close a number of days after enrolment' }, { value: 'dates', label: 'Open and close on fixed dates' }]

/** The owner's form for a course's, a path's or one assignment's window. */
export function windowForm(action: string, returnTo: string, targets: unknown[], rule: AccessRule | null, submit: string) {
  return form(action, returnTo, [...targets, select('Window', 'kind', KINDS, rule?.kind ?? 'none'),
    field('Days after enrolment', 'closeDays', { type: 'number', value: rule?.closeDays ?? '', required: false, hint: 'For a window that closes after enrolment.' }),
    field('Opens on', 'openDate', { type: 'date', value: rule?.openDate ?? '', required: false }),
    field('Closes after', 'closeDate', { type: 'date', value: rule?.closeDate ?? '', required: false, hint: 'Fixed dates are in the employer’s time zone.' })], submit, { secondary: true })
}

/** On an assignment, for managers: the window, its extensions and the forms that change it. */
export function accessCard(id: string, access: Access, zone: string, { owner, open }: { owner: boolean; open: boolean }) {
  const window = access.opensAt || access.closesAt ? h`<p>${access.opensAt ? `Opens ${formatDate(access.opensAt, zone)}. ` : ''}${access.closesAt ? `${access.state === 'ended' ? 'Ended' : 'Open through'} ${lastDay(access.closesAt, zone)}.` : ''}</p>` : h`<p>No access window.</p>`
  const extensions = access.extensions.length ? h`<ul>${access.extensions.map(row => h`<li>Extended ${row.days} ${row.days === 1 ? 'day' : 'days'} by ${row.extendedByName} ${when(row.extendedAt, zone)}: ${row.reason}</li>`)}</ul>` : ''
  const extend = open && access.closesAt ? form('access.extend', `/app/learn/${id}`, [hidden('assignment', id), field('Extend by (days)', 'days', { type: 'number', value: 7 }), area('Reason', 'reason')], 'Extend access', { secondary: true }) : ''
  const set = open && owner ? h`<details><summary>Set this assignment’s window</summary>${windowForm('assignment.window', `/app/learn/${id}`, [hidden('assignment', id)], access.rule, 'Save window')}</details>` : ''
  return card('Access window', h`${window}${extensions}${extend}${set}`)
}
