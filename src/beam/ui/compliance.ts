// Manage training (/app/manage), the manager's main screen: team chips, the four count cards, the agent strip, one
// status's queue, course coverage and the decision panel for the selected record; then assigning and offline training.
import type { Bindings } from '../../auth.server'
import { requireRole, type Actor } from '../actor'
import { complianceFilters, complianceView, type ComplianceFilters, type ComplianceView, type Queue, type Standing } from '../compliance'
import { listCourses } from '../courses'
import { all } from '../core'
import { people } from '../people'
import { calendarDays, formatClock, formatDate, formatWeekday, localDate } from '../time'
import { agentName, area, card, cellLabel, checks, count, field, fileField, form, h, hidden, page, raw, select, type Html } from './html'
import { icon, type IconName } from './icons'

const CARDS: { status: Queue; label: string; icon: IconName; tone: string }[] = [
  { status: 'completed', label: 'Completed', icon: 'person', tone: 'done' },
  { status: 'expiring', label: 'Expiring in 30 days', icon: 'clock', tone: 'waiting' },
  { status: 'overdue', label: 'Overdue', icon: 'alert', tone: 'late' },
  { status: 'open', label: 'Open', icon: 'document', tone: 'quiet' },
]
const TITLES: Record<Queue, string> = { overdue: 'Overdue training', expiring: 'Expiring in 30 days', open: 'Open training', completed: 'Completed training' }
const EMPTY: Record<Queue, string> = { overdue: 'Nothing overdue.', expiring: 'No renewals due in the next 30 days.', open: 'Nothing open.', completed: 'No completions yet.' }
const plural = (value: number, one: string, many = `${one}s`) => `${count(value)} ${value === 1 ? one : many}`

const dot = (tone: string) => h`<i class="dot dot-${tone}" aria-hidden="true"></i>`
const standing = (value: Standing) => h`<span class="standing">${dot(value.tone)}${value.label}</span>`
const firstName = (name: string) => name.split(/\s+/)[0]
const by = (proposal: any) => proposal.viaAgent || proposal.agent ? `${proposal.preparedByName}'s agent${proposal.agent ? ` (${agentName(proposal.agent)})` : ''}` : proposal.preparedByName
type Link = (changes: Partial<ComplianceFilters>, anchor?: string) => string

export async function managePage(env: Bindings, actor: Actor, request: Request, url: URL) {
  requireRole(actor, 'manager')
  const filters = complianceFilters(url)
  const [view, list, courses, attestedRevisions] = await Promise.all([complianceView(env, actor, filters), people(env, request, actor), listCourses(env),
    all(env, "SELECT id, title, number FROM beam_course_revisions WHERE state IN ('published', 'superseded') ORDER BY title, number DESC")])
  const zone = actor.shell!.zone
  const link = (changes: Partial<ComplianceFilters>, anchor = '') => {
    const next = { ...filters, select: '', ...changes }
    const query = new URLSearchParams(Object.entries(next).filter(([key, value]) => value && !(key === 'status' && value === 'overdue'))).toString()
    return `/app/manage${query ? `?${query}` : ''}${anchor}`
  }
  const teamName = view.teams.find(team => team.id === filters.team)?.name
  const tools = h`<details class="pop"><summary>${teamName ?? 'All teams'}${raw(icon('chevron', { size: 16, className: 'pop-chevron' }))}</summary><ul><li><a href="${link({ team: '' })}"${filters.team ? '' : raw(' aria-current="true"')}>All teams</a></li>${view.teams.map(team => h`<li><a href="${link({ team: team.id })}"${team.id === filters.team ? raw(' aria-current="true"') : ''}>${team.name}</a></li>`)}</ul></details>`

  const head = h`<div class="page-head"><h1>Manage training</h1>${view.teams.length ? h`<ul class="chips" aria-label="Teams">${view.teams.map(team => h`<li><a href="${link({ team: team.id === filters.team ? '' : team.id })}"${team.id === filters.team ? raw(' aria-current="true"') : ''}>${team.name}<b>${count(team.people)}</b></a></li>`)}</ul>` : ''}</div>`
  const cards = h`<ul class="counts" aria-label="Training records by status">${CARDS.map(item => h`<li><a class="count-card tone-${item.tone}" href="${link({ status: item.status })}"${item.status === filters.status ? raw(' aria-current="true"') : ''}><strong>${count(view.counts[item.status])}</strong><span>${item.label}</span><i class="disc">${raw(icon(item.icon, { size: 22 }))}</i></a></li>`)}</ul>`
  const courseList = courses.filter(course => course.publishedRevision).map(course => ({ id: course.id, title: course.title }))
  const body = h`<div class="manage">${head}${cards}${agentStrip(view, zone)}${queue(view, link, zone, courseList)}${decision(view, link, zone)}
${coverage(view)}
<div class="manage-forms">${assignCard(courses, list, zone)}${offlineCard(courses, list, attestedRevisions, zone)}</div></div>`
  return page('Manage', actor, body, { current: '/app/manage', url, tools, wide: true })
}

