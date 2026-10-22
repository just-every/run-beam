// TalentLMS originals, reviewed retained plans, and one shared import history.
import type { Bindings } from '../../auth.server'
import { requireOwner, type Actor } from '../actor'
import { listCourses } from '../courses'
import { insist } from '../core'
import type { Input } from '../input'
import { importJobs, importSettings, legacyUndo } from '../movein/door'
import { operatorCall } from '../movein/client'
import { importedHistory } from '../movein/talentlms'
import { business, memberNames } from '../people'
import { formatDay, usZone } from '../time'
import { backLink, card, count, field, fileField, form, h, hidden, page, select, when } from './html'

const JOB_STATES: Record<string, string> = {rolling_back: 'Undoing unfinished import', queued: 'Waiting to apply', applying: 'Applying', completed: 'Applied', failed: 'Stopped before finishing', undoing: 'Undoing', undone: 'Undone', rolled_back: 'Rolled back'}
const DATE_FORMATS = [{value: 'DMY', label: 'Day/month/year (31/12/2025)'}, {value: 'MDY', label: 'Month/day/year (12/31/2025)'}, {value: 'YMD', label: 'Year-month-day (2025-12-31)'}]
const US_FIRST = [DATE_FORMATS[1], DATE_FORMATS[0], DATE_FORMATS[2]]
const doorForm = (action: string, fields: ReturnType<typeof hidden>[], label: string) => h`<form method="post" action="/app/import/${action}">${fields}<button type="submit" class="secondary">${label}</button></form>`
const progressRedirect = () => new Response(null, {status: 303, headers: {location: '/app/import', 'cache-control': 'no-store'}})
const planFields = (job: {planId: string; fingerprint: string}) => [hidden('planId', job.planId), hidden('reviewedFingerprint', job.fingerprint)]
const labels: Record<string, string> = {sourceRecords: 'Source records', created: 'Planned additions', updated: 'Planned replacements', unchanged: 'Unchanged records', gone: 'Missing source records', present: 'Present', explained: 'Explained', nativeTargets: 'Native records', conflicts: 'Conflicts or rejected records'}
const label = (key: string) => labels[key] ?? key.replace(/[A-Z]/g, letter => ' ' + letter.toLowerCase())
const counts = (values: Record<string, unknown>) => h`<dl>${Object.entries(values).filter(([, value]) => typeof value === 'number').map(([key, value]) => h`<dt>${label(key)}</dt><dd>${String(value)}</dd>`)}</dl>`
const recordLabel = (kind: string, id: string) => `${kind.replaceAll('-', ' ')} · ${id}`
const reconcileDetails = (result: any) => card('Reconciliation', h`${counts(result.counts)}<ul>${result.sourceIds.map((row: any) => h`<li class="import-records">${recordLabel(row.kind, row.sourceId)} — ${row.status}${row.reason ? h`: ${row.reason}` : ''}${row.conflicts?.length ? h`<ul>${row.conflicts.map((conflict: string) => h`<li class="import-records">Changed native record: ${conflict}</li>`)}</ul>` : ''}</li>`)}</ul><details><summary>Reviewed source identity</summary><p class="import-records">Fingerprint: ${result.fingerprint}</p><p class="import-records">Original bundle SHA-256: ${result.bundleSha256}</p></details>`)


export async function importPage(env: Bindings, actor: Actor, url: URL) {
  requireOwner(actor)
  const [jobs, history, names, settings, courses] = await Promise.all([importJobs(env, actor), importedHistory(env, actor), memberNames(env), importSettings(env, actor), listCourses(env)])
  const uploads = [1, 2, 3].map(slot => h`<fieldset><legend>Course report ${slot} (.xlsx)</legend>${field('TalentLMS course ID', `report${slot}Course`, {required: false})}${fileField('Report file', `report${slot}`, {accept: '.xlsx'})}${select('Beam course that replaces it (optional)', `report${slot}Mapping`, courses.map(course => ({value: course.id, label: course.title})), '', {required: false, blank: 'Not mapped'})}</fieldset>`)
  const zone = actor.business ? (await business(env))!.timezone : 'UTC'
  const body = h`<h1>Move in from TalentLMS</h1><p class="lede">Bring your course list and course reports across as historical records. Nothing is written until you have reviewed a preview. Imported completions stay labeled as history from TalentLMS; they are not Beam assessments and do not complete current assignments. Course content moves separately: rebuild lessons from your own source documents.</p>
<section class="card settings"><h2>1. Preview</h2><form method="post" action="/app/import/preview" data-import-upload>${fileField('Course list (.csv)', 'courseList', {required: true, accept: '.csv'})}${uploads}${select('Dates in these files', 'dateFormat', usZone(zone) ? US_FIRST : DATE_FORMATS, usZone(zone) ? 'MDY' : 'DMY')}<label><input type="checkbox" name="catchup" value="true"> Update the previous TalentLMS import with this export</label><button type="submit">Preview import</button><p data-import-progress role="status" aria-live="polite"></p><noscript><p>Enable JavaScript to upload files in bounded parts.</p></noscript></form></section>
${card('Imports', jobs.length ? h`<ul class="rows">${jobs.map(job => h`<li class="row"><span class="row-text"><span class="row-title">Imported ${when(job.appliedAt, zone)}</span><span class="row-meta">${JOB_STATES[job.state] ?? job.state} · ${count(job.effects)} source records · ${job.caption}${job.failureCode ? h` · ${job.failureCode}` : ''}${job.retained.length ? h` · ${count(job.retained.length)} kept after later review` : ''}</span>${!job.legacy && ['queued', 'applying'].includes(job.state) ? doorForm('apply', planFields(job), 'Continue reviewed import') : ''}${job.legacy ? (!['undone', 'rolled_back'].includes(job.state) ? doorForm('undo', [hidden('legacyJobId', job.id)], ['undoing', 'rolling_back'].includes(job.state) ? 'Continue undo' : 'Undo legacy import') : '') : (['completed', 'failed', 'undoing'].includes(job.state) ? doorForm('undo', [hidden('planId', job.planId)], job.state === 'undoing' ? 'Continue undo' : 'Undo this import') : '')}${!job.legacy && job.state === 'completed' ? doorForm('reconcile', [hidden('planId', job.planId)], 'Check native records') : ''}</span></li>`)}</ul>` : h`<p class="muted">No imports yet.</p>`)}
${card('Business imports', h`<p>Business grants are ${settings.enabled ? 'enabled' : 'disabled'}. Your own imports and undo remain available.</p>${form('import.settings', '/app/import', [hidden('enabled', settings.enabled ? 'false' : 'true')], settings.enabled ? 'Disable Business imports' : 'Enable Business imports', {secondary: true})}${form('import.settings', '/app/import', [hidden('enabled', settings.enabled ? 'true' : 'false'), field('Key ID to revoke permanently', 'revokeKey')], 'Revoke key', {secondary: true})}<p class="muted">Revoked keys stay revoked when imports are enabled again.${!settings.configured ? ' A trusted Business key ring has not been configured.' : ''}</p><p>Revoked keys: ${settings.revokedKeys.join(', ') || 'none'}.</p>`)}
${card('Imported history', h`<ul class="rows">${history.filter(row => row.kind === 'completion').map(row => h`<li class="row"><span class="row-text"><span class="row-title">${row.name || row.email} — ${row.sourceCourseName}</span><span class="row-meta">completed ${formatDay(row.completedOn)} <span class="tag">${row.source} history</span>${row.member ? '' : h` <span class="tag">no matching person</span>`}${row.accepted ? h` <span class="tag">reviewed by ${names.get(row.accepted.by)}</span>` : ''}</span>${row.accepted ? '' : form('history.accept', '/app/import', [hidden('history', row.id), field('Review note', 'note')], 'Mark reviewed', {secondary: true})}</span></li>`)}</ul>${history.length ? '' : h`<p class="muted">Nothing imported.</p>`}`)}`
  const response = page('Move in', actor, body, {current: '/app/import', url, script: '/app/import/client.js'})
  response.headers.set('Content-Security-Policy', response.headers.get('Content-Security-Policy') + "; connect-src 'self'")
  return response
}

