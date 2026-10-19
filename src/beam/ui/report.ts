// The manager's training report and its CSV download, which carries the same rows.
import type { Bindings } from '../../auth.server'
import { isManager, type Actor } from '../actor'
import { listCourses } from '../courses'
import { all } from '../core'
import { business } from '../people'
import { reportCsv, reportFilters, trainingReport } from '../report'
import { formatClock, formatDate, zoneName } from '../time'
import { cellLabel, count, h, page, pill, raw, select } from './html'

const STATUS_LABELS: Record<string, string> = { all: 'All', open: 'Open', overdue: 'Overdue', completed: 'Completed', expiring: 'Expiring', cancelled: 'Canceled' }

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
  // A learning administrator filters by their units' courses and teams only (ORG-002).
  const units = isManager(actor) ? null : actor.adminUnits, scope = units && JSON.stringify(units)
  const [report, courses, teams, zone] = await Promise.all([trainingReport(env, actor, filters), listCourses(env, units), all(env, 'SELECT id, name FROM beam_teams WHERE (? IS NULL OR unit_id IN (SELECT value FROM json_each(?))) ORDER BY name', scope, scope), business(env).then(value => value!.timezone)])
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value && value !== 'all')).toString()
  const s = report.summary
  const body = h`<h1>Training report</h1>
<form class="card filters" method="get" action="/app/reports">
<div>${select('Course', 'course', courses.map(course => ({ value: course.id, label: course.title })), filters.course, { required: false, blank: 'All courses' })}</div>
<div>${select('Team', 'team', teams.map(team => ({ value: team.id, label: team.name })), filters.team, { required: false, blank: 'All teams' })}</div>
<fieldset class="radios"><legend>Status</legend>${['all', 'open', 'overdue', 'completed', 'expiring'].map(status => h`<label class="check"><input type="radio" name="status" value="${status}"${status === filters.status ? raw(' checked') : ''}> ${STATUS_LABELS[status]}</label>`)}</fieldset>
<div class="filter-actions"><button type="submit">Apply</button><a href="/app/reports.csv${query ? `?${query}` : ''}" download>Download CSV</a></div>
</form>
<p class="summary"><strong>${count(s.rows)} ${s.rows === 1 ? 'record' : 'records'}</strong> · ${count(s.completed)} completed · ${count(s.expiring)} expiring in 30 days · ${count(s.overdue)} overdue · ${count(s.open)} open</p>
<section class="card table-card"><div class="table-wrap"><table class="report stacked">
<thead><tr><th scope="col">Learner</th><th scope="col">Course and revision</th><th scope="col">Status</th><th scope="col">Due</th><th scope="col">Lessons</th><th scope="col">Quiz attempts</th><th scope="col">Practical</th><th scope="col">Completed and certificate</th><th scope="col">Expires</th></tr></thead>
<tbody>${report.rows.length ? report.rows.map(row => h`<tr>
<td class="nowrap">${cellLabel('Learner')}<a href="/app/records/${row.learner}">${row.learnerName}</a></td>
<td class="cell-plain">${cellLabel('Course and revision')}${row.assignment ? h`<a href="/app/learn/${row.assignment}">${row.courseTitle}</a>` : row.courseTitle} — revision ${row.revisionNumber}${row.method === 'offline' ? h`<br><span class="muted">offline attendance</span>` : ''}</td>
<td class="cell-status">${cellLabel('Status')}${pill(row.status, STATUS_LABELS[row.status])}</td>
<td${empty(row.dueAt)}>${cellLabel('Due')}${row.dueAt ? h`<span class="nowrap">${formatDate(row.dueAt, row.timezone)}</span><br><span class="nowrap">${formatClock(row.dueAt, row.timezone)}${row.timezone === zone ? '' : h` <span class="muted">${zoneName(row.timezone)}</span>`}</span>${access(row, zone)}` : '—'}</td>
<td class="nowrap"${empty(row.lessonsTotal)}>${cellLabel('Lessons')}${row.lessonsTotal ? `${row.lessonsDone} of ${row.lessonsTotal}` : '—'}</td>
<td${empty(row.quizAttempts)}>${cellLabel('Quiz attempts')}${row.quizAttempts ? h`${row.quizAttempts} ${row.quizAttempts === 1 ? 'attempt' : 'attempts'}<br>${row.bestPercent ?? 0}%, ${row.quizPassed === 1 ? 'passed' : 'not passed'}` : '—'}</td>
<td${empty(row.practical)}>${cellLabel('Practical')}${practical(row)}</td>
<td class="nowrap"${empty(row.completedAt)}>${cellLabel('Completed')}${row.completedAt ? h`${formatDate(row.completedAt, zone)}${row.certificate ? h`<br><a href="/app/certificates/${row.certificateId}">${row.certificate}</a>` : ''}` : '—'}</td>
<td class="nowrap"${empty(row.expiresAt)}>${cellLabel('Expires')}${row.expiresAt ? formatDate(row.expiresAt, zone) : '—'}</td>
</tr>`) : h`<tr><td colspan="9" class="muted">No training matches these filters.</td></tr>`}</tbody></table></div>
</section>
<p class="muted foot-note">Completion records what happened against an exact revision. It is not a statement of competence.</p>`
  return page('Training report', actor, body, { current: '/app/reports', url, wide: true })
}

export async function reportCsvResponse(env: Bindings, actor: Actor, url: URL) {
  const report = await trainingReport(env, actor, reportFilters(url))
  return new Response(reportCsv(report), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="beam-training-report.csv"', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
}
