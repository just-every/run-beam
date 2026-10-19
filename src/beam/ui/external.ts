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
const standingPill = (status: string) => pill(...STANDING[status])
const describe = (row: Row) => `${row.issuer} · no. ${row.number} · issued ${formatDay(row.issuedOn)}${row.expiresOn ? ` · expires ${formatDay(row.expiresOn)}` : ''}`
const STATE: Record<string, string> = { pending: 'waiting for review', approved: 'approved', rejected: 'rejected', replaced: 'replaced by a newer certificate' }

/** The certificate's own fields and its file; the file field offers the phone's camera. */
function uploadFields(requirement: { id: string; expires: boolean } | null) {
  const id = uid('file')
  return [requirement ? hidden('requirement', requirement.id) : '', field('Issued by', 'issuer'), field('Certificate number', 'number'), field('Issued on', 'issuedOn', { type: 'date' }),
    field('Expires on', 'expiresOn', { type: 'date', required: requirement?.expires ?? false }),
    h`<label for="${id}">Photo or PDF of the certificate</label><input id="${id}" type="file" name="file" accept="image/*,application/pdf" capture="environment" required>`]
}

export async function externalPage(env: Bindings, actor: Actor, url: URL) {
  const view = await externalView(env, actor)
  const zone = view.zone
  const expiry = (row: { status: string; expiresOn: string | null; renewalWaiting: boolean }) => row.status === 'renewal_due' ? `expires ${formatDay(row.expiresOn!)}${row.renewalWaiting ? '; renewed certificate waiting for review' : '; upload the renewed certificate'}` : `expired ${formatDay(row.expiresOn!)}${row.renewalWaiting ? '; renewed certificate waiting for review' : '; upload the renewed certificate'}`
  const reminders = view.reminders.length ? card('Renewal reminders', rows(view.reminders.map(row => ({ title: row.name, meta: expiry(row) }))), { id: 'external-reminders' }) : ''
  const mine = view.mine.map(row => card(row.requirement.name, h`<p>${standingPill(row.status)}</p>
${row.current ? h`<p>Counts as current, labelled external: ${describe(row.current)}. Approved by ${row.current.decidedBy}.</p>` : ''}
${row.pending ? h`<p>Waiting for review: ${describe(row.pending)}. Nothing counts until it is approved.</p>` : ''}
${row.rejected ? h`<p role="status"><strong>Rejected:</strong> your certificate ${row.rejected.number} was rejected by ${row.rejected.decidedBy} on ${formatDate(row.rejected.decidedAt, zone)}: ${row.rejected.reason}</p>` : ''}
${row.lapsed && !row.current ? h`<p>Your certificate ${row.lapsed.number} expired ${formatDay(row.lapsed.expiresOn)}; you are missing this requirement until a renewed one is approved.</p>` : ''}
<details${row.status === 'missing' ? raw(' open') : ''}><summary>Upload a certificate</summary>${form('external.upload', '/app/external', uploadFields(row.requirement), 'Upload for review', { multipart: true })}</details>
${row.history.length ? h`<h3>History</h3>${rows(row.history.map((item: Row) => ({ title: `${item.issuer} ${item.number}: ${STATE[item.state]}`, meta: h`uploaded ${formatDate(item.uploadedAt, zone)} by ${item.uploadedBy}${item.reason ? ` · ${item.reason}` : ''} · <a href="/app/files/external/${item.id}">File</a>` })))}` : ''}`, { id: `requirement-${row.requirement.id}` }))
  const review = view.review.length ? card('Waiting for your review', view.review.map(row => h`<section class="review-item"><h3>${row.learnerName}: ${row.requirementName}</h3><p>${describe(row)} · uploaded by ${row.uploadedBy} · <a href="/app/files/external/${row.id}">Open the file</a></p>
${form('external.decide', '/app/external', [hidden('certificate', row.id), hidden('decision', 'approve')], 'Approve')}
<details><summary>Reject</summary>${form('external.decide', '/app/external', [hidden('certificate', row.id), hidden('decision', 'reject'), area('Reason the person will see', 'reason')], 'Reject', { secondary: true })}</details></section>`), { id: 'external-review' }) : ''
  const renewals = view.renewals.length ? card('Renewals due for your people', rows(view.renewals.map(row => ({ title: `${row.learnerName}: ${row.name}`, meta: expiry(row), href: `/app/records/${row.learner}` }))), { id: 'external-renewals' }) : ''
  const people = view.people.length ? card('People and their certificates', h`${rows(view.people.map(row => ({ title: `${row.learnerName}: ${row.requirementName}`, meta: row.current ? describe(row.current) : row.pending ? 'waiting for review' : row.lapsed ? `expired ${formatDay(row.lapsed.expiresOn)}` : 'no certificate', aside: standingPill(row.status) })))}
<details><summary>Upload for a person</summary>${form('external.upload', '/app/external', [select('Person', 'learner', [...new Map(view.people.map(row => [row.learner, row.learnerName])).entries()].map(([value, label]) => ({ value, label }))), select('Requirement', 'requirement', view.requirements.map(item => ({ value: item.id, label: item.name }))), ...uploadFields(null)], 'Upload for review', { multipart: true })}</details>`, { id: 'external-people' }) : ''
  let define: unknown = ''
  if (actor.owner) {
    const [teams, assessors] = await Promise.all([all<{ id: string; name: string }>(env, 'SELECT id, name FROM beam_teams ORDER BY name'), all<{ id: string; name: string }>(env, "SELECT m.id, m.name FROM beam_members m JOIN beam_member_roles r ON r.member_id = m.id AND r.role = 'assessor' ORDER BY m.name")])
    const reviewer = (item: Row) => item.reviewerKind === 'assessor' ? `assessor ${item.reviewerName}` : item.reviewerKind === 'manager' ? 'the person’s managers' : 'learning administrators of the person’s units'
    define = card('Requirements', h`${view.requirements.length ? rows(view.requirements.map(item => ({ title: item.name, meta: `${item.teams.map(team => teams.find(row => row.id === team)?.name).join(', ')} · reviewed by ${reviewer(item)} · ${item.expires ? `reminder ${item.reminderDays} days before expiry` : 'no expiry'}` }))) : h`<p>No requirements yet.</p>`}
<details><summary>Define a requirement</summary>${form('external.requirement', '/app/external', [field('Name', 'name', { hint: 'For example “Food handler card, renew on expiry”' }), checks('Applies to teams', 'teams', teams.map(team => ({ value: team.id, label: team.name }))),
  select('Reviewed by', 'reviewer', [{ value: 'manager', label: 'The person’s managers' }, { value: 'administrator', label: 'Learning administrators of the person’s units' }, ...assessors.map(person => ({ value: person.id, label: `Assessor: ${person.name}`, group: 'A named assessor' }))]),
  field('Remind this many days before expiry', 'reminderDays', { type: 'number', value: 30 }), select('Certificates expire', 'expires', [{ value: 'yes', label: 'Yes, an expiry date is required' }, { value: 'no', label: 'No expiry' }], 'yes')], 'Define the requirement')}</details>`, { id: 'external-requirements' })
  }
  const empty = !view.mine.length && !review && !people && !define ? card('External certificates', h`<p>No certificate requirement applies to you.</p>`) : ''
  const body = h`<h1>External certificates</h1>
<p class="muted">Certificates earned outside Beam. A certificate counts only after its reviewer approves it, is labelled external in reports, and Beam issues no certificate of its own for it. Reminders show here and on My learning; they are not emailed.</p>
${reminders}${review}${mine}${renewals}${people}${define}${empty}`
  return page('External certificates', actor, body, { current: '/app/external', url })
}

/** My learning's card: renewal reminders and rejections, with the way to the page. */
export function externalCard(view: Awaited<ReturnType<typeof externalView>>) {
  const rejected = view.mine.filter(row => row.rejected)
  if (!view.reminders.length && !rejected.length && !view.review.length) return ''
  return card('External certificates', h`${rows([
    ...view.reminders.map(row => ({ title: row.name, meta: `${row.status === 'renewal_due' ? `Renewal due: expires ${formatDay(row.expiresOn)}` : `Expired ${formatDay(row.expiresOn)}`}${row.renewalWaiting ? '; renewed certificate waiting for review' : '; upload the renewed certificate'}`, href: '/app/external' })),
    ...rejected.map(row => ({ title: row.requirement.name, meta: `Rejected: ${row.rejected!.reason}`, href: '/app/external' })),
    ...(view.review.length ? [{ title: `${view.review.length} ${view.review.length === 1 ? 'certificate waits' : 'certificates wait'} for your review`, href: '/app/external' }] : []),
  ])}`, { id: 'external' })
}
