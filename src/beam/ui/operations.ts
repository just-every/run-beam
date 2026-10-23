// Existing Settings card vocabulary; operational data is a human-owner aggregate.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { operationsHealth } from '../operations'
import { card, h } from './html'
export async function operationsCard(env: Bindings, actor: Actor) {
  const health = await operationsHealth(env,actor)
  const instant = (at:unknown) => typeof at==='number' ? new Date(at).toISOString() : 'Never'
  const labels:Record<string,string>={inactivity:'Inactivity review','content-review':'Content review',escalations:'Overdue escalation',renewals:'Renewals',webhooks:'Webhook deliveries',rosterRows:'Roster rows',imports:'Imports',automation:'Automatic actions',ocr:'OCR requests',not_run:'Not run yet',running:'Running',succeeded:'Succeeded',failed:'Failed'}
  return card('Installation health',h`<p>As of ${instant(health.asOf)}. ${health.people} active people with sign-in accounts (${health.directoryPeople} active directory records); ${health.learning.assignments} assignments; ${health.learning.completions} native completions; ${health.learning.importedHistory} labeled history rows.</p>
    <dl><dt>Database</dt><dd>${health.readiness.database}</dd><dt>File storage</dt><dd>${health.readiness.files}</dd><dt>Mail</dt><dd>${health.readiness.mail}</dd></dl>
    <h3>Scheduled jobs</h3><ul>${health.jobs.map(job=>h`<li>${labels[job.name]??job.name}: ${labels[String(job.outcome)]??job.outcome}${job.stalled?' — stalled or interrupted; inspect before replay':''}. Last successful run: ${instant(job.lastSuccessAt)}; failures: ${job.failures}.</li>`)}</ul>
    <h3>Work waiting and failures</h3><ul>${Object.entries(health.backlog).map(([name,count])=>h`<li>${labels[name]??name}: ${count} waiting${name in health.failures ? `; ${health.failures[name as keyof typeof health.failures]} failed or unknown` : ''}.</li>`)}</ul>
    <h3>Synchronization</h3><p>${health.synchronization.kind}. ${health.synchronization.configured} mappings; ${health.synchronization.stale} enabled mappings without success in ${health.synchronization.staleAfterHours} hours; ${health.synchronization.failures} failed mappings. Last success: ${instant(health.synchronization.lastSuccessAt)}.</p>
    <h3>Use and limits before uploading</h3><p>${health.storage.originals} original versions (${health.storage.originalBytes} bytes); ${health.storage.packages} package archives (${health.storage.archiveBytes} bytes); ${health.storage.assets} package assets (${health.storage.assetBytes} bytes). ${health.storage.note}</p>
    <p>Original source: ${health.limits.sourceBytes} bytes per file. Roster: ${health.limits.rosterBytes} bytes and ${health.limits.rosterRows} rows per upload, ${health.limits.rosterApplyRows} rows per apply request. A refusal preserves prior work; correct the file or explicitly review the provider budget and retry.</p>
    <p>${health.limits.qualification} No hosted 200-person performance promise is made here. Beam provider charges: USD 0.00; provider accounts, Cloudflare hosting/storage/egress and licensed content are billed separately by their providers. Confirm their current quota, price and terms before use. OCR estimates and limits appear above; unknown bills never become a zero-cost success.</p>`)
}
