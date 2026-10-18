// Move-in page: dry-run preview of a TalentLMS records export, apply bound to
// the reviewed fingerprint, import journal with undo, and imported history.
import type { Bindings } from '../../auth.server'
import { requireOwner, type Actor } from '../actor'
import { listCourses } from '../courses'
import type { Input } from '../input'
import { importJobs, importedHistory, previewImport, type Preview } from '../movein/talentlms'
import { business, memberNames } from '../people'
import { formatDay } from '../time'
import { backLink, card, count, field, fileField, form, h, hidden, page, select, when, type Html } from './html'

const JOB_STATES: Record<string, string> = { queued: 'Waiting to apply', applying: 'Applying', completed: 'Applied', failed: 'Stopped before finishing', undoing: 'Undoing', undone: 'Undone', rolled_back: 'Rolled back' }

const DATE_FORMATS = [{ value: 'DMY', label: 'Day/month/year (31/12/2025)' }, { value: 'MDY', label: 'Month/day/year (12/31/2025)' }, { value: 'YMD', label: 'Year-month-day (2025-12-31)' }]

export async function importPage(env: Bindings, actor: Actor, url: URL) {
  requireOwner(actor)
  const [jobs, history, names] = await Promise.all([importJobs(env, actor), importedHistory(env, actor), memberNames(env)])
  const uploads = [1, 2, 3].map(slot => h`<fieldset><legend>Course report ${slot} (.xlsx)</legend>${field('TalentLMS course ID', `report${slot}Course`, { required: false })}${fileField('Report file', `report${slot}`, { accept: '.xlsx' })}</fieldset>`)
  const zone = actor.business ? (await business(env))!.timezone : 'UTC'
  const body = h`<h1>Move in from TalentLMS</h1><p class="lede">Bring your course list and course reports across as historical records. Nothing is written until you have reviewed a preview. Imported completions stay labeled as history from TalentLMS; they are not Beam assessments and do not complete current assignments. Course content moves separately: rebuild lessons from your own source documents.</p>
<section class="card settings"><h2>1. Preview</h2><form method="post" action="/app/import/preview" enctype="multipart/form-data">${fileField('Course list (.csv)', 'courseList', { required: true, accept: '.csv' })}${uploads}${select('Dates in these files', 'dateFormat', DATE_FORMATS, 'DMY')}<button type="submit">Preview import</button></form></section>
${card('Imports', jobs.length ? h`<ul class="rows">${[...new Map(jobs.map(job => [job.id, job])).values()].map(job => h`<li class="row"><span class="row-text"><span class="row-title">Imported ${when(job.appliedAt, zone)}</span><span class="row-meta">${JOB_STATES[job.state] ?? job.state} · ${count(job.effects)} ${job.effects === 1 ? 'record' : 'records'}${job.retained.length ? h` · ${count(job.retained.length)} kept because ${job.retained.length === 1 ? 'it was' : 'they were'} reviewed after import` : ''}</span>${job.state === 'completed' ? form('import.job', '/app/import', [hidden('job', job.id), hidden('action', 'undo')], 'Undo this import', { secondary: true }) : ''}</span></li>`)}</ul>` : h`<p class="muted">No imports yet.</p>`, { icon: 'upload' })}
${card('Imported history', h`<ul class="rows">${history.filter(row => row.kind === 'completion').map(row => h`<li class="row"><span class="row-text"><span class="row-title">${row.name || row.email} — ${row.sourceCourseName}</span><span class="row-meta">completed ${formatDay(row.completedOn)} <span class="tag">${row.source} history</span>${row.member ? '' : h` <span class="tag">no matching person</span>`}${row.accepted ? h` <span class="tag">reviewed by ${names.get(row.accepted.by)}</span>` : ''}</span>${row.accepted ? '' : form('history.accept', '/app/import', [hidden('history', row.id), field('Review note', 'note')], 'Mark reviewed', { secondary: true })}</span></li>`)}</ul>${history.length ? '' : h`<p class="muted">Nothing imported.</p>`}`, { icon: 'document' })}`
  return page('Move in', actor, body, { current: '/app/import', url })
}

export async function previewPage(env: Bindings, actor: Actor, input: Input, url: URL) {
  const preview = await previewImport(env, actor, input)
  const courses = await listCourses(env)
  const carried = (except: string[] = []): Html[] => Object.entries(preview.carry).filter(([name]) => !except.some(prefix => name.startsWith(prefix))).map(([name, value]) => hidden(name, value))
  const body = h`${backLink('/app/import', 'Move in')}<h1>Import preview</h1><p class="subtitle"><mark class="hl">This is a dry run: nothing has been written.</mark></p>
<div class="grid"><section class="card"><h2>Summary</h2>${summary(preview)}</section>
<section class="card"><h2>People</h2><p>${preview.identities.matched.length} matched by email.</p>${preview.identities.unresolved.length ? h`<p>Not matched (kept as unresolved history):</p><ul>${preview.identities.unresolved.map(person => h`<li>${person.name}${person.email ? ` <${person.email}>` : ''}</li>`)}</ul>` : ''}</section></div>
${preview.changed.length ? h`<section class="card"><h2>Imported earlier with other details</h2><p>These records came across in an earlier import before something changed, for example a person who has since joined. Apply refuses this preview until you undo that earlier import on the Move in page.</p><ul>${preview.changed.map(line => h`<li>${line}</li>`)}</ul></section>` : ''}
${preview.duplicates.length ? h`<section class="card"><h2>Duplicates</h2><ul>${preview.duplicates.map(line => h`<li>${line}</li>`)}</ul></section>` : ''}
${preview.attention.length ? h`<section class="card"><h2>Needs attention</h2><ul>${preview.attention.map(item => h`<li>${item.location}: ${item.reason}</li>`)}</ul></section>` : ''}
<section class="card"><h2>Gaps</h2><ul>${preview.gaps.map(gap => h`<li>${gap}</li>`)}</ul></section>
<section class="card"><h2>Course mapping</h2><p class="muted">Optional: link each TalentLMS course to the Beam course that replaces it. History stays labeled as TalentLMS history either way.</p><form method="post" action="/app/import/preview">${carried(['map_'])}${preview.courses.map(course => select(`${course.name}${course.code ? ` (${course.code})` : ''}`, `map_${course.sourceId}`, courses.map(option => ({ value: option.id, label: option.title })), course.mappedTo ?? '', { required: false, blank: 'Not mapped' }))}<button type="submit" class="secondary">Preview again with this mapping</button></form></section>
<section class="card"><h2>2. Apply</h2><p>Applies exactly this preview. If anything changed since, you will be asked to preview again.</p>${form('import.apply', '/app/import', [...carried(), hidden('fingerprint', preview.fingerprint)], 'Apply import')}</section>`
  return page('Import preview', actor, body, { current: '/app/import', url })
}

function summary(preview: Preview) {
  const lines = [[preview.courses.length, 'course in the list', 'courses in the list'], [preview.completions, 'historical completion', 'historical completions'], [preview.identities.unresolved.length, 'person not matched', 'people not matched'], [preview.duplicates.length, 'duplicate', 'duplicates'], [preview.attention.length, 'row needing attention', 'rows needing attention']] as const
  return h`<ul class="rows">${lines.map(([value, one, many]) => h`<li class="row"><span class="row-text"><span class="row-title">${count(value)} ${value === 1 ? one : many}</span></span></li>`)}</ul>`
}
