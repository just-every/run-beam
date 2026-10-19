// REPORT-005: the program quality page, one card per course with a table per revision, each figure beside its
// denominator; the definitions say what every figure counts and what is missing.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { all } from '../core'
import { programQuality } from '../quality'
import { teamScope } from '../scope'
import { formatDate } from '../time'
import { business } from '../people'
import { backLink, card, h, page, select } from './html'

const of = (value: number, total: number) => `${value} of ${total}`

export async function qualityPage(env: Bindings, actor: Actor, url: URL) {
  const [view, zone] = await Promise.all([programQuality(env, actor, url), business(env).then(value => value?.timezone ?? 'UTC')])
  const scope = teamScope(actor, 'reports')
  const teams = await all(env, 'SELECT id, name FROM beam_teams WHERE (? IS NULL OR id IN (SELECT value FROM json_each(?))) ORDER BY name', scope, scope)
  const revision = (figures: any) => h`<h3>Revision ${figures.number}${figures.state === 'published' ? ' (current)' : ''}</h3>
<p>Assigned ${figures.enrollment.assigned}: ${figures.enrollment.completed} completed, ${figures.enrollment.open} open, ${figures.enrollment.cancelled} canceled. Median days to complete: ${figures.completionDays.median ?? '—'} (n = ${figures.completionDays.n}${figures.completionDays.missing ? `; ${figures.completionDays.missing} without an assignment, missing` : ''}).</p>
<div class="table-wrap"><table class="stacked"><thead><tr><th scope="col">Lesson</th><th scope="col">Completed</th><th scope="col">Stopped after</th></tr></thead><tbody>${figures.lessons.map((lesson: any) => h`<tr><td>${lesson.position + 1}. ${lesson.title}</td><td>${of(lesson.completed, lesson.of)}</td><td>${lesson.stoppedAfter}</td></tr>`)}</tbody></table></div>
<p class="muted">Not started: ${figures.notStarted}.</p>
${figures.questions.length ? h`<div class="table-wrap"><table class="stacked"><thead><tr><th scope="col">Question</th><th scope="col">Full credit</th><th scope="col">Ungraded</th></tr></thead><tbody>${figures.questions.map((question: any) => h`<tr><td>${question.prompt}</td><td>${of(question.fullCredit, question.answered)}</td><td>${question.ungraded}</td></tr>`)}</tbody></table></div>` : ''}
<p>Quiz retries: ${of(figures.retries.retried, figures.retries.attempted)} retried, ${figures.retries.passedAfterRetry} passed after a retry, ${figures.retries.attempts} attempts in all. Feedback: ${figures.feedback.feedback} notes, ${figures.feedback.broken} broken-content reports.</p>`
  const courses = view.courses.map(course => card(course.title, h`<p>Effort: ${course.effort.submitted} revisions submitted, ${course.effort.returned} returned, ${course.effort.published} published; median review time ${course.effort.reviewHours.median ?? '—'} hours (n = ${course.effort.reviewHours.n}); time spent is not recorded. Content age: ${course.contentAge.days ?? '—'} days${course.contentAge.lastUpkeepDecisionAt ? `, last upkeep decision ${formatDate(course.contentAge.lastUpkeepDecisionAt, zone)}` : ''}${course.contentAge.nextReviewOn ? `, next review ${course.contentAge.nextReviewOn}` : ''}.</p>${course.revisions.map(revision)}`))
  const body = h`${backLink('/app/reports', 'Reports')}<h1>Course quality</h1><p class="lede">${view.definitions.activity} ${view.definitions.people}</p>
<form class="card filters" method="get" action="/app/quality"><div>${select('Team', 'team', teams.map(team => ({ value: team.id, label: team.name })), view.filters.team, { required: false, blank: 'All teams' })}</div><div class="filter-actions"><button type="submit">Apply</button></div></form>
${courses.length ? courses : card('No courses', h`<p>No published course has assignments in this report yet.</p>`)}
${card('Definitions', h`<dl>${Object.entries(view.definitions).map(([name, text]) => h`<dt>${name}</dt><dd>${text}</dd>`)}</dl>`)}`
  return page('Course quality', actor, body, { current: '/app/reports', url })
}
