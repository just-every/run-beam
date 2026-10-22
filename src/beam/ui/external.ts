import { t, message, localeNumber } from '../messages'
import type { Language } from '../language'
// LIB-006: External certificates. A learner sees each requirement that applies to them with its standing, uploads a
// photo or PDF of the certificate (a phone camera opens straight from the file field), and reads why one was rejected.
// Reviewers decide waiting certificates; managers see renewals due for their people and upload for them; the owner
// defines requirements.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { all, type Row } from '../core'
import { externalView } from '../external'
import { formatDate, formatDay } from '../time'
import { area, card, checks, field, form, h, hidden, page, pill, raw, rows, select, uid } from './html'

const STANDING: Record<string, [string, string]> = { current: ['completed', 'Current'], renewal_due: ['expiring', 'Renewal due'], pending: ['open', 'Waiting for review'], missing: ['overdue', 'Missing'] }
const standingPill = (status: string, locale: Language = 'en-US') => pill(STANDING[status][0], message(locale, STANDING[status][1]))
const describe = (row: Row, locale: Language = 'en-US') => message(locale, '{issuer} · no. {number} · issued {date}', { issuer: row.issuer, number: row.number, date: formatDay(row.issuedOn, locale) }) + (row.expiresOn ? message(locale, ' · expires {date}', { date: formatDay(row.expiresOn, locale) }) : '')
const STATE: Record<string, string> = { pending: 'waiting for review', approved: 'approved', rejected: 'rejected', replaced: 'replaced by a newer certificate' }

/** The certificate's own fields and its file; the file field offers the phone's camera. */
function uploadFields(requirement: { id: string; expires: boolean } | null, locale: Language = 'en-US') {
  const id = uid('file'), tr = (key: string) => message(locale, key)
  return [requirement ? hidden('requirement', requirement.id) : '', field(tr('Issued by'), 'issuer'), field(tr('Certificate number'), 'number'), field(tr('Issued on'), 'issuedOn', { type: 'date' }),
    field(tr('Expires on'), 'expiresOn', { type: 'date', required: requirement?.expires ?? false }),
    h`<label for="${id}">${tr('Photo or PDF of the certificate')}</label><input id="${id}" type="file" name="file" accept="image/*,application/pdf" capture="environment" required>`]
}

