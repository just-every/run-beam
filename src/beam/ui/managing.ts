// Owner and manager pages: business, people and teams, paths, assignments,
// offline training, queues, and practical attempts for their assessor.
import type { Bindings } from '../../auth.server'
import { ROLES, requireOwner, requireRole, type Actor } from '../actor'
import { listPaths } from '../assignments'
import { listCourses } from '../courses'
import { all } from '../core'
import { attemptDetail } from '../learning'
import { business, memberNames, people } from '../people'
import { queues } from '../records'
import { formatDate, localDate } from '../time'
import { area, backLink, card, checks, field, fileField, form, h, hidden, page, rows, select, when } from './html'

const ROLE_LABELS: Record<string, string> = { author: 'Author', reviewer: 'Reviewer', learner: 'Learner', manager: 'Manager', assessor: 'Assessor' }
const roleOptions = ROLES.map(role => ({ value: role, label: ROLE_LABELS[role] }))
const days = (value: number | string) => `${value} ${Number(value) === 1 ? 'day' : 'days'}`

export async function businessPage(env: Bindings, actor: Actor, url: URL) {
  requireOwner(actor)
  const current = await business(env)
  const zones = Intl.supportedValuesOf('timeZone')
  const body = h`<h1>${current ? 'Business settings' : 'Set up your business'}</h1>${current ? '' : h`<p class="subtitle">Name your business and its time zone before anything else.</p>`}<div class="card settings">${form('business.configure', '/app', [field('Business name', 'name', { value: current?.name ?? '' }), select('Time zone for due dates', 'timezone', zones.map(zone => ({ value: zone, label: zone })), current?.timezone ?? 'Australia/Sydney')], 'Save')}</div>`
  return page('Business', actor, body, { url })
}

export async function peoplePage(env: Bindings, actor: Actor, request: Request, url: URL) {
  const list = await people(env, request, actor)
  const teamOptions = list.teams.map(team => ({ value: team.id, label: team.name }))
  const roleNames = (roles: string[]) => roles.map(role => ROLE_LABELS[role]).join(', ')
  // A member restored from an archive has no sign-in account yet: Restore access sends them an invitation.
  const access = (member: any) => member.status === 'inactive' ? { label: 'No access', action: 'Restore access', status: 'active' } : member.status === null ? { label: 'Needs an invitation', action: 'Restore access', status: 'active' } : { label: member.status === 'invited' ? 'Invited' : 'Active', action: 'Remove access', status: 'inactive' }
  const body = h`<h1>People and teams</h1>
<section class="card table-card" aria-labelledby="people"><h2 class="card-title table-title" id="people">People</h2><div class="table-wrap"><table class="stacked"><thead><tr><th scope="col">Name</th><th scope="col">Roles</th><th scope="col">Teams</th>${actor.owner ? h`<th scope="col">Access</th>` : ''}</tr></thead><tbody>${list.members.map(member => h`<tr><td data-label="Name"><a href="/app/records/${member.id}">${member.name}</a><br><span class="muted">${member.email}</span></td><td data-label="Roles">${member.owner ? 'Owner (every role)' : actor.owner ? h`<details><summary>${roleNames(member.roles) || 'none'}</summary>${form('person.roles', '/app/people', [hidden('email', member.email), checks('Roles', 'roles', roleOptions, member.roles)], 'Save roles')}</details>` : roleNames(member.roles)}</td><td data-label="Teams">${member.teams.map((team: string) => teamOptions.find(option => option.value === team)?.label).join(', ') || '—'}</td>${actor.owner ? h`<td data-label="Access">${member.owner ? 'Owner' : h`${access(member).label}${form('person.access', '/app/people', [hidden('email', member.email), hidden('status', access(member).status)], access(member).action, { secondary: true })}`}</td>` : ''}</tr>`)}</tbody></table></div></section>
${actor.owner ? card('Invite a staff member', h`<p class="muted">Beam is for adult staff. The invitation is an ordinary sign-in email.</p>${form('person.invite', '/app/people', [field('Name', 'name'), field('Email', 'email', { type: 'email' }), checks('Roles', 'roles', roleOptions, ['learner']), teamOptions.length ? checks('Teams', 'teams', teamOptions) : ''], 'Send invitation')}`, { icon: 'person' }) : ''}
${card('Teams', h`${list.teams.map(team => h`<details><summary>${team.name}</summary>${form('team.members', '/app/people', [hidden('team', team.id), checks('Members', 'members', list.members.map(member => ({ value: member.id, label: member.name })), list.members.filter(member => member.teams.includes(team.id)).map(member => member.id))], 'Save members')}</details>`)}${form('team.create', '/app/people', [field('New team (for example Front desk)', 'name')], 'Add team')}`, { icon: 'people' })}`
  return page('People', actor, body, { current: '/app/people', url })
}