function when(at: number, zone: string, today: number) {
  return localDate(at, zone) === localDate(today, zone) ? formatClock(at, zone) : `${formatWeekday(at, zone).split(' ')[0]} ${formatClock(at, zone)}`
}

function agentStrip(view: ComplianceView, zone: string): Html {
  const latest = view.waiting[0]
  const newest = view.activity[0]
  return h`<section class="card strip" aria-labelledby="strip-title"><div class="strip-top"><span class="spark">${raw(icon('spark', { size: 26 }))}</span>
<div class="strip-copy"><p><strong id="strip-title">Agent work:</strong> ${latest ? h`${by(latest)} prepared ${latest.title}` : 'nothing is waiting for your decision.'}</p>${view.waiting.length ? h`<p>${dot('waiting')}${plural(view.waiting.length, 'plan')} ${view.waiting.length === 1 ? 'needs' : 'need'} your decision</p>` : ''}</div>
${newest ? h`<p class="strip-latest"><time>${when(newest.at, zone, view.at)}</time><span>${newest.who} ${newest.verb} ${newest.title}.</span></p>` : ''}
<a class="button secondary small" href="/app/agent">Review</a></div>
${view.activity.length > 1 ? h`<ol class="activity" aria-label="Recent agent work">${view.activity.slice(1).map(item => h`<li><time>${when(item.at, zone, view.at)}</time><span>${item.who} ${item.verb} ${item.title}</span></li>`)}</ol>` : ''}</section>`
}

function columns(status: Queue, zone: string, now: number): { head: string; cell: (row: any) => unknown; className?: string }[] {
  const course = { head: 'Course', cell: (row: any) => h`${row.courseTitle}${row.method === 'offline' && !row.assignment ? h`<br><span class="muted">offline attendance</span>` : ''}` }
  const team = { head: 'Team', cell: (row: any) => row.team ?? '—' }
  const daysLeft = (days: number | null) => days === null ? '—' : -days
  const lessons = { head: 'Lessons', cell: (row: any) => row.lessonsTotal ? `${row.lessonsDone} of ${row.lessonsTotal}` : '—', className: 'cell-number' }
  const status_ = { head: 'Status', cell: (row: any) => standing(row.standing), className: 'cell-status' }
  if (status === 'overdue') return [team, course, { head: 'Due date ↓', cell: row => formatWeekday(row.dueAt, row.timezone) }, { head: 'Days overdue', cell: row => h`<span class="chip-late">${row.days}</span>`, className: 'cell-number' }, lessons, status_]
  if (status === 'open') return [team, course, { head: 'Due date', cell: row => formatWeekday(row.dueAt, row.timezone) }, { head: 'Days left', cell: row => daysLeft(row.days), className: 'cell-number' }, lessons, status_]
  if (status === 'expiring') return [team, course, { head: 'Expires', cell: row => formatWeekday(row.expiresAt, zone) }, { head: 'Days left', cell: row => Math.max(0, calendarDays(now, row.expiresAt, zone)), className: 'cell-number' }, { head: 'Completed', cell: row => formatDate(row.completedAt, zone) }, status_]
  return [team, course, { head: 'Completed', cell: row => formatDate(row.completedAt, zone) }, { head: 'Expires', cell: row => row.expiresAt ? formatDate(row.expiresAt, zone) : '—' }, { head: 'Certificate', cell: row => row.certificate ? h`<a href="/app/certificates/${row.certificateId}">${row.certificate}</a>` : '—' }, status_]
}

