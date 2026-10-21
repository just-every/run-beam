// Saved report selections, with no evidence or learner-record links in the shared view.
import type { Bindings } from '../../auth.server'
import { isManager, type Actor } from '../actor'
import { listCourses } from '../courses'
import { requirements } from '../external'
import { all, one } from '../core'
import { DASHBOARD_FIELDS, DASHBOARD_LABELS, dashboardCsv, dashboardManagement, linkDashboard, listDashboards, readDashboard } from '../dashboards'
import type { Input } from '../input'
import { reportFilters, STATUSES } from '../report'
import { permits, teamScope } from '../scope'
import { formatInstant } from '../time'
import { cellLabel, checks, field, form, h, hidden, page, select } from './html'

const protect = (response: Response, restricted = true) => {
  response.headers.set('cache-control', 'no-store')
  response.headers.set('referrer-policy', restricted ? 'no-referrer' : 'same-origin')
  response.headers.set('x-robots-tag', 'noindex, nofollow')
  return response
}
const current = '/app/reports'
async function filterNames(env: Bindings, filters: {course: string; team: string; status: string}) {
  const [course, team] = await Promise.all([
    filters.course ? one<{name: string}>(env, 'SELECT title AS name FROM beam_courses WHERE id=? UNION SELECT name FROM beam_external_requirements WHERE id=?', filters.course, filters.course) : null,
    filters.team ? one<{name: string}>(env, 'SELECT name FROM beam_teams WHERE id=?', filters.team) : null,
  ])
  return `Course: ${filters.course ? course?.name ?? 'unavailable' : 'all'} · Team: ${filters.team ? team?.name ?? 'unavailable' : 'all'} · Status: ${filters.status}`
}

export async function dashboardsPage(env: Bindings, actor: Actor, url: URL) {
  const dashboards = await listDashboards(env, actor), filters = reportFilters(url)
  const scope = teamScope(actor, 'reports')
  const teams = permits(actor, 'reports') ? await all(env, 'SELECT id, name FROM beam_teams WHERE (? IS NULL OR id IN (SELECT value FROM json_each(?))) ORDER BY name', scope, scope) : []
  const units = isManager(actor) || actor.grants.reports ? null : actor.adminUnits
  const courses = permits(actor, 'reports') ? [...await listCourses(env, units ? { units } : undefined), ...(await requirements(env)).map(item => ({ id: item.id, title: item.name }))] : []
  const definitions = new Map(await Promise.all(dashboards.filter(item => item.available).map(async item => [item.id, await filterNames(env, item.filters)] as const)))
  const body = h`<h1>Saved dashboards</h1><p><a href="/app/reports">Training report</a></p>
<p>A dashboard saves its filters and fields. Each opening shows live data within both the creator’s and viewer’s current report access.</p>
<section class="card"><h2>Your dashboards</h2>${dashboards.length ? dashboards.map(item => h`<article><h3>${item.available ? h`<a href="/app/dashboards/${item.id}">${item.name}</a>` : item.name}</h3><p>${definitions.get(item.id) ?? 'Report scope is no longer available.'}</p><p>${item.fields.map(value => DASHBOARD_LABELS[value]).join(', ')}${item.available ? '' : ' · Report scope is no longer available.'}</p>${item.manageable ? form('dashboard.revoke', '/app/dashboards', hidden('dashboard', item.id), 'Revoke dashboard', { secondary: true }) : ''}</article>`) : h`<p>No saved dashboards are available.</p>`}</section>
${permits(actor, 'reports') ? h`<section class="card"><h2>Save a dashboard</h2>${form('dashboard.create', '/app/dashboards/{id}', h`
${field('Dashboard name', 'name')}
${select('Course', 'course', courses.map(course => ({ value: course.id, label: course.title })), filters.course, { required: false, blank: 'All courses' })}
${select('Team', 'team', teams.map(team => ({ value: team.id, label: team.name })), filters.team, { required: false, blank: 'All teams in your report scope' })}
${select('Status', 'status', STATUSES.map(status => ({ value: status, label: status })), filters.status)}
${checks('Fields to share', 'fields', DASHBOARD_FIELDS.map(value => ({ value, label: DASHBOARD_LABELS[value] })), [...DASHBOARD_FIELDS])}
<p class="muted">Only these fields can be shared. Private answers, practical evidence and evidence links are excluded.</p>`, 'Save dashboard')}</section>` : ''}`
  return protect(page('Saved dashboards', actor, body, { current, url }), false)
}

