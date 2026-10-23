// OPS-008: aggregate current installation facts, never provider credentials or payloads.
import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { all, insist, now, one, stmt } from './core'
import { SOURCE_BYTES } from './sources'
import { providerCosts } from './costs'

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
export async function operationsHealth(env: Bindings, actor: Actor) {
  requireOwner(actor)
  insist(!actor.agent && !actor.app && !actor.viewAs, 'human_owner_required', 403)
  const at = now()
  const count = async (sql: string) => (await one<{count:number}>(env, sql))?.count ?? 0
  const jobs = await all(env, 'SELECT name,started_at AS startedAt,finished_at AS finishedAt,last_success_at AS lastSuccessAt,outcome,failures FROM beam_operational_jobs ORDER BY name')
  const sync = await one<{configured:number;enabled:number|null;lastSuccessAt:number|null;stale:number;failures:number}>(env, `SELECT count(*) AS configured,sum(enabled) AS enabled,max(last_synced_at) AS lastSuccessAt,
    coalesce(sum(enabled=1 AND (last_synced_at IS NULL OR last_synced_at<?)),0) AS stale,
    coalesce(sum(last_failure IS NOT NULL),0) AS failures FROM beam_gusto_language_mappings`, at-24*60*60*1000)
  const files = await one<{originals:number;originalBytes:number}>(env, 'SELECT count(*) AS originals,coalesce(sum(size),0) AS originalBytes FROM beam_source_versions')
  const packages = await one<{packages:number;archiveBytes:number}>(env, 'SELECT count(*) AS packages,coalesce(sum(original_size),0) AS archiveBytes FROM beam_packages')
  const packageAssets = await one<{assets:number;assetBytes:number}>(env, 'SELECT count(*) AS assets,coalesce(sum(size),0) AS assetBytes FROM beam_package_assets')
  let filesReadiness = 'reachable'
  try { await env.FILES.head('beam-operational-readiness-probe') } catch { filesReadiness = 'unavailable; prior files retained, retry after storage access is restored' }
  return { asOf:at,
    readiness:{ database:'reachable', files:filesReadiness, mail:env.MAIL_PROVIDER && env.MAIL_PROVIDER!=='development' ? 'configured, delivery unverified' : 'development only' },
    people:await count("SELECT count(*) AS count FROM beam_members m LEFT JOIN oa_operators o ON o.id=m.operator_id WHERE m.employment='active' AND m.erased_at IS NULL AND o.status='active'"),
    directoryPeople:await count("SELECT count(*) AS count FROM beam_members WHERE employment='active' AND erased_at IS NULL"),
    learning:{assignments:await count('SELECT count(*) AS count FROM beam_assignments'),completions:await count('SELECT count(*) AS count FROM beam_completions'),importedHistory:await count('SELECT count(*) AS count FROM beam_imported_history')},
    jobs:OPERATIONAL_JOBS.map(name=>{const job=jobs.find(job=>job.name===name);return job ? {...job,name,stalled:job.outcome==='running'&&job.startedAt<at-10*60*1000} : {name,outcome:'not_run',lastSuccessAt:null,stalled:false,failures:0}}),
    backlog:{rosterRows:await count("SELECT count(*) AS count FROM beam_roster_batch_rows r JOIN beam_roster_batches b ON b.id=r.batch_id WHERE b.state='applying' AND r.state!='done'"),
      imports:await count("SELECT count(*) AS count FROM ik_jobs WHERE state IN ('queued','applying','undoing')"),
      automation:await count("SELECT count(*) AS count FROM beam_automation_executions WHERE state!='succeeded'"),
      webhooks:await count("SELECT count(*) AS count FROM beam_webhook_deliveries WHERE state IN ('pending','sending')"),
      ocr:await count("SELECT count(*) AS count FROM beam_source_ocr_runs WHERE state='running'")},
    failures:{automation:await count("SELECT count(*) AS count FROM beam_automation_executions WHERE state='failed'"),
      webhooks:await count("SELECT count(*) AS count FROM beam_webhook_deliveries WHERE state IN ('dead','unknown')"),
      ocr:await count("SELECT count(*) AS count FROM beam_source_ocr_runs WHERE state='failed'")},
    synchronization:{...(sync ?? {configured:0,enabled:0,lastSuccessAt:null,stale:0,failures:0}),kind:'Manual Gusto language only; roster-feed synchronization is not implemented',staleAfterHours:24},
    storage:{originals:files?.originals ?? 0,originalBytes:files?.originalBytes ?? 0,packages:packages?.packages ?? 0,archiveBytes:packages?.archiveBytes ?? 0,assets:packageAssets?.assets ?? 0,assetBytes:packageAssets?.assetBytes ?? 0,note:'Logical retained bytes; shared object digests may deduplicate. Provider quota and billing are not measured.'},
    limits:{sourceBytes:SOURCE_BYTES,rosterBytes:5_000_000,rosterRows:5000,rosterApplyRows:50,qualification:'Local built-Worker qualification only; hosted performance and provider quotas are not guaranteed.'},
    costs:await providerCosts(env,actor),
  }
}