// Filters narrow the whole screen, as the team chips do: status, team and course, each a plain link; the report opens
// on the same records.
function filterMenu(view: ComplianceView, link: Link, courses: { id: string; title: string }[]): Html {
  const { status, team, course } = view.filters
  const active = (team ? 1 : 0) + (course ? 1 : 0)
  const item = (href: string, label: string, current: boolean) => h`<li><a href="${href}"${current ? raw(' aria-current="true"') : ''}>${label}</a></li>`
  const report = `/app/reports?${new URLSearchParams(Object.entries({ status, team, course }).filter(([, value]) => value)).toString()}`
  return h`<details class="pop filters-menu"><summary class="button secondary small">${raw(icon('filter', { size: 16 }))}<span>Filters${active ? ` · ${active}` : ''}</span></summary><div class="pop-panel">
<p class="pop-head">Status</p><ul>${CARDS.map(card => item(link({ status: card.status }), card.label, card.status === status))}</ul>
<p class="pop-head">Team</p><ul>${item(link({ team: '' }), 'All teams', !team)}${view.teams.map(entry => item(link({ team: entry.id }), entry.name, entry.id === team))}</ul>
<p class="pop-head">Course</p><ul>${item(link({ course: '' }), 'All courses', !course)}${courses.map(entry => item(link({ course: entry.id }), entry.title, entry.id === course))}</ul>
<p class="pop-foot"><a href="${report}">Open these records in the report</a></p></div></details>`
}

function queue(view: ComplianceView, link: Link, zone: string, courses: { id: string; title: string }[]): Html {
  const status = view.filters.status, cols = columns(status, zone, view.at)
  const search = h`<form class="search" method="get" action="/app/manage" role="search">${view.filters.team ? hidden('team', view.filters.team) : ''}${view.filters.course ? hidden('course', view.filters.course) : ''}${status === 'overdue' ? '' : hidden('status', status)}<label class="visually-hidden" for="queue-search">Search people, courses or teams</label>${raw(icon('search', { size: 18 }))}<input id="queue-search" type="search" name="q" value="${view.filters.q}" placeholder="Search people, courses or teams…"></form>`
  const renew = status === 'expiring' && view.renewals ? form('assignment.renewals', link({ status: 'expiring' }), [], 'Assign all renewals', { className: 'inline-form' }) : ''
  const aside = h`${search}${renew}${filterMenu(view, link, courses)}`
  const rowsHtml = view.queue.length ? view.queue.map(row => h`<tr${row.key === view.selected?.key ? raw(' class="selected" aria-current="true"') : ''}><th scope="row"><a href="${link({ status, select: row.key }, '#decision')}">${row.learnerName}</a></th>${cols.map(col => h`<td${col.className ? h` class="${col.className}"` : ''}>${cellLabel(col.head.replace(' ↓', ''))}${col.cell(row)}</td>`)}</tr>`)
    : h`<tr><td colspan="${cols.length + 1}" class="muted">${view.filters.q ? 'Nothing matches that search.' : EMPTY[status]}</td></tr>`
  return card(`${TITLES[status]} (${count(view.queue.length)})`, h`<div class="table-wrap"><table class="queue-table stacked"><thead><tr><th scope="col">Name</th>${cols.map(col => h`<th scope="col">${col.head}</th>`)}</tr></thead><tbody>${rowsHtml}</tbody></table></div>`, { id: 'queue-title', className: 'queue', aside })
}

