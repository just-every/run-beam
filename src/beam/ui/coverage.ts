// REPORT-001: the coverage page. Filters by team, role, location, course and status; totals that add up to the required
// count over the active roster; coverage by course, role, location, team and requirement (with each policy's effective
// date); then every required person and course with the evidence behind its status, linked to the person's record.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { all } from '../core'
import { COVERAGE_STATUSES, coverageFilters, coverageReport } from '../coverage'
import { business } from '../people'
import { teamScope } from '../scope'
import { formatDate, formatDay } from '../time'
import { card, cellLabel, count, field, form, h, hidden, page, pill, raw, select, type Html } from './html'

const LABELS: Record<string, string> = { all: 'All', current: 'Current', expiring: 'Expiring', overdue: 'Overdue', open: 'Open', deferred: 'Deferred', exempt: 'Exempt', missing: 'Missing' }
const KINDS: Record<string, string> = { path: 'Role path', audience: 'Audience', assignment: 'Assignment', external: 'External certificate' }
const GROUPS = [['course', 'Course'], ['role', 'Role'], ['location', 'Location'], ['team', 'Team'], ['requirement', 'Requirement']] as const

function evidence(row: any, zone: string): Html {
  const item = row.evidence
  if (!item) return h`${row.lapsed ? h`Expired ${formatDate(row.lapsed.expiresAt, zone)} (revision ${row.lapsed.revisionNumber})` : 'No record'}${row.importedHistory ? h`<br><span class="muted">${count(row.importedHistory)} imported history ${row.importedHistory === 1 ? 'row' : 'rows'}, not current learning</span>` : ''}`
  if (item.kind === 'completion') return h`Completed ${formatDate(item.completedAt, zone)}, revision ${item.revisionNumber}${item.expiresAt ? h`<br><span class="muted">expires ${formatDate(item.expiresAt, zone)}</span>` : ''}`
  if (item.kind === 'credit') return h`<strong>${item.label}</strong><br><span class="muted">completed ${formatDay(item.completedOn)}; credited until ${formatDate(item.expiresAt, zone)}. Decision by ${item.decision.approvedBy} on ${formatDate(item.decision.approvedAt, zone)}: ${item.decision.reason}</span>`
  if (item.kind === 'external') return h`External certificate ${item.certificate}${item.expiresAt ? h`<br><span class="muted">expires ${formatDate(item.expiresAt - 1, zone)}</span>` : ''}`
  return h`<a href="/app/learn/${item.assignment}">Revision ${item.revisionNumber}</a>, due ${formatDate(item.dueAt, item.timezone)}${item.exception ? h`<br><span class="muted">${item.exception.kind === 'exemption' ? 'exempt' : 'deferred'} through ${formatDay(item.exception.endsOn)} by ${item.exception.by}: ${item.exception.reason}</span>` : ''}${row.importedHistory ? h`<br><span class="muted">${count(row.importedHistory)} imported history ${row.importedHistory === 1 ? 'row' : 'rows'}, not current learning</span>` : ''}`
}

const counts = (entry: any) => COVERAGE_STATUSES.map(status => h`<td class="num"${entry[status] ? '' : raw(' data-empty')}>${cellLabel(LABELS[status])}${count(entry[status])}</td>`)

