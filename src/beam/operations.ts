// Read-only installation observations. A configured provider is never a live health or billing claim.
import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { all, now, one } from './core'
import { providerCosts } from './costs'
import { SOURCE_BYTES } from './sources'

export async function operations(env: Bindings, actor: Actor) {
  requireOwner(actor)
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
  const providers = await all(env, `SELECT 'webhook' AS kind,count(CASE WHEN outcome!='accepted' THEN 1 END) AS failures,max(CASE WHEN outcome='accepted' THEN at END) AS lastSuccessAt FROM beam_webhook_attempts
    UNION ALL SELECT 'model',count(CASE WHEN state='failed' THEN 1 END),max(CASE WHEN state='completed' THEN completed_at END) FROM beam_model_runs
    UNION ALL SELECT 'ocr',count(CASE WHEN state='failed' THEN 1 END),max(CASE WHEN state='completed' THEN completed_at END) FROM beam_source_ocr_runs`)
  const costs = await providerCosts(env, actor)
  return {
    observedAt: at, readiness: { database: 'readable', files: fileReadiness, providers: 'not_probed' },
    usage, jobs, providers,
    feeds: feeds.map(feed => ({ ...feed, stale: at > (feed.lastReceivedAt ?? feed.createdAt) + feed.intervalMinutes * 60000, transport: 'manual_review' })),
    limits: { sourceFileBytes: SOURCE_BYTES, storageQuotaBytes: null, providerQuota: 'unknown', capacity: 'unqualified' },
    costs,
    ownership: ['hosting', 'mail', 'video', 'models', 'licensed content'].map(kind => ({ kind, actualCharge: 'unknown', payer: 'employer' })),
  }
}