export async function pathsPage(env: Bindings, actor: Actor, url: URL) {
  requireRole(actor, 'manager')
  const [paths, courses, teams] = await Promise.all([listPaths(env), listCourses(env), all(env, 'SELECT id, name FROM beam_teams ORDER BY name')])
  const courseOptions = courses.map(course => ({ value: course.id, label: course.title }))
  const title = (id: string | null) => courses.find(course => course.id === id)?.title ?? ''
  const requirementRows = (path: any) => [...path.requirements, ...Array(3).fill({ course: '', prerequisite: '', dueDays: 14, renewalDays: '' })].map((requirement: any, index: number) => h`<fieldset><legend>Requirement ${index + 1}</legend>${select('Course', 'courses', courseOptions, requirement.course, { required: false, blank: '—' })}${select('Prerequisite', 'prerequisites', courseOptions, requirement.prerequisite ?? '', { required: false, blank: 'None' })}${field('Days to complete', 'dueDays', { type: 'number', value: requirement.dueDays, required: false })}${field('Renew every (days)', 'renewalDays', { type: 'number', value: requirement.renewalDays ?? '', required: false })}</fieldset>`)
  const body = h`<h1>Role paths</h1><p class="lede">A path lists the courses a team needs, in order, with prerequisites and renewal intervals. Saving creates a new path revision; earlier assignments keep theirs.</p>
${paths.map(path => card(path.name, h`<p class="muted">Team: ${teams.find(team => team.id === path.team)?.name} · ${path.number ? `revision ${path.number}` : 'no requirements yet'}</p>${path.requirements.length ? h`<ol class="rows numbered">${path.requirements.map((requirement: any) => h`<li class="row"><span class="row-text"><span class="row-title">${title(requirement.course)}</span><span class="row-meta">${days(requirement.dueDays)} to complete${requirement.prerequisite ? `, after ${title(requirement.prerequisite)}` : ''}${requirement.renewalDays ? `, renew every ${days(requirement.renewalDays)}` : ''}</span></span></li>`)}</ol>` : ''}
${path.number ? form('path.assign', '/app/paths', [hidden('path', path.id)], 'Assign to the team') : ''}<details><summary>Edit requirements</summary>${form('path.revise', '/app/paths', [hidden('path', path.id), requirementRows(path)], 'Save as new revision')}</details>`, { icon: 'book' }))}
${card('New path', form('path.create', '/app/paths', [field('Name', 'name'), select('Team', 'team', teams.map(team => ({ value: team.id, label: team.name })))], 'Create path'), { icon: 'people' })}`
  return page('Paths', actor, body, { current: '/app/paths', url })
}