function decision(view: ComplianceView, link: Link, zone: string): Html {
  const row: any = view.selected, detail: any = view.detail
  if (!row) return h`<aside class="card decision empty-panel" id="decision"><h2 class="card-title">Nothing selected</h2><p class="muted">Choose a record in the queue to see what it is waiting on.</p></aside>`
  const allowed = detail.maxAttempts ? detail.maxAttempts + detail.extra : null
  const quizUsed = row.quizAttempts ? `${allowed ? `${row.quizAttempts} of ${allowed}` : row.quizAttempts} ${(allowed ?? row.quizAttempts) === 1 ? 'attempt' : 'attempts'} used, ${row.quizPassed === 1 ? 'passed' : 'not passed'}` : allowed ? 'Not taken' : '—'
  const practical = row.practical ? (row.practical.state === 'awaiting_review' ? `Waiting for ${detail.assessorName}` : `${row.practical.state === 'accepted' ? 'Accepted' : 'Returned'} by ${row.practical.assessor}`) : detail.assessor ? `Not submitted (${detail.assessorName} assesses)` : '—'
  const banner = row.practical?.state === 'awaiting_review' ? ['Waiting on the assessor', `${firstName(row.learnerName)} sent practical evidence. ${detail.assessorName} decides it; nobody can accept their own evidence.`]
    : detail.exhausted ? ['Out of quiz attempts', `${row.quizAttempts} quiz attempts used without a pass. A manager can grant one more attempt below.`]
    : detail.blocked ? ['Prerequisite not done', `${detail.prerequisiteTitle} has to be completed first; this course stays locked until then.`]
    : row.status === 'expiring' && !row.plan ? ['Renewal not assigned', `The certificate expires ${formatWeekday(row.expiresAt, zone)}. Assign all renewals from the expiring queue.`]
    : row.plan?.kind === 'reminders' ? ['Waiting on your decision', `${by(row.plan)} drafted ${row.plan.payload.items.length === 1 ? 'this reminder' : `these ${row.plan.payload.items.length} reminders`} at ${when(row.plan.createdAt, zone, view.at)}, and nothing reaches ${firstName(row.learnerName)} until you decide. Beam delivers reminders on My learning only; it sends no email or text.`]
    : row.plan ? ['Waiting on your decision', `${by(row.plan)} prepared ${row.plan.title} at ${when(row.plan.createdAt, zone, view.at)}, and nothing is assigned until you decide.`] : null
  const done = row.status === 'completed' || row.status === 'expiring'
  const facts: [string, unknown][] = done ? [
    ['Course', `${row.courseTitle}, revision ${row.revisionNumber}`],
    ['Completed', `${formatDate(row.completedAt, zone)}${row.method === 'offline' ? ', attested offline training' : ''}`],
    ['Expires', row.expiresAt ? formatWeekday(row.expiresAt, zone) : 'Does not expire'],
    ['Certificate', row.certificate ? h`<a href="/app/certificates/${row.certificateId}">${row.certificate}</a>` : '—'],
    ['Status', standing(row.standing)],
  ] : [
    ['Course', `${row.courseTitle}, revision ${row.revisionNumber}`],
    ['Due date', formatWeekday(row.dueAt, row.timezone)],
    row.status === 'overdue' ? ['Days overdue', h`<span class="chip-late">${row.days}</span>`] : ['Days left', -row.days],
    ['Lessons', row.lessonsTotal ? `${row.lessonsDone} of ${row.lessonsTotal}` : '—'],
    ['Quiz', quizUsed], ['Practical', practical],
    ['Status', standing(row.standing)],
  ]
  const plan = row.plan
  const message = plan?.kind === 'reminders' ? plan.payload.items.find((item: any) => item.assignment === row.assignment)?.message : null
  const planItems = plan ? plan.payload.items.length : 0
  const resolution = plan ? h`<form method="post" action="/app/do/agent.decide" class="resolution">${hidden('returnTo', link({ status: view.filters.status }, '#decision'))}${hidden('proposal', plan.id)}${hidden('sha256', plan.sha256)}
<fieldset><legend>Choose a resolution</legend>
<label class="choice"><input type="radio" name="decision" value="approve" checked><span><strong>${plan.kind === 'reminders' ? `Send the drafted ${planItems === 1 ? 'reminder' : 'reminders'}` : `Approve the ${plan.label.toLowerCase()}`}</strong><span>${plan.title}: ${plural(planItems, plan.kind === 'reminders' ? 'reminder' : 'assignment')}, delivered in Beam</span></span></label>
<label class="choice"><input type="radio" name="decision" value="decline"><span><strong>Decline the plan</strong><span>Nothing is sent or assigned</span></span></label></fieldset>
<div class="decision-actions"><button type="submit">Record decision</button><a class="button secondary" href="${link({ status: view.filters.status, select: row.key }, '#decision')}">Keep as is</a></div></form>`
    : h`<div class="resolution"><h3>Choose a resolution</h3><p class="muted">No plan is waiting for this record. Reminders and plans that the agent prepares appear here and at <a href="/app/agent">Agent work</a>.</p></div>`
  const grant = detail.exhausted ? form('attempt.grant', link({ status: view.filters.status, select: row.key }, '#decision'), [hidden('assignment', row.assignment), field('Reason for another attempt', 'reason')], 'Grant one more attempt', { secondary: true, className: 'grant' }) : ''
  return h`<aside class="card decision" id="decision" aria-labelledby="decision-name">
<div class="decision-head"><h2 id="decision-name">${row.learnerName}</h2><p class="meta"><span class="meta-items">${row.team ? h`<span>${row.team}</span>` : ''}<span>${detail.email}</span></span></p>
<details class="pop more"><summary aria-label="More for ${row.learnerName}">${raw(icon('dots', { size: 22 }))}</summary><ul><li><a href="/app/records/${row.learner}">Learner record</a></li>${row.assignment ? h`<li><a href="/app/learn/${row.assignment}">Assignment</a></li>` : ''}</ul></details></div>
${banner ? h`<div class="banner-warn" role="note">${raw(icon('warning', { size: 26 }))}<div><h3>${banner[0]}</h3><p>${banner[1]}</p></div></div>` : ''}
<dl class="facts">${facts.map(([term, value]) => h`<dt>${term}</dt><dd>${value}</dd>`)}</dl>
${resolution}${grant}
${message ? h`<section class="draft-message"><h3>Message to ${firstName(row.learnerName)} (draft)</h3><div class="draft">${message.split(/\n{2,}/).map((part: string) => h`<p>${part.split('\n').map((line, index) => h`${index ? raw('<br>') : ''}${line}`)}</p>`)}</div></section>` : ''}
</aside>`
}

