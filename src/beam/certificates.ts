import { portalTheme } from './portal-theme'
import { message } from './messages'
import type { Language } from './language'
// LEARN-002: certificate templates, PDFs, verification links and corrections. The owner (or a custom role with the
// certificates permission) saves immutable templates (heading, approved wording, signatory, and the fields a
// verification link may reveal) and names a course's template; each certificate keeps the template it was issued with
// (none: Beam's standard wording, and a link reveals every verifiable field). The learner creates a revocable link for
// their own certificate; the learner, the owner and the person's managers revoke it. A correction
// issues a superseding certificate with its own number and the corrected printed name, and keeps the original.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { all, commit, insist, newId, now, one, sha256Hex, stmt, type Row } from './core'
import type { Input } from './input'
import { certificate } from './records'
import { requireBusiness } from './people'
import { certificatePdf, type PdfLine } from './pdf'
import { formatDate } from './time'
import branding from '../branding.json'

export const VERIFY_FIELDS = ['learner', 'course', 'completedOn', 'expiresOn', 'number', 'issuer'] as const
const STANDARD = { heading: 'Certificate of completion', wording: 'has completed', signatoryName: '', signatoryTitle: '', verifyFields: [...VERIFY_FIELDS] as string[] }

const designs = (actor: Actor) => actor.owner || !!actor.grants.certificates

export async function templates(env: Bindings) {
  return (await all(env, 'SELECT * FROM beam_certificate_templates ORDER BY name')).map(row => ({ id: row.id, name: row.name, heading: row.heading, wording: row.wording, signatoryName: row.signatory_name, signatoryTitle: row.signatory_title, verifyFields: JSON.parse(row.verify_fields) as string[] }))
}

export async function saveTemplate(env: Bindings, actor: Actor, input: Input) {
  insist(designs(actor), 'forbidden', 403)
  const name = input.text('name', { max: 120 })
  insist(!await one(env, 'SELECT 1 FROM beam_certificate_templates WHERE name = ?', name), 'template_exists', 409)
  const verifyFields = [...new Set(input.list('verifyFields'))]
  insist(verifyFields.every(field => (VERIFY_FIELDS as readonly string[]).includes(field)), 'invalid_verify_fields')
  const template = { heading: input.text('heading', { max: 120 }), wording: input.text('wording', { max: 600 }), signatoryName: input.text('signatoryName', { max: 120 }), signatoryTitle: input.text('signatoryTitle', { max: 120 }) }
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_certificate_templates (id, name, heading, wording, signatory_name, signatory_title, verify_fields, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, name, template.heading, template.wording, template.signatoryName, template.signatoryTitle, JSON.stringify(verifyFields), actor.id, now())], { actor, action: 'certificate.template', subject: id, detail: { name, ...template, verifyFields } })
  return { id }
}

/** Names the template a course's future certificates use ('' for Beam's standard wording); issued ones keep theirs. */
export async function setCourseTemplate(env: Bindings, actor: Actor, input: Input) {
  insist(designs(actor), 'forbidden', 403)
  const course = input.text('course', { max: 100 }), template = input.text('template', { optional: true, max: 100 }) || null
  insist(await one(env, 'SELECT 1 FROM beam_courses WHERE id = ?', course), 'course_not_found', 404)
  if (template) insist(await one(env, 'SELECT 1 FROM beam_certificate_templates WHERE id = ?', template), 'template_not_found', 404)
  await commit(env, [stmt(env, 'UPDATE beam_courses SET certificate_template_id = ? WHERE id = ?', template, course)], { actor, action: 'course.certificate', subject: course, detail: { template } })
  return { id: course }
}

