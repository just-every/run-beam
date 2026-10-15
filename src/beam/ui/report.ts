// The manager's training report and its CSV download, which carries the same rows.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { listCourses } from '../courses'
import { all } from '../core'
import { business } from '../people'
import { reportCsv, reportFilters, trainingReport } from '../report'
import { formatDate, formatLocal, zoneName } from '../time'
import { count, h, page, pill, raw, select } from './html'

const STATUS_LABELS: Record<string, string> = { all: 'All', open: 'Open', overdue: 'Overdue', completed: 'Completed', expiring: 'Expiring', cancelled: 'Cancelled' }

// A cell that shows only a dash is marked, so the stacked 390 view can leave it out.
const empty = (value: unknown) => value ? '' : raw(' data-empty')

function practical(row: any) {
  if (!row.practical) return '—'
  if (row.practical.state === 'awaiting_review') return 'waiting for the assessor'
  return `${row.practical.state === 'accepted' ? 'accepted' : 'returned'} by ${row.practical.assessor}`
}

export async function reportPage(env: Bindings, actor: Actor, url: URL) {
  const filters = reportFilters(url)
  const [report, courses, teams, zone] = await Promise.all([trainingReport(env, actor, filters), listCourses(env), all(env, 'SELECT id, name FROM beam_teams ORDER BY name'), business(env).then(value => value!.timezone)])
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value && value !== 'all')).toString()
  const s = report.summary
  const body = h`<h1>Training report</h1>
<form class="card filters" method="get" action="/app/reports">
<div>${select('Course', 'course', courses.map(course => ({ value: course.id, label: course.title })), filters.course, { required: false, blank: 'All courses' })}</div>
<div>${select('Team', 'team', teams.map(team => ({ value: team.id, label: team.name })), filters.team, { required: false, blank: 'All teams' })}</div>
<fieldset class="radios"><legend>Status</legend>${['all', 'open', 'overdue', 'completed', 'expiring'].map(status => h`<label class="check"><input type="radio" name="status" value="${status}"${status === filters.status ? raw(' checked') : ''}> ${STATUS_LABELS[status]}</label>`)}</fieldset>
<div class="filter-actions"><button type="submit">Apply</button><a href="/app/reports.csv${query ? `?${query}` : ''}" download>Download CSV</a></div>
</form>
<p class="summary"><strong>${count(s.rows)} ${s.rows === 1 ? 'record' : 'records'}</strong> · ${count(s.overdue)} overdue · ${count(s.completed)} completed · ${count(s.expiring)} expiring within 30 days</p>
<section class="card table-card"><div class="table-wrap"><table class="report stacked">
<thead><tr><th scope="col">Learner</th><th scope="col">Course and revision</th><th scope="col">Status</th><th scope="col">Due</th><th scope="col">Lessons</th><th scope="col">Quiz attempts</th><th scope="col">Practical</th><th scope="col">Completed</th><th scope="col">Certificate</th><th scope="col">Expires</th></tr></thead>
<tbody>${report.rows.length ? report.rows.map(row => h`<tr>
<td class="nowrap" data-label="Learner"><a href="/app/records/${row.learner}">${row.learnerName}</a></td>
<td class="cell-plain" data-label="Course and revision">${row.assignment ? h`<a href="/app/learn/${row.assignment}">${row.courseTitle}</a>` : row.courseTitle} — revision ${row.revisionNumber}${row.method === 'offline' ? h`<br><span class="muted">offline attendance</span>` : ''}</td>
<td class="cell-status" data-label="Status">${pill(row.status, STATUS_LABELS[row.status])}</td>
<td data-label="Due"${empty(row.dueAt)}>${row.dueAt ? h`<span class="nowrap">${formatLocal(row.dueAt, row.timezone)}</span>${row.timezone === zone ? '' : h`<br><span class="muted">${zoneName(row.timezone)}</span>`}` : '—'}</td>
<td class="nowrap" data-label="Lessons"${empty(row.lessonsTotal)}>${row.lessonsTotal ? `${row.lessonsDone} of ${row.lessonsTotal}` : '—'}</td>
<td data-label="Quiz attempts"${empty(row.quizAttempts)}>${row.quizAttempts ? `${row.quizAttempts} ${row.quizAttempts === 1 ? 'attempt' : 'attempts'} · ${row.bestPercent ?? 0}%, ${row.quizPassed === 1 ? 'passed' : 'not passed'}` : '—'}</td>
<td data-label="Practical"${empty(row.practical)}>${practical(row)}</td>
<td class="nowrap" data-label="Completed"${empty(row.completedAt)}>${row.completedAt ? formatDate(row.completedAt, zone) : '—'}</td>
<td class="nowrap" data-label="Certificate"${empty(row.certificate)}>${row.certificate ? h`<a href="/app/certificates/${row.certificateId}">${row.certificate}</a>` : '—'}</td>
<td class="nowrap" data-label="Expires"${empty(row.expiresAt)}>${row.expiresAt ? formatDate(row.expiresAt, zone) : '—'}</td>
</tr>`) : h`<tr><td colspan="10" class="muted">No training matches these filters.</td></tr>`}</tbody></table></div>
</section>
<p class="muted foot-note">Completion records what happened against an exact revision. It is not a statement of competence.</p>`
  return page('Training report', actor, body, { current: '/app/reports', url })
}

export async function reportCsvResponse(env: Bindings, actor: Actor, url: URL) {
  const report = await trainingReport(env, actor, reportFilters(url))
  return new Response(reportCsv(report), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="beam-training-report.csv"', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
}