export async function dashboardPage(env: Bindings, actor: Actor, id: string, url: URL) {
  const report = await readDashboard(env, actor, id, url)
  const entry = (await listDashboards(env, actor)).find(item => item.id === id)
  const management = entry?.manageable && !url.searchParams.has('key') ? await dashboardManagement(env, actor, id) : null
  const definition = await filterNames(env, report.filters)
  const csv = `/app/dashboards/${id}.csv${url.searchParams.has('key') ? `?key=${encodeURIComponent(url.searchParams.get('key')!)}` : ''}`
  const value = (field: string, item: unknown) => item === null || item === undefined ? '—' : ['due', 'completedAt'].includes(field) ? formatInstant(Number(item), 'UTC') : String(item)
  const body = h`<h1>${report.name}</h1><p><a href="/app/dashboards">Saved dashboards</a></p>
<p><strong>Live data · not a snapshot.</strong> As of ${formatInstant(report.asOf, 'UTC')} UTC.</p>
<p>Saved filters: ${definition}</p><p>Selected fields: ${report.fields.map(field => DASHBOARD_LABELS[field]).join(', ')}.</p>
<p><a href="${csv}" download>Download selected fields as CSV</a></p>
<section class="card table-card"><div class="table-wrap"><table class="stacked"><thead><tr>${report.fields.map(field => h`<th scope="col">${DASHBOARD_LABELS[field]}</th>`)}</tr></thead><tbody>${report.rows.length ? report.rows.map(row => h`<tr>${report.fields.map(field => h`<td>${cellLabel(DASHBOARD_LABELS[field])}${value(field, row[field])}</td>`)}</tr>`) : h`<tr><td colspan="${report.fields.length}">No training matches the saved filters.</td></tr>`}</tbody></table></div></section>
${management ? h`<section class="card"><h2>Share this dashboard</h2><p>Viewers must sign in and already have report access. Sharing grants no new authority.</p>
${form('dashboard.share', `/app/dashboards/${id}`, h`${hidden('dashboard', id)}${field('Viewer work email', 'viewerEmail', { type: 'email' })}`, 'Add named viewer')}
<h3>Create a restricted link</h3><p>Only the named signed-in viewer can use it, for at most 90 days. Copy the link when it appears; it is shown once.</p>
<form method="post" action="/app/dashboards/link">${hidden('dashboard', id)}${field('Viewer work email', 'viewerEmail', { type: 'email' })}${field('Expires at (UTC)', 'expiresAt', { type: 'datetime-local', hint: 'Choose a future time within 90 days.' })}<button type="submit">Create restricted link</button></form>
<h3>Viewers and links</h3>${management.shares.length ? management.shares.map(share => h`<article><p><strong>${share.viewerName}</strong> · ${share.kind === 'link' ? 'Restricted link' : 'Named viewer'} · ${share.revokedAt ? 'revoked' : share.restoredAt ? 'restored from an archive: no longer works, create a new link' : share.expiresAt && share.expiresAt <= Date.now() ? 'expired' : 'active'}${share.expiresAt ? ` · expires ${formatInstant(share.expiresAt, 'UTC')}` : ''}</p>${share.revokedAt ? '' : form('dashboard.share.revoke', `/app/dashboards/${id}`, hidden('share', share.id), 'Revoke access', { secondary: true })}</article>`) : h`<p>No viewers or links yet.</p>`}
${form('dashboard.revoke', '/app/dashboards', hidden('dashboard', id), 'Revoke entire dashboard', { secondary: true })}</section>` : ''}`
  return protect(page(report.name, actor, body, { current, url, wide: true }), url.searchParams.has('key'))
}

/** Special form response: the opaque URL is displayed once and never persisted in plaintext. */
export async function dashboardLinkPage(env: Bindings, actor: Actor, input: Input, url: URL) {
  const created = await linkDashboard(env, actor, input)
  const link = new URL(created.url, env.AUTH_ORIGIN).href
  return protect(page('Restricted dashboard link', actor, h`<h1>Restricted dashboard link</h1><p>Copy this link now. It is shown once. The named viewer must sign in and retain report access.</p><p class="dashboard-link"><a href="${link}">${link}</a></p><p>Expires ${formatInstant(created.expiresAt, 'UTC')}.</p><p><a href="/app/dashboards/${created.dashboard}">Back to dashboard</a></p>`, { current, url }))
}

export async function dashboardCsvResponse(env: Bindings, actor: Actor, id: string, url: URL) {
  const report = await readDashboard(env, actor, id, url)
  return protect(new Response(dashboardCsv(report), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="beam-dashboard.csv"', 'x-content-type-options': 'nosniff' } }))
}
