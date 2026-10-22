import { message, t } from './messages'
import type { Language } from './language'
// LEARN-010: policy acknowledgments and electronic signatures on an exact
// source version. The person opens the document first, then acknowledges,
// signs (typing their own name) or declines with a reason. Each decision keeps
// the document's digest, the intent, the signer, the time and the sign-in
// method, and downloads as evidence. A new version of the source asks everyone
// again in a separate requirement. Acknowledgments never write completions:
// signing a policy is not assessed learning.
import type { Bindings } from '../auth.server'
import { isManager, requireRole, type Actor } from './actor'
import { BeamError, all, commit, insist, newId, now, one, stmt, type Row } from './core'
import { serve } from './files'
import type { Input } from './input'
import { inScope, requireLearnerScope } from './scope'

const KINDS = ['acknowledgment', 'signature']
const IDENTITY: Record<string, string> = { native: 'emailed sign-in link', oidc: 'single sign-on', password: 'password', dev: 'local development identity', review: 'review session' }

const SELECT = `SELECT k.*, s.title AS source_title, v.number AS version_number, v.filename, v.media_type, v.size, v.sha256, m.name AS learner_name, m.email AS learner_email, rm.name AS requested_by_name,
  (SELECT json_extract(a.detail, '$.locale') FROM beam_audit a WHERE a.subject = k.id AND a.action IN ('acknowledgment.sign', 'acknowledgment.acknowledge') ORDER BY a.at DESC, a.id DESC LIMIT 1) AS intent_locale
  FROM beam_acknowledgments k JOIN beam_sources s ON s.id = k.source_id JOIN beam_source_versions v ON v.id = k.source_version_id JOIN beam_members m ON m.id = k.learner_id JOIN beam_members rm ON rm.id = k.requested_by`

const intentFor = (row: Row, locale: Language) => message(locale, row.kind === 'signature'
  ? 'I sign “{title}” version {version} electronically and intend this to be my signature.'
  : 'I have read and understood “{title}” version {version}.', { title: row.source_title, version: row.version_number })

function present(row: Row, locale: Language = 'en-US') {
  return {
    id: row.id, kind: row.kind, state: row.state, source: row.source_id, sourceTitle: row.source_title, sourceVersion: row.source_version_id, versionNumber: row.version_number,
    document: { filename: row.filename, mediaType: row.media_type, size: row.size, sha256: row.sha256 },
    learner: row.learner_id, learnerName: row.learner_name, requestedBy: row.requested_by, requestedByName: row.requested_by_name, requestedAt: row.requested_at, previous: row.previous_id,
    viewedAt: row.viewed_at, decidedAt: row.decided_at, intent: row.intent ?? intentFor(row, row.state === 'open' ? locale : 'en-US'), intentLocale: row.state === 'open' ? locale : row.intent_locale ?? null, signature: row.signature, identityMethod: row.identity_method, declineReason: row.decline_reason,
  }
}
export type Acknowledgment = ReturnType<typeof present>

/** The person asked, or a manager. Everyone else gets 404. */
async function load(env: Bindings, actor: Actor, id: string) {
  const row = await one(env, `${SELECT} WHERE k.id = ?`, id)
  if (!row || !(row.learner_id === actor.id || (isManager(actor) && inScope(actor, row.learner_id)))) throw new BeamError('not_found', 404)
  return row
}

