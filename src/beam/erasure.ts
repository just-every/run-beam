// Preview is read-only; execution is an explicit human action with durable phases.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import type { Input } from './input'
import { all, commit, insist, newId, now, one, sha256Hex, stmt } from './core'
import { personCustody } from './erasure-custody'
import { erasureOwner, erasureSettings } from './erasure-policy'
import { identityDigest, preparedCheckpoint } from './erasure-fence'
export async function erasurePreview(env: Bindings, actor: Actor, input: Input) {
  erasureOwner(actor)
  const kind = input.text('kind'), subject = input.text('subject')
  insist(['person', 'source'].includes(kind), 'invalid_erasure_kind')
  const settings = await erasureSettings(env, actor)
  insist(settings.policy, 'retention_policy_required', 409)
  const person = kind === 'person' ? await one(env, 'SELECT m.*,o.role AS operator_role FROM beam_members m LEFT JOIN oa_operators o ON o.id=m.operator_id WHERE m.id=?', subject) : null
  const source = kind === 'source' ? await one(env, 'SELECT * FROM beam_sources WHERE id=?', subject) : null
  insist(person || source, 'subject_not_found', 404)
  insist(!person || person.operator_role !== 'owner' && person.email?.toLowerCase() !== env.OWNER_EMAIL.toLowerCase(), 'owner_erasure_forbidden', 409)
  const holds = settings.holds.filter(row => row.kind === kind && row.subject_id === subject && !row.released_at)
  const latest = person ? await one<{at:number|null}>(env, `SELECT max(at) AS at FROM (SELECT completed_at AS at FROM beam_completions WHERE learner_id=? UNION ALL SELECT submitted_at AS at FROM beam_attempts WHERE assignment_id IN (SELECT id FROM beam_assignments WHERE learner_id=?))`, subject, subject) : null
  const retainUntil = settings.policy.assessment_days && latest?.at ? latest.at + settings.policy.assessment_days * 86400000 : null
  const retention = { assessmentDays: settings.policy.assessment_days, policyVersion: settings.policy.version, justification: settings.policy.justification, holds: holds.map(row => ({ id: row.id, justification: row.justification })), retainUntil, retain: holds.length > 0 || !!retainUntil && retainUntil > now() }
  const native = person ? await personCustody(env, subject) : null
  const versions = source ? await all(env, 'SELECT id,sha256 FROM beam_source_versions WHERE source_id=? ORDER BY id', subject) : []
  const cited = source ? await one(env, `SELECT count(*) AS count FROM beam_lesson_revisions l WHERE EXISTS(SELECT 1 FROM json_each(l.source_version_ids) c JOIN beam_source_versions v ON v.id=c.value WHERE v.source_id=?)`, subject) : null
  const importTables = await all<{ name: string }>(env, "SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'ik_*' ORDER BY name")
  const imports = []
  for (const row of importTables) {
    const count = await one(env, `SELECT count(*) AS count FROM "${row.name}"`)
    if (count!.count) imports.push({ table: row.name, count: count!.count })
  }
  const providers = person ? await all(env, 'SELECT connection_id,actor_name FROM beam_xapi_actors WHERE learner_id=? ORDER BY connection_id', subject) : []
  if (source && await one(env, 'SELECT 1 FROM beam_source_ocr_runs r JOIN beam_source_versions v ON v.id=r.source_version_id WHERE v.source_id=? LIMIT 1', subject)) providers.push({ connection_id: 'ocr:openai', actor_name: subject })
  if (person?.email) providers.push({ connection_id: `mail:${env.MAIL_PROVIDER}`, actor_name: await identityDigest(env, person.email) })
  const sourceReferences = source ? await one<{count:number}>(env, `SELECT (SELECT count(*) FROM beam_acknowledgments WHERE source_id=?) + (SELECT count(*) FROM beam_source_notices WHERE source_id=?) + (SELECT count(*) FROM beam_courses c, json_each(c.draft_json,'$.lessons') l, json_each(l.value,'$.sources') citation JOIN beam_source_versions v ON v.id=citation.value WHERE v.source_id=?) AS count`, subject, subject, subject) : null
  const unsupported = [...(native?.unsupported ?? []), ...((cited?.count || sourceReferences?.count) && !holds.length ? ['cited source content requires retention and derived-content erasure before this source can be erased'] : [])]
  const inventory = { rows: native?.rows ?? [{ table: 'beam_source_versions', count: versions.length, category: 'personal' }], fileHashes: native?.fileHashes ?? versions.map(row => row.sha256), imports, providers, unsupported, authoredMaterial: native?.authoredMaterial ?? 'Published citations are not rewritten by erasure.', importEffect: 'Affected import originals are withdrawn, including shared originals; unfinished private uploads, retained previews and approvals are retired. Permanent settings and revoked signing keys remain.', devices: 'Web pages and downloads cannot be remotely erased. Sessions are revoked; no native or offline cache door exists today.' }
  const digest = await sha256Hex(new TextEncoder().encode(JSON.stringify({ kind, subject, inventory, retention })))
  return { kind, subject, name: person?.name ?? source?.title, digest, retention, inventory }
}
export async function beginErasure(env: Bindings, actor: Actor, input: Input) {
  const preview = await erasurePreview(env, actor, input)
  insist(input.flag('consent'), 'erasure_consent_required', 409)
  insist(input.text('digest') === preview.digest, 'stale_erasure_preview', 409)
  insist(!preview.inventory.unsupported.length, 'unsupported_person_custody', 409, preview.inventory.unsupported)
  const reason = input.text('justification', { max: 2000 })
  const id = newId(), at = now()
  const member = preview.kind === 'person' ? await one(env, 'SELECT * FROM beam_members WHERE id=?', preview.subject) : null
  const values = member ? [...new Set([member.id, member.email, member.name, member.employee_id, member.username].filter(Boolean))] as string[] : [preview.subject]
  const identities = member ? [member.id, member.email, member.employee_id, member.username].filter(Boolean) as string[] : preview.inventory.fileHashes.map(value => `file:${value}`)
  const historical = member ? await all(env, `SELECT id,kind,payload FROM beam_imported_history WHERE EXISTS(SELECT 1 FROM json_tree(payload) j WHERE j.atom IN (SELECT value FROM json_each(?))) ORDER BY id`, JSON.stringify(values)) : []
  for (const row of historical) { const payload = JSON.parse(row.payload); for (const key of ['email','name']) if (typeof payload[key] === 'string' && payload[key] && !values.includes(payload[key])) values.push(payload[key]); if (payload.email && !identities.includes(payload.email)) identities.push(payload.email) }
  const selectors = { values, targets: [{ id: preview.subject, kind: 'person' }], operator: member?.operator_id ?? null }
  const statements = [
    stmt(env, 'INSERT INTO beam_erasure_jobs(id,kind,subject_id,requested_by,requested_at,phase,state,selectors_json,inventory_json,retention_json) VALUES(?,?,?,?,?,?,?,?,?,?)', id, preview.kind, preview.subject, actor.id, at, preview.kind === 'person' ? 'imports' : 'native', 'pending', JSON.stringify(selectors), JSON.stringify(preview.inventory), JSON.stringify({ ...preview.retention, requestedReason: reason, retainUntil: preview.retention.retainUntil })),
    ...await preparedCheckpoint(env),
    ...await Promise.all(identities.map(async value => stmt(env, 'INSERT OR IGNORE INTO beam_erasure_tombstones VALUES(?,?,?)', await identityDigest(env, value), id, at))),
    ...preview.inventory.fileHashes.map(hash => stmt(env, 'INSERT OR IGNORE INTO beam_erasure_files(job_id,sha256) VALUES(?,?)', id, hash)),
    ...preview.inventory.providers.map(provider => stmt(env, 'INSERT INTO beam_erasure_providers(job_id,connection_id,actor_name) VALUES(?,?,?)', id, provider.connection_id, provider.actor_name)),
    ...(member ? [stmt(env, 'UPDATE beam_members SET erasure_pending=1 WHERE id=?', member.id), stmt(env, "UPDATE oa_operators SET status='inactive' WHERE id=? AND role!='owner'", member.operator_id), stmt(env, 'UPDATE oa_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE operator_id=?', at, member.operator_id)] : []),
  ]
  await commit(env, statements, { actor, action: 'erasure.begin', subject: id, detail: { kind: preview.kind, subject: preview.subject, retention: preview.retention.retain } })
  return { id, phase: preview.kind === 'person' ? 'imports' : 'native' }
}
export async function erasureReport(env: Bindings, actor: Actor, id: string) {
  erasureOwner(actor)
  const job = await one<{ id: string; kind: string; subject_id: string; requested_at: number; phase: string; state: string; inventory_json: string; retention_json: string; report_json: string; cursor: number; failure: string | null; version: number }>(env, 'SELECT id,kind,subject_id,requested_at,phase,state,inventory_json,retention_json,report_json,cursor,failure,version FROM beam_erasure_jobs WHERE id=?', id)
  insist(job, 'erasure_not_found', 404)
  return { ...job, outcomes: JSON.parse(job.report_json), report_json: undefined, inventory: JSON.parse(job.inventory_json), retention: JSON.parse(job.retention_json), inventory_json: undefined, retention_json: undefined, files: await all(env, 'SELECT sha256,state FROM beam_erasure_files WHERE job_id=?', id), providers: await all(env, 'SELECT connection_id,state,failure FROM beam_erasure_providers WHERE job_id=?', id), restore: 'Keep a post-erasure installation archive. Restore older archives only with rer import --journal <post-erasure.rer>; the later trusted redaction checkpoint refuses the older archive.' }
}
