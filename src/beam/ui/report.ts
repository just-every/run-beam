// The manager's training report and its CSV download, which carries the same rows.
import type { Bindings } from '../../auth.server'
import { isManager, type Actor } from '../actor'
import { teamScope } from '../scope'
import { listCourses } from '../courses'
import { requirements } from '../external'
import { all, one } from '../core'
import { business } from '../people'
import { reportCsv, reportFilters, reportWorkbook, trainingReport } from '../report'
import { XLSX_TYPE } from '../xlsx'
import { formatClock, formatDate, formatDay, zoneName } from '../time'
import { cellLabel, count, h, page, pill, raw, select } from './html'

const STATUS_LABELS: Record<string, string> = { all: 'All', open: 'Open', overdue: 'Overdue', completed: 'Completed', expiring: 'Expiring', cancelled: 'Canceled', deferred: 'Deferred', exempt: 'Exempt', missing: 'Missing' }

// AUTO-006: a deferral or exemption beside the due date, while it holds and after it ends.
const exceptionNote = (row: any) => row.exception ? h`<br><span class="muted">${row.exception.kind === 'exemption' ? 'exempt' : 'deferred'} through ${formatDay(row.exception.endsOn)}${row.exception.active ? '' : ' (ended)'} by ${row.exception.by}: ${row.exception.reason}</span>` : ''

// A cell that shows only a dash is marked, so the stacked 390 view can leave it out.
const empty = (value: unknown) => value ? '' : raw(' data-empty')

function practical(row: any) {
  if (!row.practical) return '—'
  if (row.practical.state === 'awaiting_review') return 'waiting for the assessor'
  return `${row.practical.state === 'accepted' ? 'accepted' : 'returned'} by ${row.practical.assessor}`
}

// AUTO-009: the access window beside the original due date, with any extension and its reason.
function access(row: any, zone: string) {
  if (!row.accessOpensAt && !row.accessClosesAt) return ''
  return h`<br><span class="muted">${row.accessOpensAt ? `access opens ${formatDate(row.accessOpensAt, zone)}${row.accessClosesAt ? ', ' : ''}` : 'access '}${row.accessClosesAt ? `through ${formatDate(row.accessClosesAt - 1, zone)}` : ''}${row.extension ? ` · extended ${row.extension.days} ${row.extension.days === 1 ? 'day' : 'days'} by ${row.extension.by}: ${row.extension.reason}` : ''}</span>`
}

