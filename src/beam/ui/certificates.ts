// LEARN-002 pages: a certificate with its PDF, verification links and corrections; the certificate templates page; and
// the public verification page a link opens.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { all, insist } from '../core'
import { certificateRecord, templates, verification, VERIFY_FIELDS } from '../certificates'
import { business } from '../people'
import { formatDate } from '../time'
import branding from '../../branding.json'
import { area, card, checks, field, form, h, hidden, page, rows, select, when } from './html'

const FIELD_LABELS: Record<string, string> = { learner: 'Name', course: 'Course', completedOn: 'Completed', expiresOn: 'Valid until', number: 'Certificate number', issuer: 'Issued by' }
const METHODS: Record<string, string> = { offline: 'attested offline training', assessed: 'lessons and assessment', lessons: 'lessons' }

export async function certificatePage(env: Bindings, actor: Actor, id: string, url: URL) {
  const record = await certificateRecord(env, actor, id)
  const zone = (await business(env))!.timezone, t = record.template
  const created = url.searchParams.get('link')
  const document = h`<article class="card certificate"><p class="lockup"><img src="/brand/mark.svg" alt="" width="24" height="28">${branding.name}</p><p class="muted">${t.heading} · ${record.current.number}</p><hr><h1>${record.current.learner}</h1><p>${t.wording}</p><h2>${record.course}</h2><p class="muted">revision ${record.revision} · ${METHODS[record.method] ?? record.method}</p><p class="muted">on ${formatDate(record.completedAt, zone)}${record.expiresAt ? h` · valid until ${formatDate(record.expiresAt, zone)}` : ''}</p>${t.signatoryName ? h`<p class="signatory">${t.signatoryName}, ${t.signatoryTitle}</p>` : ''}<hr><p class="issuer">Issued by ${record.issuer}</p>${record.current.correctedAt ? h`<p class="muted">Corrected ${formatDate(record.current.correctedAt, zone)}; supersedes certificate ${record.number}.</p>` : ''}<p class="muted disclaimer">This certificate records completion of the issuer’s own training. It is not an accreditation or a statement of competence.</p></article>
<p class="no-print"><a class="button" href="/app/certificates/${id}.pdf" download>Download PDF</a></p>`
  const links = record.canLink || record.links.length ? card('Verification link', h`<p class="muted">Anyone with the link sees only: ${t.verifyFields.map(field => FIELD_LABELS[field].toLowerCase()).join(', ') || 'that the certificate exists'}. Revoke it at any time.</p>
${created ? h`<p class="flash" role="status">Your new link (shown once): <a href="/verify/${created}">${new URL(url.origin).origin}/verify/${created}</a></p>` : ''}
${record.links.length ? rows(record.links.map(link => ({ title: `Link created ${when(link.createdAt, zone)}`, meta: link.revokedAt ? `revoked ${when(link.revokedAt, zone)}` : link.restoredAt ? `restored from an archive ${when(link.restoredAt, zone)}: no longer works, create a new link` : 'active', aside: link.revokedAt ? '' : form('certificate.unlink', `/app/certificates/${id}`, [hidden('link', link.id)], 'Revoke', { secondary: true }) }))) : ''}
${record.canLink ? form('certificate.link', `/app/certificates/${id}?link={id}`, [hidden('certificate', id)], 'Create a verification link', { secondary: true }) : ''}`, { id: 'links', className: 'no-print' }) : ''
  const lineage = record.corrections.length ? card('Corrections', rows([{ title: `Original ${record.number}`, meta: `issued to ${record.learner} ${formatDate(record.issuedAt, zone)}` }, ...record.corrections.map(item => ({ title: `Superseding ${item.number}`, meta: `${item.learnerName} · ${item.issuedBy}, ${formatDate(item.issuedAt, zone)}: ${item.reason}` }))]), { id: 'corrections', className: 'no-print' }) : ''
  const correct = record.canCorrect ? card('Correct this certificate', h`<p class="muted">Issues a superseding certificate with a new number and the corrected name; the original stays in the record.</p>${form('certificate.correct', `/app/certificates/${id}`, [hidden('certificate', id), field('Name as it should print', 'learnerName', { value: record.current.learner }), area('Reason', 'reason')], 'Issue a corrected certificate', { secondary: true })}`, { className: 'no-print' }) : ''
  return page('Certificate', actor, h`${document}${links}${lineage}${correct}<p class="no-print muted print-note"><a href="/app/learning">← My learning</a></p>`, { current: '/app/learning', url })
}

export async function templatesPage(env: Bindings, actor: Actor, url: URL) {
  insist(actor.owner || actor.grants.certificates, 'forbidden', 403)
  const [list, courses] = await Promise.all([templates(env), all<{ id: string; title: string; template: string | null }>(env, 'SELECT id, title, certificate_template_id AS template FROM beam_courses ORDER BY title')])
  const options = [{ value: '', label: 'Standard wording' }, ...list.map(item => ({ value: item.id, label: item.name }))]
  const body = h`<h1>Certificate templates</h1><p class="muted">A template is fixed once saved; to change one, save a new template and name it on the course. Certificates keep the template they were issued with.</p>
${card('Templates', list.length ? rows(list.map(item => ({ title: item.name, meta: `${item.heading} · “${item.wording}” · ${item.signatoryName}, ${item.signatoryTitle} · a verification link shows ${item.verifyFields.map(field => FIELD_LABELS[field].toLowerCase()).join(', ') || 'no fields'}` }))) : h`<p>No templates yet: certificates use Beam’s standard wording.</p>`)}
${card('New template', form('certificate.template', '/app/certificate-templates', [field('Template name', 'name'), field('Heading', 'heading', { value: 'Certificate of completion' }), area('Approved wording', 'wording', 'has completed'), field('Signatory name', 'signatoryName'), field('Signatory title', 'signatoryTitle'),
  checks('A verification link may show', 'verifyFields', VERIFY_FIELDS.map(value => ({ value, label: FIELD_LABELS[value] })), [...VERIFY_FIELDS])], 'Save the template'))}
${courses.length ? card('Template by course', rows(courses.map(course => ({ title: course.title, aside: form('course.certificate', '/app/certificate-templates', [hidden('course', course.id), select(`Template for ${course.title}`, 'template', options, course.template ?? '', { required: false })], 'Use', { secondary: true }) })))) : ''}`
  return page('Certificate templates', actor, body, { url })
}

/** The public page a verification link opens: approved fields only, or that the link was revoked. */
export async function verifyPage(env: Bindings, token: string) {
  const result = await verification(env, token)
  if (!result) return page('Not found', null, h`<h1>No certificate at this link</h1><p>Check the link you were given.</p>`, { status: 404 })
  if (result.revoked) return page('Link revoked', null, h`<h1>This link was revoked</h1><p>The certificate holder or their employer withdrew it. Ask the holder for a current link.</p>`, { status: 410 })
  return page('Certificate verification', null, h`<h1>Certificate verified</h1><p class="muted">Issued in Beam. This page shows only what the issuer allows a link to show.</p>
${card('Certificate', h`<dl class="facts">${Object.entries(result.fields).map(([key, value]) => h`<dt>${FIELD_LABELS[key]}</dt><dd>${value}</dd>`)}</dl>${result.corrected ? h`<p class="muted">Corrected ${result.corrected}; this is the current certificate.</p>` : ''}`)}
<p class="muted">This certificate records completion of the issuer’s own training. It is not an accreditation or a statement of competence.</p>`)
}
