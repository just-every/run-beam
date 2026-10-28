// Installation observations with value-free access lineage. A configured provider is never a live health or billing claim.
import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { all, commit, insist, now, one, stmt } from './core'
import { providerCosts } from './costs'
import { SOURCE_BYTES } from './sources'

export const OPERATIONAL_JOBS = ['inactivity','content-review','escalations','renewals','webhooks'] as const
export type OperationalJob = typeof OPERATIONAL_JOBS[number]
export async function runOperationalJob(env: Bindings, name: OperationalJob, run: () => Promise<unknown>) {
  const started = now()
  await stmt(env, `INSERT INTO beam_operational_jobs(name,started_at,outcome) VALUES(?,?,'running')
    ON CONFLICT(name) DO UPDATE SET started_at=excluded.started_at,finished_at=NULL,outcome='running'`, name, started).run()
  try {
    const result = await run()
    await stmt(env, "UPDATE beam_operational_jobs SET finished_at=?,last_success_at=?,outcome='succeeded' WHERE name=? AND started_at=?", now(), now(), name, started).run()
    return result
  } catch (error) {
    // The original provider/runtime error is deliberately absent from the health record.
    await stmt(env, "UPDATE beam_operational_jobs SET finished_at=?,outcome='failed',failures=failures+1 WHERE name=? AND started_at=?", now(), name, started).run()
    throw error
  }
}
export async function operations(env: Bindings, actor: Actor, door: 'json' | 'page') {
  requireOwner(actor)
  insist(!actor.agent && !actor.app && !actor.viewAs, 'human_owner_required', 403)
  const at = now()
  const usage = await one(env, `SELECT
    (SELECT count(*) FROM beam_members WHERE employment='active') AS activePeople,
    (SELECT count(*) FROM beam_assignments) AS assignments,
    (SELECT count(*) FROM beam_completions) AS completions,
    (SELECT count(*) FROM beam_packages) AS packages,
    (SELECT coalesce(sum(size),0) FROM beam_source_versions) AS sourceVersionBytes`)
  let fileReadiness = 'readable'
  try { await env.FILES.list({ limit: 1 }) } catch { fileReadiness = 'unavailable' }
  // Fixed projections exclude payloads, raw failures, destinations, credentials and personal records.
  const jobs = (await Promise.all([
    "SELECT 'scheduled' AS kind,status AS state,count(*) AS count,max(finished_at) AS lastFinishedAt FROM oa_policy_runs GROUP BY status",
    "SELECT 'automation' AS kind,state,count(*) AS count,max(updated_at) AS lastFinishedAt FROM beam_automation_executions GROUP BY state",
    "SELECT 'webhook' AS kind,state,count(*) AS count,NULL AS lastFinishedAt FROM beam_webhook_deliveries GROUP BY state",
    "SELECT 'model' AS kind,state,count(*) AS count,max(completed_at) AS lastFinishedAt FROM beam_model_runs GROUP BY state",
    "SELECT 'ocr' AS kind,state,count(*) AS count,max(completed_at) AS lastFinishedAt FROM beam_source_ocr_runs GROUP BY state",
    "SELECT 'roster_review' AS kind,state,count(*) AS count,max(applied_at) AS lastFinishedAt FROM beam_roster_batches GROUP BY state",
    "SELECT 'import' AS kind,state,count(*) AS count,NULL AS lastFinishedAt FROM ik_jobs GROUP BY state",
    "SELECT 'archive' AS kind,CASE WHEN completed=1 THEN 'completed' ELSE phase END AS state,count(*) AS count,NULL AS lastFinishedAt FROM rer_portability_jobs GROUP BY state",
    "SELECT 'erasure' AS kind,state,count(*) AS count,NULL AS lastFinishedAt FROM beam_erasure_jobs GROUP BY state",
    "SELECT 'renewal_mail' AS kind,state,count(*) AS count,max(sent_at) AS lastFinishedAt FROM beam_renewal_notices GROUP BY state",
  ].map(query => all(env, query)))).flat()
  const feeds = await all<{ id: string; name: string; intervalMinutes: number; createdAt: number; lastReceivedAt: number | null; lastAppliedAt: number | null; held: number; failed: number }>(env, `SELECT f.id,f.name,f.interval_minutes AS intervalMinutes,f.created_at AS createdAt,f.last_received_at AS lastReceivedAt,
    (SELECT max(b.applied_at) FROM beam_roster_feed_receipts r JOIN beam_roster_batches b ON b.id=r.batch_id WHERE r.feed_id=f.id AND b.state='applied') AS lastAppliedAt,
    (SELECT count(*) FROM beam_roster_feed_receipts r LEFT JOIN beam_roster_batches b ON b.id=r.batch_id WHERE r.feed_id=f.id AND r.state='held' AND (b.state IS NULL OR b.state!='applied')) AS held,
    (SELECT count(*) FROM beam_roster_feed_receipts r WHERE r.feed_id=f.id AND r.state='failed') AS failed
    FROM beam_roster_feeds f ORDER BY f.created_at,f.id`)
  const providers = await all(env, `SELECT 'webhook' AS kind,count(CASE WHEN outcome!='accepted' AND outcome!='outcome_unknown' THEN 1 END) AS failures,count(CASE WHEN outcome='outcome_unknown' THEN 1 END) AS unknownOutcomes,max(CASE WHEN outcome='accepted' THEN at END) AS lastSuccessAt FROM beam_webhook_attempts
    UNION ALL SELECT 'model',count(CASE WHEN state='failed' AND coalesce(failure,'')!='model_outcome_unknown' THEN 1 END),count(CASE WHEN failure='model_outcome_unknown' THEN 1 END),max(CASE WHEN state='completed' THEN completed_at END) FROM beam_model_runs
    UNION ALL SELECT 'ocr',count(CASE WHEN state='failed' AND coalesce(failure,'')!='source_ocr_outcome_unknown' THEN 1 END),count(CASE WHEN failure='source_ocr_outcome_unknown' THEN 1 END),max(CASE WHEN state='completed' THEN completed_at END) FROM beam_source_ocr_runs`)
  const scheduled = await all<{name: string; startedAt: number; finishedAt: number | null; lastSuccessAt: number | null; outcome: string; failures: number}>(env, 'SELECT name,started_at AS startedAt,finished_at AS finishedAt,last_success_at AS lastSuccessAt,outcome,failures FROM beam_operational_jobs ORDER BY name')
  const synchronization = await one<{configured: number; stale: number; failures: number; lastSuccessAt: number | null}>(env, `SELECT count(*) AS configured,coalesce(sum(enabled=1 AND (last_synced_at IS NULL OR last_synced_at<?)),0) AS stale,
    coalesce(sum(last_failure IS NOT NULL),0) AS failures,max(last_synced_at) AS lastSuccessAt FROM beam_gusto_language_mappings`, at - 24 * 60 * 60 * 1000)
  const backlog = await one(env, "SELECT count(*) AS rosterRows FROM beam_roster_batch_rows r JOIN beam_roster_batches b ON b.id=r.batch_id WHERE b.state='applying' AND r.state!='done'")
  const packageStorage = await one(env, `SELECT
    (SELECT coalesce(sum(original_size),0) FROM beam_packages) AS archiveBytes,
    (SELECT coalesce(sum(size),0) FROM beam_package_assets) AS assetBytes`)
  const costs = await providerCosts(env, actor)
  await commit(env, [], { actor, action: 'access.operations', subject: 'installation', detail: { door } })
  return {
    observedAt: at, readiness: { database: 'readable', files: fileReadiness, providers: 'not_probed' },
    usage, jobs, providers, backlog: backlog ?? {rosterRows: 0}, packageStorage: packageStorage ?? {archiveBytes: 0, assetBytes: 0},
    scheduledJobs: OPERATIONAL_JOBS.map(name => {
      const job = scheduled.find(job => job.name === name)
      return job ? { ...job, stalled: job.outcome === 'running' && job.startedAt < at - 10 * 60 * 1000 }
        : { name, outcome: 'not_run', lastSuccessAt: null, stalled: false, failures: 0 }
    }),
    synchronization: { ...(synchronization ?? {configured: 0, stale: 0, failures: 0, lastSuccessAt: null}), transport: 'manual_gusto_language' },
    feeds: feeds.map(feed => ({ ...feed, stale: at > (feed.lastReceivedAt ?? feed.createdAt) + feed.intervalMinutes * 60000, transport: 'manual_review' })),
    limits: { sourceFileBytes: SOURCE_BYTES, storageQuotaBytes: null, providerQuota: 'unknown', capacity: 'unqualified' },
    costs,
    ownership: ['hosting', 'mail', 'video', 'models', 'licensed content'].map(kind => ({ kind, actualCharge: 'unknown', payer: 'employer' })),
  }
}