export async function coveragePage(env: Bindings, actor: Actor, url: URL) {
  const filters = coverageFilters(url), scope = teamScope(actor, 'reports')
  const [report, teams, zone] = await Promise.all([coverageReport(env, actor, filters),
    all(env, 'SELECT id, name FROM beam_teams WHERE (? IS NULL OR id IN (SELECT value FROM json_each(?))) ORDER BY name', scope, scope), business(env).then(row => row!.timezone)])
  const { roles, locations } = report.options
  const courses = report.groups.course.map((entry: any) => ({ value: entry.id, label: entry.label }))
  const link = (changes: Record<string, string>) => `/app/coverage?${new URLSearchParams(Object.entries({ ...filters, ...changes }).filter(([, value]) => value && value !== 'all')).toString()}`
  const s = report.summary
  const groupTable = (key: typeof GROUPS[number][0], heading: string) => {
    const entries = report.groups[key] as any[]
    if (!entries.length) return ''
    const filterKey = key
    const linkable = (entry: any) => filterKey && entry.id && entry.id !== '-'
    return h`<section class="card table-card"><h2>By ${heading.toLowerCase()}</h2><div class="table-wrap"><table class="coverage-table stacked"><thead><tr><th scope="col">${heading}</th><th scope="col" class="num">Required</th>${COVERAGE_STATUSES.map(status => h`<th scope="col" class="num">${LABELS[status]}</th>`)}</tr></thead>
<tbody>${entries.map(entry => h`<tr><th scope="row">${linkable(entry) ? h`<a href="${link({ [filterKey!]: entry.id })}">${entry.label}</a>` : entry.label}${key === 'requirement' ? h`<br><span class="muted">${KINDS[entry.kind]}${entry.revision ? ` revision ${entry.revision}` : ''}${entry.effectiveAt ? `, effective ${formatDate(entry.effectiveAt, zone)}` : ''}</span>` : ''}</th><td class="num">${cellLabel('Required')}${count(entry.required)}</td>${counts(entry)}</tr>`)}</tbody></table></div></section>`
  }
  const body = h`<h1>Compliance coverage</h1>
<p><a href="/app/reports">Training report</a> · <a href="/app/manage">Manage training</a></p>
<form class="card filters" method="get" action="/app/coverage">
<div>${select('Team', 'team', teams.map(team => ({ value: team.id, label: team.name })), filters.team, { required: false, blank: 'All teams' })}</div>
<div>${select('Role', 'role', roles.map(role => ({ value: role, label: role })), filters.role, { required: false, blank: 'All roles' })}</div>
<div>${select('Location', 'location', locations.map(location => ({ value: location, label: location })), filters.location, { required: false, blank: 'All locations' })}</div>
<div>${select('Course', 'course', courses, filters.course, { required: false, blank: 'All courses' })}</div>
<div>${field('Policy effective by', 'effective', { type: 'date', value: filters.effective, required: false })}</div>
<fieldset class="radios"><legend>Status</legend>${['all', ...COVERAGE_STATUSES].map(status => h`<label class="check"><input type="radio" name="status" value="${status}"${status === filters.status ? raw(' checked') : ''}> ${LABELS[status]}</label>`)}</fieldset>
${filters.requirement ? hidden('requirement', filters.requirement) : ''}<div class="filter-actions"><button type="submit">Apply</button>${filters.requirement ? h` <a href="${link({ requirement: '' })}">All requirements</a>` : ''}</div>
</form>
<p class="summary"><strong>${count(s.required)} required</strong> for ${count(report.people)} of ${count(report.activeRoster)} active ${report.activeRoster === 1 ? 'person' : 'people'} · ${count(s.current)} current · ${count(s.expiring)} expiring in ${report.window.days} days · ${count(s.overdue)} overdue · ${count(s.open)} open · ${count(s.deferred)} deferred · ${count(s.exempt)} exempt · ${count(s.missing)} missing</p>
<p class="muted">As of ${formatDate(report.asOf, zone)}. Only active employees count; each person counts once per course under every requirement that applies, and the statuses add up to the required total.</p>
${GROUPS.map(([key, heading]) => groupTable(key, heading))}
<section class="card table-card"><h2>People and requirements (${count(report.rows.length)})</h2><div class="table-wrap"><table class="report stacked">
<thead><tr><th scope="col">Person</th><th scope="col">Course</th><th scope="col">Status</th><th scope="col">Required by</th><th scope="col">Evidence</th></tr></thead>
<tbody>${report.rows.length ? report.rows.map((row: any) => h`<tr>
<td class="nowrap">${cellLabel('Person')}<a href="/app/records/${row.learner}">${row.learnerName}</a><br><span class="muted">${[row.role, row.location].filter(Boolean).join(' · ') || '—'}</span></td>
<td class="cell-plain">${cellLabel('Course')}${row.courseTitle}</td>
<td class="cell-status">${cellLabel('Status')}${pill(row.status, LABELS[row.status])}</td>
<td>${cellLabel('Required by')}${row.requirements.map((item: any, index: number) => h`${index ? h`<br>` : ''}${KINDS[item.kind]}${item.kind === 'assignment' ? '' : `: ${item.name}`}${item.revision ? ` (revision ${item.revision})` : ''}${item.effectiveAt ? h` <span class="muted">effective ${formatDate(item.effectiveAt, zone)}</span>` : ''}`)}</td>
<td>${cellLabel('Evidence')}${evidence(row, zone)}</td>
</tr>`) : h`<tr><td colspan="5" class="muted">No requirement matches these filters.</td></tr>`}</tbody></table></div></section>
${actor.owner && !actor.viewAs ? card('Expiring window', h`<p class="muted">Current records expiring within this many days count as expiring here, in the training report and in Manage training.</p>${form('report.window', '/app/coverage', [hidden('version', report.window.version), field('Days', 'days', { type: 'number', value: report.window.days })], 'Save window', { secondary: true })}`) : ''}
<p class="muted foot-note">Imported history and credited people are labelled. A credit counts as current until its credited expiry; it is not a Beam completion or a statement of competence.</p>`
  return page('Compliance coverage', actor, body, { current: '/app/reports', url, wide: true })
}
