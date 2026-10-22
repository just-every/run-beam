import { supportedLanguage } from '../language'
import { t as translate, localeNumber, message } from '../messages'
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
  const zone = (await business(env))!.timezone, t = record.template, tr = (key: string, values = {}) => translate(actor, key, values)
  const created = url.searchParams.get('link')
  const document = h`<article class="card certificate"><p class="lockup"><img src="/brand/mark.svg" alt="" width="24" height="28">${branding.name}</p><p class="muted">${t.id ? t.heading : translate(actor, t.heading)} · ${record.current.number}</p><hr><h1>${record.current.learner}</h1><p>${t.id ? t.wording : translate(actor, t.wording)}</p><h2>${record.course}</h2><p class="muted">${translate(actor, 'revision')} ${localeNumber(actor, record.revision)} · ${translate(actor, METHODS[record.method] ?? record.method)}</p><p class="muted">${tr('on')} ${formatDate(record.completedAt, zone, actor.locale)}${record.expiresAt ? h` · ${tr('valid until')} ${formatDate(record.expiresAt, zone, actor.locale)}` : ''}</p>${t.signatoryName ? h`<p class="signatory">${t.signatoryName}, ${t.signatoryTitle}</p>` : ''}<hr><p class="issuer">${translate(actor, 'Issued by')} ${record.issuer}</p>${record.current.correctedAt ? h`<p class="muted">${tr('Corrected {date}; supersedes certificate {number}.', { date: formatDate(record.current.correctedAt, zone, actor.locale), number: record.number })}</p>` : ''}<p class="muted disclaimer">${translate(actor, 'This certificate records completion of the issuer’s own training. It is not an accreditation or a statement of competence.')}</p></article>
<p class="no-print"><a class="button" href="/app/certificates/${id}.pdf" download>${translate(actor, 'Download PDF')}</a></p>`
  const links = record.canLink || record.links.length ? card(tr('Verification link'), h`<p class="muted">${tr('Anyone with the link sees only: {fields}. Revoke it at any time.', { fields: t.verifyFields.map(field => tr(FIELD_LABELS[field]).toLocaleLowerCase(actor.locale)).join(', ') || tr('that the certificate exists') })}</p>
${created ? h`<p class="flash" role="status">${tr('Your new link (shown once):')} <a class="dashboard-link" href="/verify/${created}">${new URL(url.origin).origin}/verify/${created}</a></p>` : ''}
${record.links.length ? rows(record.links.map(link => ({ title: tr('Link created {date}', { date: when(link.createdAt, zone, zone, actor.locale) }), meta: link.revokedAt ? tr('revoked {date}', { date: when(link.revokedAt, zone, zone, actor.locale) }) : link.restoredAt ? tr('restored from an archive {date}: no longer works, create a new link', { date: when(link.restoredAt, zone, zone, actor.locale) }) : tr('active'), aside: link.revokedAt ? '' : form('certificate.unlink', `/app/certificates/${id}`, [hidden('link', link.id)], tr('Revoke'), { secondary: true }) }))) : ''}
${record.canLink ? form('certificate.link', `/app/certificates/${id}?link={id}`, [hidden('certificate', id)], tr('Create a verification link'), { secondary: true }) : ''}`, { id: 'links', className: 'no-print' }) : ''
  const lineage = record.corrections.length ? card(tr('Corrections'), rows([{ title: tr('Original {number}', { number: record.number }), meta: tr('issued to {name} {date}', { name: record.learner, date: formatDate(record.issuedAt, zone, actor.locale) }) }, ...record.corrections.map(item => ({ title: tr('Superseding {number}', { number: item.number }), meta: `${item.learnerName} · ${item.issuedBy}, ${formatDate(item.issuedAt, zone, actor.locale)}: ${item.reason}` }))]), { id: 'corrections', className: 'no-print' }) : ''
  const correct = record.canCorrect ? card('Correct this certificate', h`<p class="muted">Issues a superseding certificate with a new number and the corrected name; the original stays in the record.</p>${form('certificate.correct', `/app/certificates/${id}`, [hidden('certificate', id), field('Name as it should print', 'learnerName', { value: record.current.learner }), area('Reason', 'reason')], 'Issue a corrected certificate', { secondary: true })}`, { className: 'no-print' }) : ''
  return page(translate(actor, 'Certificate'), actor, h`${document}${links}${lineage}${correct}<p class="no-print muted print-note"><a href="/app/learning">← ${tr('My learning')}</a></p>`, { current: '/app/learning', url })
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
export async function verifyPage(env: Bindings, token: string, url?: URL) {
  const locale = supportedLanguage(url?.searchParams.get('lang')) ?? 'en-US'
  const tr = (key: string, values = {}) => message(locale, key, values)
  const language = h`<nav aria-label="${tr('Language')}"><a href="?lang=en-US" lang="en-US">English (US)</a> · <a href="?lang=es-US" lang="es-US">Español (EE. UU.)</a></nav>`
  const result = await verification(env, token)
  if (!result) return page(tr('Not found'), null, h`${language}<h1>${tr('No certificate at this link')}</h1><p>${tr('Check the link you were given.')}</p>`, { status: 404, locale })
  if (result.revoked) return page(tr('Link revoked'), null, h`${language}<h1>${tr('This link was revoked')}</h1><p>${tr('The certificate holder or their employer withdrew it. Ask the holder for a current link.')}</p>`, { status: 410, locale })
  return page(tr('Certificate verification'), null, h`${language}<h1>${tr('Certificate verified')}</h1><p class="muted">${tr('Issued in Beam. This page shows only what the issuer allows a link to show.')}</p>
${card(tr('Certificate'), h`<dl class="facts">${Object.entries(result.fields).map(([key, value]) => h`<dt>${tr(FIELD_LABELS[key])}</dt><dd>${key === 'expiresOn' && value === 'does not expire' ? tr(value) : value}</dd>`)}</dl>${result.corrected ? h`<p class="muted">${tr('Corrected {date}; this is the current certificate.', { date: result.corrected })}</p>` : ''}`)}
<p class="muted">${tr('This certificate records completion of the issuer’s own training. It is not an accreditation or a statement of competence.')}</p>`, { locale })
}
