// Pre-door imports keep their original custody and principal. Compatibility is
// limited to owner history and bounded reversal; creation/apply stay removed.
import type { Bindings } from '../../auth.server'
import { readD1ImportUndoReport, rollbackD1Import, undoD1Import, type D1Database, type D1ImportContext, type D1Sql } from '../../modules/import-kit/src/d1/index'
import { statement, sql } from '../../modules/import-kit/src/door/store'
import { requireOwner, type Actor } from '../actor'
import { insist, one } from '../core'
import { historyTargets } from './target'

type LegacyJob = {
  id: string; namespace: string; mapping_version: string; principal_id: string;
  operation_key: string; fingerprint: string; state: string; error: string | null;
  total: number; applied_at: number | null;
}

const legacyScope = `j.destination='history' AND j.namespace='talentlms'
  AND j.operation_key NOT LIKE 'door:%'
  AND NOT EXISTS(SELECT 1 FROM ik_door_plans p WHERE p.job_id=j.id)`
const selectJob = `SELECT j.id,j.namespace,j.mapping_version,j.principal_id,j.operation_key,j.fingerprint,j.state,j.error,j.total,
  (SELECT MAX(a.at) FROM beam_audit a WHERE a.subject=j.id AND a.action='import.apply') AS applied_at
  FROM ik_jobs j WHERE ${legacyScope}`

function context(env: Bindings, job: LegacyJob, owner: D1Sql): D1ImportContext {
  return {
    destination: 'history', namespace: job.namespace, mappingVersion: job.mapping_version,
    batchSize: 20, maxBatches: 1,
    storage: {database: env.DB as unknown as D1Database, targets: historyTargets},
    authorization: {
      // Preserve the stored binding even if the current installation's owner
      // was replaced or restored. Authority still comes from today's owner.
      principalId: job.principal_id,
      predicate(action, destination) {
        if (destination !== 'history' || !['read', 'undo', 'rollback'].includes(action)) return sql('0')
        return sql(`(${owner.sql}) AND EXISTS(SELECT 1 FROM ik_jobs j WHERE ${legacyScope}
          AND j.id=? AND j.namespace=? AND j.mapping_version=? AND j.principal_id=? AND j.operation_key=?)`,
        ...owner.params ?? [], job.id, job.namespace, job.mapping_version, job.principal_id, job.operation_key)
      },
    },
  }
}

export async function legacyHistory(env: Bindings, actor: Actor, owner: D1Sql) {
  requireOwner(actor)
  const db = env.DB as unknown as D1Database
  // Fence the owner metadata read in the same D1 transaction at both ends.
  const authorized = sql(`SELECT CASE WHEN (${owner.sql}) THEN 1 ELSE json('IMPORT_DOOR_OWNER_REQUIRED') END`, ...owner.params ?? [])
  const results = await db.batch([statement(db, authorized), statement(db, sql(selectJob)), statement(db, authorized)])
  const jobs = (results[1] as {results: LegacyJob[]}).results
  return Promise.all(jobs.map(async job => {
    const report = ['undone', 'rolled_back'].includes(job.state) ? await readD1ImportUndoReport(job.id, context(env, job, owner)) : null
    return {
      legacy: true as const, id: job.id, jobId: job.id, namespace: job.namespace, planId: '',
      fingerprint: job.fingerprint, state: job.state, error: job.error, failureCode: null,
      appliedAt: job.applied_at, effects: job.total, caption: 'Legacy owner import',
      // No door approval is manufactured for an old job.
      owner: null, approvedAt: null, approvalRecordId: null, reviewer: null,
      originalPrincipalId: job.principal_id,
      retained: report?.dispositions.filter(item => item.disposition === 'retained').map(item => ({target: item.targetId, reason: item.reason})) ?? [],
    }
  }))
}

export async function undoLegacyImport(env: Bindings, actor: Actor, legacyJobId: string, owner: D1Sql) {
  requireOwner(actor)
  const job = await one<LegacyJob>(env, `${selectJob} AND j.id=?`, legacyJobId)
  insist(job, 'legacy_import_not_found', 404)
  const original = context(env, job, owner)
  // An interrupted old apply can be discarded, but never resumed forward.
  const result = await (['completed', 'undoing', 'undone'].includes(job.state)
    ? undoD1Import(job.id, original)
    : rollbackD1Import(job.id, original))
  return {legacyJobId: job.id, job: result}
}