/** The certificate as issued and as it stands now: its template, every correction (newest last) and its links. */
export async function certificateRecord(env: Bindings, actor: Actor, id: string) {
  const base = await certificate(env, actor, id)
  const row = (await one(env, 'SELECT k.template_id, c.learner_id FROM beam_certificates k JOIN beam_completions c ON c.id = k.completion_id WHERE k.id = ?', id))!
  const template = row.template_id ? (await templates(env)).find(item => item.id === row.template_id)! : null
  const corrections = await all(env, 'SELECT x.id, x.number, x.learner_name AS learnerName, x.reason, x.issued_at AS issuedAt, m.name AS issuedBy FROM beam_certificate_corrections x JOIN beam_members m ON m.id = x.issued_by WHERE x.certificate_id = ? ORDER BY x.issued_at, x.rowid', id)
  const latest = corrections.at(-1)
  const own = row.learner_id === actor.id
  const links = own || await revokes(env, actor, row.learner_id) ? await all(env, 'SELECT id, created_at AS createdAt, revoked_at AS revokedAt, restored_at AS restoredAt FROM beam_certificate_links WHERE certificate_id = ? ORDER BY created_at', id) : []
  return { ...base, learnerId: row.learner_id, template: template ?? { id: null, name: 'Standard', ...STANDARD }, corrections, current: { number: latest?.number ?? base.number, learner: latest?.learnerName ?? base.learner, correctedAt: latest?.issuedAt ?? null }, links, canLink: own && !actor.viewAs, canCorrect: corrects(actor, row.learner_id) }
}

const corrects = (actor: Actor, learner: string) => !actor.agent && (actor.owner || !!actor.grants.certificates?.learners.includes(learner))
/** The owner and the person's own managers (teams they manage) revoke a person's links. */
const revokes = async (env: Bindings, actor: Actor, learner: string) => !actor.agent && (actor.owner || !!await one(env, 'SELECT 1 FROM beam_team_members WHERE member_id = ? AND team_id IN (SELECT value FROM json_each(?))', learner, JSON.stringify(actor.managedTeams)))