function coverage(view: ComplianceView): Html {
  const n = (value: number, tone: string) => h`<strong class="n n-${value ? tone : 'zero'}">${count(value)}</strong>`
  return card('Course coverage', view.coverage.length ? h`<div class="table-wrap"><table class="coverage-table stacked"><thead><tr><th scope="col">Course</th><th scope="col">Total</th><th scope="col">Completed</th><th scope="col">Expiring in 30 days</th><th scope="col">Overdue</th><th scope="col">Open</th></tr></thead><tbody>${view.coverage.map(row => h`<tr><th scope="row"><a href="/app/reports?course=${row.course}">${row.title}</a></th><td>${cellLabel('Total')}${n(row.total, 'ink')}</td><td>${cellLabel('Completed')}${n(row.completed, 'done')}</td><td>${cellLabel('Expiring in 30 days')}${n(row.expiring, 'waiting')}</td><td>${cellLabel('Overdue')}${n(row.overdue, 'late')}</td><td>${cellLabel('Open')}${n(row.open, 'ink')}</td></tr>`)}</tbody></table></div>` : h`<p class="muted">Nothing is assigned yet. Publish a course, then assign it below.</p>`, { className: 'coverage' })
}

function assignCard(courses: Awaited<ReturnType<typeof listCourses>>, list: Awaited<ReturnType<typeof people>>, zone: string): Html {
  const published = courses.filter(course => course.publishedRevision).map(course => ({ value: course.id, label: course.title }))
  const memberOptions = list.members.map(member => ({ value: member.id, label: member.name }))
  const teamOptions = list.teams.map(team => ({ value: team.id, label: team.name }))
  const zones = Intl.supportedValuesOf('timeZone').map(value => ({ value, label: value }))
  return card('Assign a course', published.length ? form('assignment.create', '/app/manage', h`<div class="form-row"><div>${select('Course', 'course', published)}</div><div>${field('Due date', 'dueDate', { type: 'date', value: localDate(Date.now() + 14 * 86_400_000, zone) })}</div><div>${field('Due time', 'dueTime', { type: 'time', value: '17:00' })}</div><div>${select('Time zone', 'timezone', zones, zone)}</div></div>${teamOptions.length ? checks('Teams', 'teams', teamOptions) : ''}${checks('People', 'learners', memberOptions, [], { scroll: true })}`, 'Assign') : h`<p class="muted">Publish a course first.</p>`)
}

function offlineCard(courses: Awaited<ReturnType<typeof listCourses>>, list: Awaited<ReturnType<typeof people>>, revisions: any[], zone: string): Html {
  const published = courses.filter(course => course.publishedRevision).map(course => ({ value: course.id, label: course.title }))
  const memberOptions = list.members.map(member => ({ value: member.id, label: member.name }))
  return card('Record offline training', published.length ? form('offline.record', '/app/manage', h`${hidden('submission', crypto.randomUUID())}<div class="form-row"><div>${select('Course', 'course', published)}</div><div>${select('Revision', 'revision', revisions.map(revision => ({ value: revision.id, label: `Revision ${revision.number}`, group: revision.title })), '', { hint: 'Must match the course.' })}</div><div>${field('Held on', 'heldOn', { type: 'date', value: localDate(Date.now(), zone) })}</div><div>${field('Instructor', 'instructor')}</div><div>${field('Location', 'location')}</div></div>${checks('Attendees', 'learners', memberOptions, [], { scroll: true })}${area('Attestation', 'attestation')}${fileField('Evidence file (optional, for example a signed attendance sheet)', 'file')}`, 'Record attendance', { multipart: true }) : h`<p class="muted">Publish a course first.</p>`)
}