export async function previewPage(env: Bindings, actor: Actor, input: Input, url: URL, request: Request) {
  requireOwner(actor)
  const preview = await operatorCall(env, request, 'plan', {uploadId: input.text('uploadId', {max: 100}), ...(input.flag('catchup') ? {catchup: true} : {})})
  const body = h`${backLink('/app/import', 'Move in')}<h1>Import preview</h1><p class="subtitle"><mark class="hl">No native records have been written. Original files and this plan are retained for review.</mark></p>
${card('Summary', counts(preview.summary))}
${card('Differences', h`<dl>${Object.entries(preview.differences as Record<string, string[]>).map(([key, values]) => h`<dt>${label(key)}</dt><dd>${values.length}${values.length ? h`<ul>${values.map(value => h`<li class="import-records">${value}</li>`)}</ul>` : ''}</dd>`)}</dl>`)}
${card('Rejections and diagnostics', h`<ul>${preview.rejected.map((row: any) => h`<li class="import-records">${row.sourceId}: ${row.reason}</li>`)}${preview.diagnostics.map((row: any) => h`<li class="import-records">${row.severity}: ${row.message}${row.location?.pointer ? h` · ${row.location.pointer}` : ''}</li>`)}</ul>${!preview.rejected.length && !preview.diagnostics.length ? h`<p>No rejected rows or parser diagnostics.</p>` : ''}`)}
${card('Gaps', h`<p>Progress, duplicate completions and non-completion timeline events remain explained omissions. Unmatched people remain unresolved history. Certificate files and course content move separately. Courses without reports carry no completions.</p>`)}
${card('2. Apply', h`<p>Review the counts, rejections and differences above. Apply uses exactly this retained plan and fingerprint.</p>${doorForm('apply', [hidden('planId', preview.planId), hidden('reviewedFingerprint', preview.fingerprint)], 'Apply reviewed import')}${doorForm('undo', [hidden('planId', preview.planId)], 'Discard this plan')}`)}`
  return page('Import preview', actor, body, {current: '/app/import', url})
}

export async function importProgressPage(env: Bindings, actor: Actor, input: Input, url: URL, request: Request, action: string) {
  requireOwner(actor)
  insist(['apply', 'reconcile', 'undo'].includes(action), 'not_found', 404)
  if (input.has('legacyJobId')) {
    insist(action === 'undo' && !input.has('planId') && !input.has('reviewedFingerprint'), 'legacy_import_undo_only', 400)
    const legacyJobId = input.text('legacyJobId', {max: 100})
    await legacyUndo(env, actor, legacyJobId)
    return progressRedirect()
  }
  const planId = input.text('planId', {max: 100})
  const reviewedFingerprint = action === 'apply' ? input.text('reviewedFingerprint', {max: 64}) : undefined
  const result = await operatorCall(env, request, action, {planId, ...(reviewedFingerprint ? {reviewedFingerprint} : {})})
  // The imports list reads the retained job state and offers Continue for a
  // bounded job. Reloading it must never replay apply or undo.
  if (action !== 'reconcile') return progressRedirect()
  return page('Native record check', actor, h`${backLink('/app/import', 'Move in')}<h1>Native record check</h1><p>${result.ok ? 'All source records are present or explained.' : 'Some native records differ from the import.'}</p>${reconcileDetails(result)}`, {current: '/app/import', url})
}