/** A superseding certificate with a corrected printed name; the original stays as issued. */
export async function correctCertificate(env: Bindings, actor: Actor, input: Input) {
  const record = await certificateRecord(env, actor, input.text('certificate', { max: 100 }))
  insist(record.canCorrect, 'forbidden', 403)
  const learnerName = input.text('learnerName', { max: 160 }), reason = input.text('reason', { max: 500 })
  const id = newId(), number = `${new Date().getUTCFullYear()}-${id.slice(0, 8).toUpperCase()}`
  await commit(env, [stmt(env, 'INSERT INTO beam_certificate_corrections (id, certificate_id, number, learner_name, reason, issued_by, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, record.id, number, learnerName, reason, actor.id, now())],
    { actor, action: 'certificate.correct', subject: record.id, detail: { supersededBy: number, previous: record.current.number, learnerName, reason } })
  return { id: record.id, number }
}

/** The learner's own revocable verification link. The token is returned once and stored only as its hash. */
export async function createLink(env: Bindings, actor: Actor, input: Input) {
  const record = await certificateRecord(env, actor, input.text('certificate', { max: 100 }))
  insist(record.canLink, 'own_certificate_only', 403)
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_certificate_links (id, certificate_id, token_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?)', id, record.id, await sha256Hex(new TextEncoder().encode(token)), actor.id, now())],
    { actor, action: 'certificate.link', subject: record.id, detail: { link: id } })
  return { id: token, link: id, path: `/verify/${token}` }
}

export async function revokeLink(env: Bindings, actor: Actor, input: Input) {
  const link = await one(env, 'SELECT l.id, l.certificate_id, l.revoked_at, c.learner_id FROM beam_certificate_links l JOIN beam_certificates k ON k.id = l.certificate_id JOIN beam_completions c ON c.id = k.completion_id WHERE l.id = ?', input.text('link', { max: 100 }))
  insist(link && (link.learner_id === actor.id || await revokes(env, actor, link.learner_id)), 'not_found', 404)
  insist(!actor.viewAs, 'view_as_read_only', 403)
  if (link.revoked_at) return { id: link.certificate_id, revoked: true }
  await commit(env, [stmt(env, 'UPDATE beam_certificate_links SET revoked_by = ?, revoked_at = ? WHERE id = ? AND revoked_at IS NULL', actor.id, now(), link.id)], { actor, action: 'certificate.unlink', subject: link.certificate_id, detail: { link: link.id } })
  return { id: link.certificate_id, revoked: true }
}

/** What a visitor with the link sees: only the fields the certificate's template approves, as the certificate stands
 * now, or that the link was revoked. Null when no link has this token. OPS-007: a link an installation restore brought
 * back never verifies again (its archive carried no token hash); the holder creates a new link. */
export async function verification(env: Bindings, token: string, locale: Language = 'en-US') {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null
  const link = await one(env, `SELECT l.revoked_at, l.restored_at, k.id, k.number, k.issuer, k.template_id, c.completed_at, c.expires_at, r.title, m.name FROM beam_certificate_links l JOIN beam_certificates k ON k.id = l.certificate_id
    JOIN beam_completions c ON c.id = k.completion_id JOIN beam_course_revisions r ON r.id = c.course_revision_id JOIN beam_members m ON m.id = c.learner_id WHERE l.token_hash = ?`, await sha256Hex(new TextEncoder().encode(token)))
  if (!link || link.restored_at) return null
  if (link.revoked_at) return { revoked: true as const }
  const fields = link.template_id ? JSON.parse((await one(env, 'SELECT verify_fields FROM beam_certificate_templates WHERE id = ?', link.template_id))!.verify_fields) as string[] : STANDARD.verifyFields
  const latest = await one(env, 'SELECT number, learner_name, issued_at FROM beam_certificate_corrections WHERE certificate_id = ? ORDER BY issued_at DESC, rowid DESC LIMIT 1', link.id)
  const zone = (await requireBusiness(env)).timezone
  const values: Row = { learner: latest?.learner_name ?? link.name, course: link.title, completedOn: formatDate(link.completed_at, zone, locale), expiresOn: link.expires_at ? formatDate(link.expires_at, zone, locale) : 'does not expire', number: latest?.number ?? link.number, issuer: link.issuer }
  return { revoked: false as const, corrected: latest ? formatDate(latest.issued_at, zone, locale) : null, fields: Object.fromEntries(VERIFY_FIELDS.filter(field => fields.includes(field)).map(field => [field, values[field]])) as Record<string, string> }
}

/** The certificate as an accessible PDF download, as it stands now. */
export async function certificatePdfResponse(env: Bindings, actor: Actor, id: string) {
  const record = await certificateRecord(env, actor, id)
  const zone = (await requireBusiness(env)).timezone, t = record.template, tr = (key: string) => message(actor.locale, key)
  const lines: PdfLine[] = [
    { text: record.issuer, size: 16, bold: true, tag: 'P' },
    { text: t.id ? t.heading : tr(t.heading), size: 30, bold: true, tag: 'H1', gapBefore: 18 },
    { text: record.current.learner, size: 26, bold: true, tag: 'H2', gapBefore: 24 },
    { text: t.id ? t.wording : tr(t.wording), size: 14, tag: 'P', gapBefore: 6 },
    { text: `${record.course} (${tr('revision')} ${record.revision})`, size: 20, bold: true, tag: 'P', gapBefore: 6 },
    { text: `${tr('Completed')} ${formatDate(record.completedAt, zone, actor.locale)}${record.expiresAt ? ` · ${tr('valid until')} ${formatDate(record.expiresAt, zone, actor.locale)}` : ''}`, size: 12, tag: 'P', gapBefore: 12 },
    ...(t.signatoryName ? [{ text: `${t.signatoryName}, ${t.signatoryTitle}`, size: 13, tag: 'P' as const, gapBefore: 30 }] : []),
    { text: `${tr('Certificate')} ${record.current.number}${record.current.correctedAt ? ` · ${message(actor.locale, 'corrected {date}, supersedes {number}', { date: formatDate(record.current.correctedAt, zone, actor.locale), number: record.number })}` : ''}`, size: 10, tag: 'P', gapBefore: t.signatoryName ? 18 : 40 },
    { text: tr('This certificate records completion of the issuer’s own training. It is not an accreditation or a statement of competence.'), size: 9, tag: 'P', gapBefore: 4 },
  ]
  const bytes = certificatePdf(`${t.id ? t.heading : tr(t.heading)}: ${record.current.learner}, ${record.course}`, lines, (await portalTheme(env))?.primary ?? branding.primaryColor, actor.locale)
  return new Response(bytes, { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="certificate-${record.current.number}.pdf"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
}