export async function reportPage(env: Bindings, actor: Actor, url: URL) {
  const filters = reportFilters(url)
  // A manager filters by their own teams (ORG-004); a learning administrator by their units' courses and teams (ORG-002).
  const units = isManager(actor) || actor.grants.reports ? null : actor.adminUnits, scope = teamScope(actor, 'reports')
  const [report, courses, teams, zone] = await Promise.all([trainingReport(env, actor, filters), listCourses(env, units && { units }).then(async list => [...list, ...(await requirements(env)).map(item => ({ id: item.id, title: item.name, group: 'External certificates' }))]), all(env, 'SELECT id, name FROM beam_teams WHERE (? IS NULL OR id IN (SELECT value FROM json_each(?))) ORDER BY name', scope, scope), business(env).then(value => value!.timezone)])
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value && value !== 'all')).toString()
  const s = report.summary
  const body = h`<h1>Training report</h1>
<p><a href="/app/dashboards${query ? `?${query}` : ''}">Saved dashboards · save or share this selection</a> · <a href="/app/coverage">Compliance coverage by role, location and team</a> · <a href="/app/quality">Course quality and effort</a></p>
<form class="card filters" method="get" action="/app/reports">
<div>${select('Course', 'course', courses.map((course: any) => ({ value: course.id, label: course.title, group: course.group })), filters.course, { required: false, blank: 'All courses' })}</div>
<div>${select('Team', 'team', teams.map(team => ({ value: team.id, label: team.name })), filters.team, { required: false, blank: 'All teams' })}</div>
<fieldset class="radios"><legend>Status</legend>${['all', 'open', 'overdue', 'completed', 'expiring', 'deferred', 'exempt', 'missing'].map(status => h`<label class="check"><input type="radio" name="status" value="${status}"${status === filters.status ? raw(' checked') : ''}> ${STATUS_LABELS[status]}</label>`)}</fieldset>
<div class="filter-actions"><button type="submit">Apply</button><a href="/app/reports.csv${query ? `?${query}` : ''}" download>Download CSV</a> <a href="/app/reports.xlsx${query ? `?${query}` : ''}" download>Download XLSX</a></div>
</form>
<p class="summary"><strong>${count(s.rows)} ${s.rows === 1 ? 'record' : 'records'}</strong> · ${count(s.completed)} completed · ${count(s.expiring)} expiring in ${report.window.days} days · ${count(s.overdue)} overdue · ${count(s.open)} open${s.deferred ? ` · ${count(s.deferred)} deferred` : ''}${s.exempt ? ` · ${count(s.exempt)} exempt` : ''}${s.missing ? ` · ${count(s.missing)} missing` : ''}</p>
<section class="card table-card"><div class="table-wrap"><table class="report stacked">
<thead><tr><th scope="col">Learner</th><th scope="col">Course and revision</th><th scope="col">Status</th><th scope="col">Due</th><th scope="col">Lessons</th><th scope="col">Quiz attempts</th><th scope="col">Practical</th><th scope="col">Completed and certificate</th><th scope="col">Expires</th></tr></thead>
<tbody>${report.rows.length ? report.rows.map(row => h`<tr>
<td class="nowrap">${cellLabel('Learner')}<a href="/app/records/${row.learner}">${row.learnerName}</a></td>
<td class="cell-plain">${cellLabel('Course and revision')}${row.external ? h`${row.courseTitle}<br><span class="muted">external certificate${row.external.pending ? ', one waiting for review' : ''}${row.external.lapsed && row.status === 'missing' ? ', expired' : ''}</span>` : h`${row.assignment ? h`<a href="/app/learn/${row.assignment}">${row.courseTitle}</a>` : row.courseTitle} — revision ${row.revisionNumber}${row.method === 'offline' ? h`<br><span class="muted">offline attendance</span>` : ''}`}</td>
<td class="cell-status">${cellLabel('Status')}${pill(row.status, STATUS_LABELS[row.status])}</td>
<td${empty(row.dueAt)}>${cellLabel('Due')}${row.dueAt ? h`<span class="nowrap">${formatDate(row.dueAt, row.timezone)}</span><br><span class="nowrap">${formatClock(row.dueAt, row.timezone)}${row.timezone === zone ? '' : h` <span class="muted">${zoneName(row.timezone)}</span>`}</span>${access(row, zone)}${exceptionNote(row)}` : '—'}</td>
<td class="nowrap"${empty(row.lessonsTotal)}>${cellLabel('Lessons')}${row.lessonsTotal ? `${row.lessonsDone} of ${row.lessonsTotal}` : '—'}</td>
<td${empty(row.quizAttempts)}>${cellLabel('Quiz attempts')}${row.quizAttempts ? h`${row.quizAttempts} ${row.quizAttempts === 1 ? 'attempt' : 'attempts'}<br>${row.bestPercent ?? 0}%, ${row.quizPassed === 1 ? 'passed' : 'not passed'}` : '—'}</td>
<td${empty(row.practical)}>${cellLabel('Practical')}${practical(row)}</td>
<td class="nowrap"${empty(row.completedAt)}>${cellLabel('Completed')}${row.completedAt ? h`${formatDate(row.completedAt, zone)}${row.certificateId ? h`<br><a href="/app/certificates/${row.certificateId}">${row.certificate}</a>` : row.certificate ? h`<br>${row.certificate}` : ''}` : '—'}</td>
<td class="nowrap"${empty(row.expiresAt)}>${cellLabel('Expires')}${row.expiresAt ? formatDate(row.external ? row.expiresAt - 1 : row.expiresAt, zone) : '—'}</td>
</tr>`) : h`<tr><td colspan="9" class="muted">No training matches these filters.</td></tr>`}</tbody></table></div>
</section>
<p class="muted foot-note">Completion records what happened against an exact revision. It is not a statement of competence.</p>`
  return page('Training report', actor, body, { current: '/app/reports', url, wide: true })
}

async function exportNames(env: Bindings, report: Awaited<ReturnType<typeof trainingReport>>) {
  const [course, team] = await Promise.all([report.filters.course ? one<{ title: string }>(env, 'SELECT title FROM beam_courses WHERE id = ?', report.filters.course) : null, report.filters.team ? one<{ name: string }>(env, 'SELECT name FROM beam_teams WHERE id = ?', report.filters.team) : null])
  return { course: course?.title, team: team?.name }
}

export async function reportXlsxResponse(env: Bindings, actor: Actor, url: URL) {
  const report = await trainingReport(env, actor, reportFilters(url))
  return new Response(reportWorkbook(report, (await business(env))!.timezone, await exportNames(env, report)), { headers: { 'content-type': XLSX_TYPE, 'content-disposition': 'attachment; filename="beam-training-report.xlsx"', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
}

export async function reportCsvResponse(env: Bindings, actor: Actor, url: URL) {
  const report = await trainingReport(env, actor, reportFilters(url))
  return new Response(reportCsv(report, (await business(env))!.timezone, await exportNames(env, report)), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="beam-training-report.csv"', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
}