export async function requestAcknowledgments(env: Bindings, actor: Actor, input: Input) {
  requireRole(actor, 'manager')
  const source = input.text('source')
  const version = await one(env, 'SELECT id FROM beam_source_versions WHERE source_id = ? ORDER BY number DESC LIMIT 1', source)
  insist(version, 'source_not_found', 404)
  const kind = input.text('kind')
  insist(KINDS.includes(kind), 'invalid_kind')
  const learners = new Set(input.list('learners'))
  for (const team of input.list('teams')) for (const row of await all<{ member_id: string }>(env, 'SELECT member_id FROM beam_team_members WHERE team_id = ?', team)) learners.add(row.member_id)
  insist(learners.size > 0, 'learners_required')
  for (const learner of learners) insist(await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', learner), 'person_not_found', 404)
  for (const learner of learners) requireLearnerScope(actor, learner)
  const held = new Set((await all<{ learner_id: string }>(env, 'SELECT learner_id FROM beam_acknowledgments WHERE source_version_id = ?', version.id)).map(row => row.learner_id))
  const created = [...learners].filter(learner => !held.has(learner)).map(learner => ({ id: newId(), learner }))
  const at = now()
  if (created.length) await commit(env, created.map(item => stmt(env, "INSERT INTO beam_acknowledgments (id, source_id, source_version_id, learner_id, kind, requested_by, requested_at, state) VALUES (?, ?, ?, ?, ?, ?, ?, 'open')", item.id, source, version.id, item.learner, kind, actor.id, at)), { actor, action: 'acknowledgment.request', subject: version.id, detail: { kind, learners: created.map(item => item.learner) } })
  return { sourceVersion: version.id, created: created.map(item => item.id), kept: [...held].filter(learner => learners.has(learner)) }
}

/** On a new source version: one new requirement per person who was asked about an earlier one. */
export const askAgainStatements = (env: Bindings, actor: Actor, sourceId: string, versionId: string, at: number) => [
  stmt(env, `INSERT OR IGNORE INTO beam_acknowledgments (id, source_id, source_version_id, learner_id, kind, previous_id, requested_by, requested_at, state)
    SELECT lower(hex(randomblob(16))), k.source_id, ?, k.learner_id, k.kind, k.id, ?, ?, 'open' FROM beam_acknowledgments k JOIN beam_source_versions v ON v.id = k.source_version_id
    WHERE k.source_id = ? AND v.number = (SELECT MAX(v2.number) FROM beam_acknowledgments k2 JOIN beam_source_versions v2 ON v2.id = k2.source_version_id WHERE k2.source_id = k.source_id AND k2.learner_id = k.learner_id)`, versionId, actor.id, at, sourceId),
]

/** Opening the document through its requirement records that the person viewed it. */
export async function acknowledgmentDocument(env: Bindings, actor: Actor, id: string, download: boolean) {
  const row = await load(env, actor, id)
  if (row.learner_id === actor.id && !row.viewed_at) await commit(env, [stmt(env, 'UPDATE beam_acknowledgments SET viewed_at = ? WHERE id = ? AND viewed_at IS NULL', now(), id)], { actor, action: 'acknowledgment.view', subject: id, detail: { sourceVersion: row.source_version_id, sha256: row.sha256 } })
  return serve(env, { filename: row.filename, mediaType: row.media_type, size: row.size, sha256: row.sha256 }, { download })
}

export async function decideAcknowledgment(env: Bindings, actor: Actor, input: Input) {
  const row = await load(env, actor, input.text('acknowledgment'))
  insist(row.learner_id === actor.id, 'not_found', 404)
  insist(!actor.agent, 'forbidden', 403)
  insist(row.state === 'open', 'acknowledgment_decided', 409)
  const decision = input.text('decision')
  insist(decision === 'sign' || decision === 'decline', 'invalid_decision')
  const identity = IDENTITY[actor.sessionKind] ?? actor.sessionKind
  const at = now()
  if (decision === 'decline') {
    const reason = input.text('reason', { max: 2000 })
    await commit(env, [stmt(env, "UPDATE beam_acknowledgments SET state = 'declined', decided_at = ?, identity_method = ?, decline_reason = ? WHERE id = ? AND state = 'open'", at, identity, reason, row.id)], { actor, action: 'acknowledgment.decline', subject: row.id, detail: { reason, identity } })
    return { id: row.id, state: 'declined' }
  }
  insist(row.viewed_at, 'document_not_viewed', 409)
  insist(input.text('agree', { optional: true }) === 'yes', 'intent_required')
  const signature = row.kind === 'signature' ? input.text('signature', { max: 160 }) : null
  insist(signature === null || signature.trim().toLowerCase() === actor.name.trim().toLowerCase(), 'signature_must_match_name')
  const locale = actor.locale ?? 'en-US'
  insist(!input.has('intentLocale') || input.text('intentLocale') === locale, 'acknowledgment_language_changed', 409)
  const intent = intentFor(row, locale)
  insist(!input.has('intent') || input.text('intent', { max: 2000 }) === intent, 'acknowledgment_intent_changed', 409)
  await commit(env, [stmt(env, "UPDATE beam_acknowledgments SET state = 'signed', decided_at = ?, intent = ?, signature = ?, identity_method = ? WHERE id = ? AND state = 'open'", at, intent, signature, identity, row.id)], { actor, action: `acknowledgment.${row.kind === 'signature' ? 'sign' : 'acknowledge'}`, subject: row.id, detail: { sourceVersion: row.source_version_id, sha256: row.sha256, intent, locale, signature, identity } })
  return { id: row.id, state: 'signed' }
}

export async function acknowledgmentView(env: Bindings, actor: Actor, id: string) {
  return present(await load(env, actor, id), actor.locale)
}

/** My requirements (every state, every version), and for managers their teams' (ORG-004). */
export async function acknowledgmentList(env: Bindings, actor: Actor) {
  const mine = (await all(env, `${SELECT} WHERE k.learner_id = ? ORDER BY k.requested_at DESC, v.number DESC`, actor.id)).map(row => present(row, actor.locale))
  const managed = isManager(actor) ? (await all(env, `${SELECT} ORDER BY s.title, v.number DESC, m.name`)).filter(row => inScope(actor, row.learner_id)).map(row => present(row, actor.locale)) : []
  return { mine, managed }
}

/** A decided requirement as a plain-text evidence record. */
export async function acknowledgmentEvidence(env: Bindings, actor: Actor, id: string) {
  const item = present(await load(env, actor, id), actor.locale)
  insist(item.state !== 'open', 'acknowledgment_open', 409)
  const tr = (key: string, values = {}) => t(actor, key, values)
  const iso = (value: number | null) => value ? new Date(value).toISOString() : tr('not recorded')
  const text = [
    tr('Beam {kind} evidence {id}', { kind: tr(item.kind), id: item.id }),
    tr('Document: {title}, version {version} ({filename}, {size} bytes)', { title: item.sourceTitle, version: item.versionNumber, filename: item.document.filename, size: item.document.size }),
    tr('Document SHA-256: {hash}', { hash: item.document.sha256 }),
    tr('Person: {name} <{email}>', { name: item.learnerName, email: (await one(env, 'SELECT email FROM beam_members WHERE id = ?', item.learner))!.email ?? '' }),
    tr('Requested by {name} at {date}', { name: item.requestedByName, date: iso(item.requestedAt) }),
    tr('Document opened at {date}', { date: iso(item.viewedAt) }),
    tr('Decision: {decision} at {date}', { decision: tr(item.state === 'signed' ? (item.kind === 'signature' ? 'signed' : 'acknowledged') : 'declined'), date: iso(item.decidedAt) }),
    item.state === 'signed' ? tr('Intent: {intent}', { intent: item.intent }) : tr('Reason: {reason}', { reason: item.declineReason ?? '' }),
    ...(item.state === 'signed' ? [tr('Intent language: {locale}', { locale: item.intentLocale ?? tr('not recorded') })] : []),
    ...(item.signature ? [tr('Typed signature: {signature}', { signature: item.signature })] : []),
    tr('Identity method: {method}', { method: tr(item.identityMethod ?? '') }),
    tr('This records a policy acknowledgment, not a course completion or an assessment of competence.'),
    '',
  ].join('\n')
  return new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="acknowledgment-${item.id}.txt"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
}
