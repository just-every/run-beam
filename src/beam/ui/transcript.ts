import { t, counted, localeNumber } from '../messages'
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
  const body = h`${backLink(`/app/records/${memberId}`, view.member.name)}<h1>${t(actor, 'Transcript: {name}', { name: view.member.name })}</h1>
<p class="subtitle">${t(actor, '{entries}, all of them · times in {zone} · as of {date}', { entries: counted(actor, 'entry', 'entries', view.count), zone: view.zone, date: when(view.asOf, view.zone, view.zone, actor.locale) })} · <a href="/app/records/${memberId}/transcript.csv" download>${t(actor, 'Download CSV')}</a> · <a href="/app/records/${memberId}/transcript.xlsx" download>${t(actor, 'Download XLSX')}</a></p>
<section class="card table-card"><div class="table-wrap"><table class="stacked"><thead><tr><th scope="col">${t(actor, 'When')}</th><th scope="col">${t(actor, 'What')}</th><th scope="col">${t(actor, 'Course and revision')}</th><th scope="col">${t(actor, 'Detail')}</th><th scope="col">${t(actor, 'By')}</th></tr></thead>
<tbody>${view.entries.length ? view.entries.map(entry => h`<tr><td class="nowrap">${cellLabel(t(actor, 'When'))}${when(entry.at, view.zone, view.zone, actor.locale)}</td><td>${cellLabel(t(actor, 'What'))}${t(actor, entry.kind)}</td><td>${cellLabel(t(actor, 'Course and revision'))}${entry.course}${entry.revision ? ` — ${t(actor, 'revision')} ${localeNumber(actor, entry.revision)}` : ''}</td><td>${cellLabel(t(actor, 'Detail'))}${entry.detail}${entry.lineage ? h`<details><summary>${t(actor, 'Attendance record lineage')}</summary><p class="muted">${entry.lineage.replace(/(^|; )([a-z ]+): /g, (_all, separator: string, label: string) => `${separator}${t(actor, label)}: `)}</p></details>` : ''}</td><td>${cellLabel(t(actor, 'By'))}${entry.by || '—'}</td></tr>`) : h`<tr><td colspan="5" class="muted">${t(actor, 'Nothing recorded yet.')}</td></tr>`}</tbody></table></div></section>
<p class="muted foot-note">${t(actor, 'Imported history is a record from a previous system, not a Beam assessment. A completion is what happened against an exact revision, not a statement of competence.')}</p>`
  return page(t(actor, 'Transcript'), actor, body, { url, wide: true })
}

export async function transcriptCsvResponse(env: Bindings, actor: Actor, memberId: string) {
  const view = await transcript(env, actor, memberId)
  const local = new Intl.DateTimeFormat(actor.locale, { timeZone: view.zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const header = ['Person', 'As of (UTC)', 'Time zone', 'Included', 'At (UTC)', t(actor, 'At ({zone})', { zone: view.zone }), 'Kind', 'Course', 'Revision', 'Detail', 'By', 'Record id'].map(label => t(actor, label))
  const lines = view.entries.map(entry => [view.member.name, new Date(view.asOf).toISOString(), view.zone, view.filters, new Date(entry.at).toISOString(), local.format(entry.at), entry.kind, entry.course, entry.revision ?? '', transcriptDetail(entry), entry.by, entry.record])
  const csv = [header, ...lines].map(line => line.map(cell).join(',')).join('\r\n') + '\r\n'
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="beam-transcript.csv"', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
}

/** The same entries as a workbook, with a Definitions sheet. */
export async function transcriptXlsxResponse(env: Bindings, actor: Actor, memberId: string) {
  const view = await transcript(env, actor, memberId)
  const bytes = workbook([
    { name: t(actor, 'Transcript'), rows: [['At (UTC)', 'Kind', 'Course', 'Revision', 'Detail', 'By', 'Record id'].map(label => t(actor, label)), ...view.entries.map(entry => [new Date(entry.at).toISOString(), entry.kind, entry.course, entry.revision ?? '', transcriptDetail(entry), entry.by, entry.record])] },
    { name: t(actor, 'Definitions'), rows: [[t(actor, 'Item'), t(actor, 'Value')], [t(actor, 'Person'), view.member.name], [t(actor, 'As of (UTC)'), new Date(view.asOf).toISOString()], [t(actor, 'Business time zone'), view.zone], [t(actor, 'Included'), t(actor, view.filters)], [t(actor, 'Entries'), view.count]] },
  ])
  return new Response(bytes, { headers: { 'content-type': XLSX_TYPE, 'content-disposition': 'attachment; filename="beam-transcript.xlsx"', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
}