export async function externalPage(env: Bindings, actor: Actor, url: URL) {
  const view = await externalView(env, actor)
  const zone = view.zone
  const expiry = (row: { status: string; expiresOn: string | null; renewalWaiting: boolean }) => row.status === 'renewal_due' ? `${t(actor, 'expires {date}', { date: formatDay(row.expiresOn!, actor.locale) })}${row.renewalWaiting ? t(actor, '; renewed certificate waiting for review') : t(actor, '; upload the renewed certificate')}` : `${t(actor, 'expired {date}', { date: formatDay(row.expiresOn!, actor.locale) })}${row.renewalWaiting ? t(actor, '; renewed certificate waiting for review') : t(actor, '; upload the renewed certificate')}`
  const reminders = view.reminders.length ? card(t(actor, 'Renewal reminders'), rows(view.reminders.map(row => ({ title: row.name, meta: expiry(row) }))), { id: 'external-reminders' }) : ''
  const mine = view.mine.map(row => card(row.requirement.name, h`<p>${standingPill(row.status, actor.locale)}</p>
${row.current ? h`<p>${t(actor, 'Counts as current, labelled external: {certificate}. Approved by {name}.', { certificate: describe(row.current, actor.locale), name: row.current.decidedBy })}</p>` : ''}
${row.pending ? h`<p>${t(actor, 'Waiting for review: {certificate}. Nothing counts until it is approved.', { certificate: describe(row.pending, actor.locale) })}</p>` : ''}
${row.rejected ? h`<p role="status"><strong>${t(actor, 'Rejected:')}</strong> ${t(actor, 'your certificate {number} was rejected by {name} on {date}: {reason}', { number: row.rejected.number, name: row.rejected.decidedBy, date: formatDate(row.rejected.decidedAt, zone, actor.locale), reason: row.rejected.reason })}</p>` : ''}
${row.lapsed && !row.current ? h`<p>${t(actor, 'Your certificate {number} expired {date}; you are missing this requirement until a renewed one is approved.', { number: row.lapsed.number, date: formatDay(row.lapsed.expiresOn, actor.locale), })}</p>` : ''}
<details${row.status === 'missing' ? raw(' open') : ''}><summary>${t(actor, 'Upload a certificate')}</summary>${form('external.upload', '/app/external', uploadFields(row.requirement, actor.locale), t(actor, 'Upload for review'), { multipart: true })}</details>
${row.history.length ? h`<h3>${t(actor, 'History')}</h3>${rows(row.history.map((item: Row) => ({ title: `${item.issuer} ${item.number}: ${t(actor, STATE[item.state])}`, meta: h`${t(actor, 'uploaded {date} by {name}', { date: formatDate(item.uploadedAt, zone, actor.locale), name: item.uploadedBy })}${item.reason ? ` · ${item.reason}` : ''} · <a href="/app/files/external/${item.id}">${t(actor, 'File')}</a>` })))}` : ''}`, { id: `requirement-${row.requirement.id}` }))
  const review = view.review.length ? card('Waiting for your review', view.review.map(row => h`<section class="review-item"><h3>${row.learnerName}: ${row.requirementName}</h3><p>${describe(row, actor.locale)} · uploaded by ${row.uploadedBy} · <a href="/app/files/external/${row.id}">Open the file</a></p>
${form('external.decide', '/app/external', [hidden('certificate', row.id), hidden('decision', 'approve')], 'Approve')}
<details><summary>Reject</summary>${form('external.decide', '/app/external', [hidden('certificate', row.id), hidden('decision', 'reject'), area('Reason the person will see', 'reason')], 'Reject', { secondary: true })}</details></section>`), { id: 'external-review' }) : ''
  const renewals = view.renewals.length ? card('Renewals due for your people', rows(view.renewals.map(row => ({ title: `${row.learnerName}: ${row.name}`, meta: expiry(row), href: `/app/records/${row.learner}` }))), { id: 'external-renewals' }) : ''
  const people = view.people.length ? card('People and their certificates', h`${rows(view.people.map(row => ({ title: `${row.learnerName}: ${row.requirementName}`, meta: row.current ? describe(row.current, actor.locale) : row.pending ? t(actor, 'waiting for review') : row.lapsed ? `expired ${formatDay(row.lapsed.expiresOn)}` : 'no certificate', aside: standingPill(row.status, actor.locale) })))}
<details><summary>Upload for a person</summary>${form('external.upload', '/app/external', [select('Person', 'learner', [...new Map(view.people.map(row => [row.learner, row.learnerName])).entries()].map(([value, label]) => ({ value, label }))), select('Requirement', 'requirement', view.requirements.map(item => ({ value: item.id, label: item.name }))), ...uploadFields(null, actor.locale)], t(actor, 'Upload for review'), { multipart: true })}</details>`, { id: 'external-people' }) : ''
  let define: unknown = ''
  if (actor.owner) {
    const [teams, assessors, audiences] = await Promise.all([all<{ id: string; name: string }>(env, 'SELECT id, name FROM beam_teams ORDER BY name'), all<{ id: string; name: string }>(env, "SELECT m.id, m.name FROM beam_members m JOIN beam_member_roles r ON r.member_id = m.id AND r.role = 'assessor' ORDER BY m.name"), all<{ id: string; name: string }>(env, 'SELECT id, name FROM beam_audiences ORDER BY name')])
    const reviewer = (item: Row) => item.reviewerKind === 'assessor' ? `assessor ${item.reviewerName}` : item.reviewerKind === 'manager' ? 'the person’s managers' : 'learning administrators of the person’s units'
    define = card('Requirements', h`${view.requirements.length ? rows(view.requirements.map(item => ({ title: item.name, meta: `${[...item.teams.map(team => teams.find(row => row.id === team)?.name), ...item.audiences.map(id => `audience ${audiences.find(row => row.id === id)?.name}`)].join(', ')} · reviewed by ${reviewer(item)} · ${item.expires ? `reminder ${item.reminderDays} days before expiry` : 'no expiry'}` }))) : h`<p>No requirements yet.</p>`}
<details><summary>Define a requirement</summary>${form('external.requirement', '/app/external', [field('Name', 'name', { hint: 'For example “Food handler card, renew on expiry”' }), checks('Applies to teams', 'teams', teams.map(team => ({ value: team.id, label: team.name }))), audiences.length ? checks('And to audiences (Automation)', 'audiences', audiences.map(item => ({ value: item.id, label: item.name }))) : '',
  select('Reviewed by', 'reviewer', [{ value: 'manager', label: 'The person’s managers' }, { value: 'administrator', label: 'Learning administrators of the person’s units' }, ...assessors.map(person => ({ value: person.id, label: `Assessor: ${person.name}`, group: 'A named assessor' }))]),
  field('Remind this many days before expiry', 'reminderDays', { type: 'number', value: 30 }), select('Certificates expire', 'expires', [{ value: 'yes', label: 'Yes, an expiry date is required' }, { value: 'no', label: 'No expiry' }], 'yes')], 'Define the requirement')}</details>`, { id: 'external-requirements' })
  }
  const empty = !view.mine.length && !review && !people && !define ? card(t(actor, 'External certificates'), h`<p>${t(actor, 'No certificate requirement applies to you.')}</p>`) : ''
  const body = h`<h1>${t(actor, 'External certificates')}</h1>
<p class="muted">${t(actor, 'Certificates earned outside Beam. A certificate counts only after its reviewer approves it, is labelled external in reports, and Beam issues no certificate of its own for it. Reminders show here and on My learning; they are not emailed.')}</p>
${reminders}${review}${mine}${renewals}${people}${define}${empty}`
  return page(t(actor, 'External certificates'), actor, body, { current: '/app/external', url })
}

/** My learning's card: renewal reminders and rejections, with the way to the page. */
export function externalCard(view: Awaited<ReturnType<typeof externalView>>, actor: Actor) {
  const rejected = view.mine.filter(row => row.rejected)
  if (!view.reminders.length && !rejected.length && !view.review.length) return ''
  return card(t(actor, 'External certificates'), h`${rows([
    ...view.reminders.map(row => ({ title: row.name, meta: `${row.status === 'renewal_due' ? t(actor, 'Renewal due: expires {date}', { date: formatDay(row.expiresOn, actor.locale) }) : t(actor, 'Expired {date}', { date: formatDay(row.expiresOn, actor.locale) })}${row.renewalWaiting ? t(actor, '; renewed certificate waiting for review') : t(actor, '; upload the renewed certificate')}`, href: '/app/external' })),
    ...rejected.map(row => ({ title: row.requirement.name, meta: t(actor, 'Rejected: {reason}', { reason: row.rejected!.reason }), href: '/app/external' })),
    ...(view.review.length ? [{ title: t(actor, '{n} certificates wait for your review', { n: localeNumber(actor, view.review.length) }), href: '/app/external' }] : []),
  ])}`, { id: 'external' })
}
