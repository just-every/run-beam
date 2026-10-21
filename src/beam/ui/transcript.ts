// REPORT-003 on the page: a person's transcript, its definitions (time zone, as-of instant, what it includes and how
// many entries) and its CSV, which carries the same entries with the definitions on every row and formulas inert.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { cell } from '../report'
import { transcript, transcriptDetail } from '../transcript'
import { XLSX_TYPE, workbook } from '../xlsx'
import { backLink, cellLabel, count, h, page, when } from './html'

export async function transcriptPage(env: Bindings, actor: Actor, memberId: string, url: URL) {
  const view = await transcript(env, actor, memberId)
  const body = h`${backLink(`/app/records/${memberId}`, view.member.name)}<h1>Transcript: ${view.member.name}</h1>
<p class="subtitle">${count(view.count)} ${view.count === 1 ? 'entry' : 'entries'}, all of them · times in ${view.zone} · as of ${when(view.asOf, view.zone)} · <a href="/app/records/${memberId}/transcript.csv" download>Download CSV</a> · <a href="/app/records/${memberId}/transcript.xlsx" download>Download XLSX</a></p>
<section class="card table-card"><div class="table-wrap"><table class="stacked"><thead><tr><th scope="col">When</th><th scope="col">What</th><th scope="col">Course and revision</th><th scope="col">Detail</th><th scope="col">By</th></tr></thead>
<tbody>${view.entries.length ? view.entries.map(entry => h`<tr><td class="nowrap">${cellLabel('When')}${when(entry.at, view.zone)}</td><td>${cellLabel('What')}${entry.kind}</td><td>${cellLabel('Course and revision')}${entry.course}${entry.revision ? ` — revision ${entry.revision}` : ''}</td><td>${cellLabel('Detail')}${entry.detail}${entry.lineage ? h`<details><summary>Attendance record lineage</summary><p class="muted">${entry.lineage}</p></details>` : ''}</td><td>${cellLabel('By')}${entry.by || '—'}</td></tr>`) : h`<tr><td colspan="5" class="muted">Nothing recorded yet.</td></tr>`}</tbody></table></div></section>
<p class="muted foot-note">Imported history is a record from a previous system, not a Beam assessment. A completion is what happened against an exact revision, not a statement of competence.</p>`
  return page('Transcript', actor, body, { url, wide: true })
}

export async function transcriptCsvResponse(env: Bindings, actor: Actor, memberId: string) {
  const view = await transcript(env, actor, memberId)
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: view.zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const header = ['Person', 'As of (UTC)', 'Time zone', 'Included', 'At (UTC)', `At (${view.zone})`, 'Kind', 'Course', 'Revision', 'Detail', 'By', 'Record id']
  const lines = view.entries.map(entry => [view.member.name, new Date(view.asOf).toISOString(), view.zone, view.filters, new Date(entry.at).toISOString(), local.format(entry.at), entry.kind, entry.course, entry.revision ?? '', transcriptDetail(entry), entry.by, entry.record])
  const csv = [header, ...lines].map(line => line.map(cell).join(',')).join('\r\n') + '\r\n'
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="beam-transcript.csv"', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
}

/** The same entries as a workbook, with a Definitions sheet. */
export async function transcriptXlsxResponse(env: Bindings, actor: Actor, memberId: string) {
  const view = await transcript(env, actor, memberId)
  const bytes = workbook([
    { name: 'Transcript', rows: [['At (UTC)', 'Kind', 'Course', 'Revision', 'Detail', 'By', 'Record id'], ...view.entries.map(entry => [new Date(entry.at).toISOString(), entry.kind, entry.course, entry.revision ?? '', transcriptDetail(entry), entry.by, entry.record])] },
    { name: 'Definitions', rows: [['Item', 'Value'], ['Person', view.member.name], ['As of (UTC)', new Date(view.asOf).toISOString()], ['Business time zone', view.zone], ['Included', view.filters], ['Entries', view.count]] },
  ])
  return new Response(bytes, { headers: { 'content-type': XLSX_TYPE, 'content-disposition': 'attachment; filename="beam-transcript.xlsx"', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
}
