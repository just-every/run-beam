import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import type { Input } from './input'
import { all, commit, insist, now, one, stmt } from './core'
import { retireD1ImportCustody, type D1Database } from '../modules/import-kit/src/d1/index'
import { erasureTargets, personIdentitySql } from './erasure-identity'
import { mappingVersion } from './movein/source'
import { ownerPredicate } from './movein/door'
import { personEraseStatements, personCustody } from './erasure-custody'
import { erasureOwner } from './erasure-policy'
import { redactionCheckpoint, preparedCheckpoint } from './erasure-fence'
import { erasureReport } from './erasure'
const contains = (value: unknown, identities: Set<string>): boolean => typeof value === 'string' ? identities.has(value) : Array.isArray(value) ? value.some(item => contains(item, identities)) : !!value && typeof value === 'object' && Object.values(value).some(item => contains(item, identities))
async function authErase(env: Bindings, operator: string | null, values: string[], member: string) {
  if (!operator) return []
  // Auth keeps an inactive, value-free decision id; secret verifiers and linked identities do not survive.
  return [
    stmt(env, `DELETE FROM rer_mail_development_outbox WHERE EXISTS(SELECT 1 FROM json_tree(message) j WHERE j.atom IN (SELECT value FROM json_each(?)))`, JSON.stringify(values)),
    stmt(env, `UPDATE beam_audit SET detail='{}',via=NULL WHERE actor=? OR subject=? OR EXISTS(SELECT 1 FROM json_tree(detail) j WHERE j.atom IN (SELECT value FROM json_each(?)))`, member, member, JSON.stringify(values)),
    stmt(env, 'DELETE FROM oa_provider_sessions WHERE session_id IN (SELECT id FROM oa_sessions WHERE operator_id=?)', operator),
    stmt(env, 'DELETE FROM oa_provider_session_pins WHERE session_id IN (SELECT id FROM oa_sessions WHERE operator_id=?)', operator),
    stmt(env, 'DELETE FROM oa_external_identities WHERE operator_id=?', operator),
    stmt(env, 'DELETE FROM oa_step_up_challenges WHERE operator_id=?', operator),
    stmt(env, "UPDATE oa_tokens SET token_hash='erased:'||id,return_to='/app',revoked_at=COALESCE(revoked_at,?) WHERE operator_id=?", now(), operator),
    stmt(env, "UPDATE oa_sessions SET token_hash='erased:'||id,revoked_at=COALESCE(revoked_at,?) WHERE operator_id=?", now(), operator),
    stmt(env, "UPDATE oa_operators SET email=?,display_name='Erased person',status='inactive',version=version+1 WHERE id=? AND role!='owner'", `erased-${operator}@invalid.local`, operator),
  ]
}
export async function resumeErasure(env: Bindings, actor: Actor, input: Input) {
  erasureOwner(actor)
  const id = input.text('job'), job = await one(env, 'SELECT * FROM beam_erasure_jobs WHERE id=?', id)
  insist(job, 'erasure_not_found', 404)
  if (job.state === 'complete') return erasureReport(env, actor, id)
  const lease = now() + 60000
  const claimed = await stmt(env, "UPDATE beam_erasure_jobs SET lease_until=?,version=version+1,state='pending',failure=NULL WHERE id=? AND version=? AND (lease_until IS NULL OR lease_until<?)", lease, id, job.version, now()).run()
  insist(claimed.meta.changes === 1, 'erasure_step_busy', 409)
  const selectors = JSON.parse(job.selectors_json), retention = JSON.parse(job.retention_json), outcomes = JSON.parse(job.report_json)
  let phase = job.phase, cursor = job.cursor, continuation = job.continuation
  try {
    if (phase === 'imports') {
      const target = selectors.targets[cursor]
      if (target) {
        const identities = new Set<string>(selectors.values)
        const result = await retireD1ImportCustody({ target: { kind: target.kind, id: target.id }, values: selectors.values, related: { source: record => contains(record.payload, identities), original: () => true } }, personIdentitySql(job.subject_id, now()), {
          destination: 'history', namespace: 'talentlms', mappingVersion,
          storage: { database: env.DB as unknown as D1Database, targets: erasureTargets },
          authorization: { principalId: actor.id, predicate: () => {
            const owner = ownerPredicate(actor)
            return { sql: `(${owner.sql}) AND EXISTS(SELECT 1 FROM beam_erasure_jobs WHERE id=? AND version=?)`, params: [...owner.params ?? [], id, job.version + 1] }
          } },
        }, await redactionCheckpoint(env), { resumable: true, ...(continuation ? { continuation } : {}) })
        if (result.phase === 'redacting') continuation = result.continuation
        else { cursor++; continuation = null; (outcomes.imports ??= []).push({ receiptId: result.receiptId, stores: result.stores }) }
      }
      if (cursor >= selectors.targets.length) { phase = 'native'; cursor = 0 }
    } else if (phase === 'native') {
      const native = job.kind === 'person' ? await personEraseStatements(env, job.subject_id, retention.retain, selectors.values) : [
        stmt(env, `DELETE FROM beam_tutor_questions WHERE assignment_id IN (SELECT id FROM beam_assignments WHERE course_id IN (SELECT course_id FROM beam_tutor_grants WHERE source_version_id IN (SELECT id FROM beam_source_versions WHERE source_id=?)))`, job.subject_id),
        stmt(env, `UPDATE beam_tutor_grants SET enabled=0,version=version+1 WHERE source_version_id IN (SELECT id FROM beam_source_versions WHERE source_id=?)`, job.subject_id),
        stmt(env, "UPDATE beam_source_ocr_runs SET state='failed',failure='source_erased',result_json=NULL WHERE source_version_id IN (SELECT id FROM beam_source_versions WHERE source_id=?)", job.subject_id),
        stmt(env, "UPDATE beam_source_versions SET filename='Erased original',provenance='erased by owner' WHERE source_id=?", job.subject_id),
        stmt(env, "UPDATE beam_sources SET title='Erased source',licence_evidence='erased by owner',erased_at=? WHERE id=?", now(), job.subject_id),
      ]
      const sourceHeld = job.kind === 'source' && retention.holds.length
      await commit(env, [
        stmt(env, 'INSERT INTO beam_erasure_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM beam_erasure_jobs WHERE id=? AND version=?) THEN 1 ELSE 0 END', id, job.version + 1),
        ...sourceHeld ? [] : native,
        ...job.kind === 'person' ? await authErase(env, selectors.operator, selectors.values, job.subject_id) : [],
        ...job.kind === 'person' ? [stmt(env, 'UPDATE beam_members SET erasure_pending=0,erased_at=? WHERE id=?', now(), job.subject_id)] : [],
        ...await preparedCheckpoint(env),
        stmt(env, "UPDATE beam_erasure_jobs SET phase='files' WHERE id=? AND version=?", id, job.version + 1),
        stmt(env, 'DELETE FROM beam_erasure_guard'),
      ], { actor, action: 'erasure.native', subject: id, detail: { retainedAssessment: retention.retain, sourceHeld: !!sourceHeld } })
      phase = 'files'
    } else if (phase === 'files') {
      if (!outcomes.native) {
        const remaining = job.kind === 'person' ? (await personCustody(env, job.subject_id, selectors.values)).rows : []
        outcomes.native = JSON.parse(job.inventory_json).rows.map((before: {table:string;category:string;count:number}) => {
          const kept = job.kind === 'source' ? before.count : remaining.find(row => row.table === before.table && row.category === before.category)?.count ?? 0
          return {table:before.table,category:before.category,before:before.count,retained:kept,removed:Math.max(0,before.count-kept),handling: before.table === 'beam_members' || before.table === 'beam_audit' || job.kind === 'source' ? 'redacted or held' : before.category === 'authored' ? 'anonymous attribution retained' : kept ? 'retained under policy or shared custody' : 'deleted'}
        })
      }
      const file = await one(env, "SELECT sha256 FROM beam_erasure_files WHERE job_id=? AND state='pending' ORDER BY sha256 LIMIT 1", id)
      if (file) {
        const used = await one(env, `SELECT 1 FROM beam_attachments WHERE sha256=? UNION ALL SELECT 1 FROM beam_source_versions v JOIN beam_sources s ON s.id=v.source_id WHERE v.sha256=? AND s.erased_at IS NULL UNION ALL SELECT 1 FROM beam_package_assets WHERE sha256=? UNION ALL SELECT 1 FROM beam_packages WHERE original_sha256=? UNION ALL SELECT 1 FROM beam_xapi_attachments WHERE sha256=? LIMIT 1`, ...Array(5).fill(file.sha256))
        if (!used) { await env.FILES.delete(`sha256/${file.sha256}`); insist(!await env.FILES.head(`sha256/${file.sha256}`), 'file_deletion_failed', 503) }
        await stmt(env, 'UPDATE beam_erasure_files SET state=? WHERE job_id=? AND sha256=?', used ? 'retained_shared_or_held' : 'deleted', id, file.sha256).run()
      }
      if (!await one(env, "SELECT 1 FROM beam_erasure_files WHERE job_id=? AND state='pending'", id)) phase = 'providers'
    } else if (phase === 'providers') {
      // xAPI has no standard destructive statement deletion API. Do not pretend voiding is erasure.
      await stmt(env, "UPDATE beam_erasure_providers SET state='failed',failure=CASE WHEN connection_id LIKE 'mail:%' THEN 'mail_provider_erasure_api_required' WHEN connection_id='ocr:openai' THEN 'ocr_provider_erasure_api_required' ELSE 'connected_lrs_erasure_api_required' END WHERE job_id=? AND state='pending'", id).run()
      phase = 'complete'
    }
    await stmt(env, 'UPDATE beam_erasure_jobs SET phase=?,state=?,cursor=?,continuation=?,report_json=?,selectors_json=CASE WHEN ? THEN ? ELSE selectors_json END,lease_until=NULL WHERE id=? AND version=?', phase, phase === 'complete' ? 'complete' : 'pending', cursor, continuation, JSON.stringify(outcomes), phase === 'complete' ? 1 : 0, '{}', id, job.version + 1).run()
  } catch (error) {
    if (error instanceof Error) console.error('erasure_step_failed', { phase, type: error.name, frames: error.stack?.split('\n').filter(line => /^\s+at /.test(line)).slice(0, 6) })
    const code = error instanceof Error && /^[A-Za-z_][A-Za-z0-9_]*(?::|$)/.test(error.message) ? error.message.split(':')[0].slice(0, 100) : 'erasure_step_failed'
    await stmt(env, "UPDATE beam_erasure_jobs SET state='failed',failure=?,lease_until=NULL WHERE id=? AND version=?", code, id, job.version + 1).run()
  }
  return erasureReport(env, actor, id)
}