export async function managePage(env: Bindings, actor: Actor, request: Request, url: URL) {
  requireRole(actor, 'manager')
  const [work, list, courses, names] = await Promise.all([queues(env, actor), people(env, request, actor), listCourses(env), memberNames(env)])
  const zone = (await business(env))!.timezone
  const published = courses.filter(course => course.publishedRevision).map(course => ({ value: course.id, label: course.title }))
  const attestedRevisions = await all(env, "SELECT id, title, number FROM beam_course_revisions WHERE state IN ('published', 'superseded') ORDER BY title, number DESC")
  const memberOptions = list.members.map(member => ({ value: member.id, label: member.name }))
  const teamOptions = list.teams.map(team => ({ value: team.id, label: team.name }))
  const title = (id: string) => courses.find(course => course.id === id)?.title
  const zones = Intl.supportedValuesOf('timeZone').map(value => ({ value, label: value }))
  const body = h`<h1>Manage training</h1>
<div class="grid grid-3">
${card('Overdue', work.overdue.length ? rows(work.overdue.map(row => ({ title: h`<a href="/app/records/${row.learner}">${row.learnerName}</a>`, meta: h`${row.courseTitle}, due ${when(row.dueAt, row.timezone, zone)}` }))) : h`<p class="muted">Nothing overdue.</p>`, { icon: 'clock' })}
${card('Out of quiz attempts', work.attemptsExhausted.length ? h`<ul class="rows">${work.attemptsExhausted.map(row => h`<li class="row"><div class="row-text"><span class="row-title">${row.learnerName}</span><span class="row-meta">${row.courseTitle}</span>${form('attempt.grant', '/app/manage', [hidden('assignment', row.id), field('Reason for another attempt', 'reason')], 'Grant one more attempt')}</div></li>`)}</ul>` : h`<p class="muted">None.</p>`, { icon: 'document' })}
${card('Renewals due', work.renewals.length ? h`${rows(work.renewals.map(row => ({ title: names.get(row.learner), meta: `${title(row.course)}, expires ${formatDate(row.expiresAt, zone)}` })))}${form('assignment.renewals', '/app/manage', [], 'Assign all renewals')}` : h`<p class="muted">No renewals due in the next 30 days.</p>`, { icon: 'refresh' })}
</div>
${card('Assign a course', published.length ? form('assignment.create', '/app/manage', h`<div class="form-row"><div>${select('Course', 'course', published)}</div>${checks('People', 'learners', memberOptions)}${teamOptions.length ? checks('Teams', 'teams', teamOptions) : h`<div></div>`}<div>${field('Due date', 'dueDate', { type: 'date', value: localDate(Date.now() + 14 * 86_400_000, zone) })}</div><div>${field('Due time', 'dueTime', { type: 'time', value: '17:00' })}</div><div>${select('Time zone', 'timezone', zones, zone)}</div></div>`, 'Assign', { className: 'form-row-form' }) : h`<p class="muted">Publish a course first.</p>`, { icon: 'book' })}
${card('Record offline training', published.length ? form('offline.record', '/app/manage', h`${hidden('submission', crypto.randomUUID())}<div class="form-row"><div>${select('Course', 'course', published)}</div><div>${select('Revision', 'revision', attestedRevisions.map(revision => ({ value: revision.id, label: `Revision ${revision.number}`, group: revision.title })), '', { hint: 'Must match the course.' })}</div>${checks('Attendees', 'learners', memberOptions)}<div>${field('Held on', 'heldOn', { type: 'date', value: localDate(Date.now(), zone) })}</div><div>${field('Instructor', 'instructor')}</div><div>${field('Location', 'location')}</div></div>${area('Attestation', 'attestation')}${fileField('Evidence file (optional, for example a signed attendance sheet)', 'file')}`, 'Record attendance', { multipart: true, className: 'form-row-form' }) : h`<p class="muted">Publish a course first.</p>`, { icon: 'calendar' })}
${card('Learner records', rows(list.members.map(member => ({ title: member.name, href: `/app/records/${member.id}` }))), { icon: 'people' })}`
  return page('Manage', actor, body, { current: '/app/manage', url })
}

export async function attemptPage(env: Bindings, actor: Actor, id: string, url: URL) {
  const attempt = await attemptDetail(env, actor, id)
  const names = await memberNames(env)
  const assessorId = attempt.kind === 'practical' ? (await all(env, 'SELECT s.assessor_id FROM beam_attempts t JOIN beam_assessment_revisions s ON s.id = t.assessment_revision_id WHERE t.id = ?', id))[0]?.assessor_id : null
  const assessor = actor.roles.has('assessor') && attempt.learner !== actor.id && attempt.state === 'awaiting_review' && !!assessorId && assessorId === actor.id
  const state = ({ awaiting_review: 'waiting for the assessor', accepted: 'accepted', rejected: 'returned for resubmission', scored: 'scored' } as Record<string, string>)[attempt.state] ?? attempt.state.replace(/_/g, ' ')
  const body = h`${backLink(`/app/learn/${attempt.assignment}`, 'Assignment')}<h1>${attempt.kind === 'quiz' ? 'Quiz' : 'Practical'} attempt ${attempt.number}</h1><p class="subtitle">Learner: ${names.get(attempt.learner)} · ${state}${attempt.kind === 'quiz' ? ` · ${attempt.scoringRule}` : attempt.state === 'awaiting_review' && assessorId ? ` · ${names.get(assessorId)} decides` : ''}</p>
<div class="narrow">${attempt.kind === 'quiz' ? card('Result', h`<p>Score ${attempt.score} of ${attempt.maxScore} — ${attempt.passed ? 'passed' : 'not passed'}; ${attempt.retryDecision}.</p>`, { icon: 'document' }) : card('Evidence', h`<p>${attempt.evidence}</p>${attempt.attachment ? h`<p><a href="/app/files/attachment/${attempt.attachment}">Download the evidence file</a></p>` : ''}`, { icon: 'document' })}
${attempt.decision ? card('Decision', h`<p>${names.get(attempt.decision.assessor)}: ${attempt.decision.decision === 'accepted' ? 'accepted' : 'returned for resubmission'} — ${attempt.decision.note}</p>`, { icon: 'check' }) : ''}
${assessor ? card('Your decision', form('practical.decide', `/app/attempts/${id}`, [hidden('attempt', id), select('Decision', 'decision', [{ value: 'accepted', label: 'Accept the evidence' }, { value: 'rejected', label: 'Not yet: ask for resubmission' }]), area('Note to the learner', 'note')], 'Record decision'), { icon: 'clipboard' }) : ''}</div>`
  return page('Attempt', actor, body, { url })
}

