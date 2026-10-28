// OPS-001 on the page: the owner searches the audit by words, category, person and day range, downloads the same
// events as CSV, and appends a correction to an event. Nothing here edits or removes an event.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { CATEGORIES, auditCsv, auditFilters, auditLog } from '../audit'
import { memberNames } from '../people'
import { area, cellLabel, count, field, form, h, hidden, page, select, when } from './html'

export async function auditPage(env: Bindings, actor: Actor, url: URL) {
  const filters = auditFilters(url)
  const [log, names] = await Promise.all([auditLog(env, actor, filters), memberNames(env)])
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString()
  const returnTo = `/app/audit${query ? `?${query}` : ''}`
  const people = [...names].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  const body = h`<h1>Audit</h1><p class="lede">Every recorded decision and change, newest first: who made it, when, through which route, and the exact inputs. Events are never edited or removed; a correction is added beside the event it explains. Anonymous answers appear without the person, and practice runs are not recorded.</p>
<form class="card filters" method="get" action="/app/audit">
<div>${field('Search', 'q', { value: filters.q, required: false, hint: 'Words in the action, subject, inputs or person.' })}</div>
<div>${select('Category', 'category', Object.entries(CATEGORIES).map(([value, category]) => ({ value, label: category.label })), filters.category, { required: false, blank: 'Every category' })}</div>
<div>${select('Person', 'actor', people, filters.actor, { required: false, blank: 'Anyone' })}</div>
<div>${field('From', 'from', { type: 'date', value: filters.from, required: false })}</div>
<div>${field('To', 'to', { type: 'date', value: filters.to, required: false, hint: `Whole days in ${log.zone}, both included.` })}</div>
<div class="filter-actions"><button type="submit">Search</button><a href="/app/audit.csv${query ? `?${query}` : ''}" download>Download CSV</a></div>
</form>
<p class="summary"><strong>${count(log.events.length)} ${log.events.length === 1 ? 'event' : 'events'}</strong>${log.events.length === 1000 ? ' · the newest 1,000; narrow the search for older ones' : ''}</p>
<section class="card table-card"><div class="table-wrap"><table class="stacked">
<thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th><th scope="col">Inputs</th></tr></thead>
<tbody>${log.events.length ? log.events.map(event => h`<tr>
<td class="nowrap">${cellLabel('When')}${when(event.at, log.zone)}<br><span class="muted">event ${event.id}</span></td>
<td>${cellLabel('Who')}${event.actorName}${event.via ? h`<br><span class="muted">${event.via.kind === 'agent_door' ? `through the company agent door${event.via.approvers?.length ? ` · approved by ${event.via.approvers.map(person => person.name).join(', ')}` : ''}` : event.via.kind === 'application_credential' ? `through application credential “${event.via.credential}” issued by ${event.via.delegatedBy}` : `through an agent’s preparation credential delegated by ${event.via.delegatedBy}`}</span>` : ''}</td>
<td>${cellLabel('What')}<code>${event.action}</code><br><span class="muted">${event.subjectName ? `${event.subjectName} · ` : ''}${event.subject}</span>${event.automatic ? h`<br><span class="muted">Automatic: ${event.automatic}</span>` : ''}
${event.corrections.map(correction => h`<p class="flash" role="note">Correction ${when(correction.at, log.zone)} by ${correction.by}: ${correction.explanation}</p>`)}
${actor.owner ? h`<details><summary>Add a correction</summary>${form('audit.correct', returnTo, [hidden('event', event.id), area('Explanation', 'explanation')], 'Add correction', { secondary: true })}</details>` : ''}</td>
<td>${cellLabel('Inputs')}<code class="wrap">${JSON.stringify(event.detail)}</code></td>
</tr>`) : h`<tr><td colspan="4" class="muted">No events match this search.</td></tr>`}</tbody></table></div></section>`
  return page('Audit', actor, body, { current: '/app/audit', url, wide: true })
}

export async function auditCsvResponse(env: Bindings, actor: Actor, url: URL) {
  return new Response(auditCsv(await auditLog(env, actor, auditFilters(url))), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="beam-audit.csv"', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
}
