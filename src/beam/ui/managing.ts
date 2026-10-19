// Owner and manager pages: business, people and teams, paths, and practical attempts for their assessor. The
// manager's main screen is ui/compliance.ts.
import type { Bindings } from '../../auth.server'
import { ROLES, requireOwner, requireRole, type Actor } from '../actor'
import { listPaths } from '../assignments'
import { listCourses } from '../courses'
import { all } from '../core'
import { attemptDetail } from '../learning'
import { business, memberNames, people } from '../people'
import { queues } from '../records'
import { formatDate, localDate } from '../time'
import { area, backLink, card, cellLabel, checks, field, fileField, form, h, hidden, page, rows, select, when } from './html'
import { describeRule, windowForm } from './access'
import { timingCard } from './timing'

const ROLE_LABELS: Record<string, string> = { author: 'Author', reviewer: 'Reviewer', learner: 'Learner', manager: 'Manager', assessor: 'Assessor' }
const roleOptions = ROLES.map(role => ({ value: role, label: ROLE_LABELS[role] }))
const days = (value: number | string) => `${value} ${Number(value) === 1 ? 'day' : 'days'}`

export async function businessPage(env: Bindings, actor: Actor, url: URL) {
  requireOwner(actor)
  const current = await business(env)
  const zones = Intl.supportedValuesOf('timeZone')
  const body = h`<h1>${current ? 'Business settings' : 'Set up your business'}</h1>${current ? '' : h`<p class="subtitle">Name your business and its time zone before anything else.</p>`}<div class="card settings">${form('business.configure', '/app', [field('Business name', 'name', { value: current?.name ?? '' }), select('Time zone for due dates', 'timezone', zones.map(zone => ({ value: zone, label: zone })), current?.timezone ?? 'America/Chicago')], 'Save')}</div>`
  return page('Business', actor, body, { url })
}

export async function peoplePage(env: Bindings, actor: Actor, request: Request, url: URL) {
  const list = await people(env, request, actor)
  const teamOptions = list.teams.map(team => ({ value: team.id, label: team.name }))
  const roleNames = (roles: string[]) => roles.map(role => ROLE_LABELS[role]).join(', ')
  // A member restored from an archive has no sign-in account yet: Restore access sends them an invitation.
  const access = (member: any) => member.status === 'inactive' ? { label: 'No access', action: 'Restore access', status: 'active' } : member.status === null ? { label: 'Needs an invitation', action: 'Restore access', status: 'active' } : { label: member.status === 'invited' ? 'Invited' : 'Active', action: 'Remove access', status: 'inactive' }
  const body = h`<h1>People and teams</h1>
<section class="card table-card" aria-labelledby="people"><h2 class="card-title table-title" id="people">People</h2><div class="table-wrap"><table class="stacked"><thead><tr><th scope="col">Name</th><th scope="col">Roles</th><th scope="col">Teams</th>${actor.owner ? h`<th scope="col">Access</th>` : ''}</tr></thead><tbody>${list.members.map(member => h`<tr><td>${cellLabel('Name')}<a href="/app/records/${member.id}">${member.name}</a><br><span class="muted">${member.email}</span></td><td>${cellLabel('Roles')}${member.owner ? 'Owner (every role)' : actor.owner ? h`<details><summary>${roleNames(member.roles) || 'none'}</summary>${form('person.roles', '/app/people', [hidden('email', member.email), checks('Roles', 'roles', roleOptions, member.roles)], 'Save roles')}</details>` : roleNames(member.roles)}</td><td>${cellLabel('Teams')}${member.teams.map((team: string) => teamOptions.find(option => option.value === team)?.label).join(', ') || '—'}</td>${actor.owner ? h`<td class="cell-access">${cellLabel('Access')}${member.owner ? 'Owner' : h`${access(member).label}${form('person.access', '/app/people', [hidden('email', member.email), hidden('status', access(member).status)], access(member).action, { secondary: true })}`}</td>` : ''}</tr>`)}</tbody></table></div></section>
${actor.owner ? card('Invite a staff member', h`<p class="muted">Beam is for adult staff. The invitation is an ordinary sign-in email.</p>${form('person.invite', '/app/people', [field('Name', 'name'), field('Email', 'email', { type: 'email' }), checks('Roles', 'roles', roleOptions, ['learner']), teamOptions.length ? checks('Teams', 'teams', teamOptions) : ''], 'Send invitation')}`) : ''}
${card('Teams', h`${list.teams.map(team => h`<details><summary>${team.name}</summary>${form('team.members', '/app/people', [hidden('team', team.id), checks('Members', 'members', list.members.map(member => ({ value: member.id, label: member.name })), list.members.filter(member => member.teams.includes(team.id)).map(member => member.id))], 'Save members')}</details>`)}${form('team.create', '/app/people', [field('New team (for example Front desk)', 'name')], 'Add team')}`)}`
  return page('People', actor, body, { current: '/app/people', url, wide: true })
}

export async function pathsPage(env: Bindings, actor: Actor, url: URL) {
  requireRole(actor, 'manager')
  const [paths, courses, teams] = await Promise.all([listPaths(env), listCourses(env), all(env, 'SELECT id, name FROM beam_teams ORDER BY name')])
  const courseOptions = courses.map(course => ({ value: course.id, label: course.title }))
  const title = (id: string | null) => courses.find(course => course.id === id)?.title ?? ''
  const requirementRows = (path: any) => [...path.requirements, ...Array(3).fill({ course: '', prerequisite: '', dueDays: 14, renewalDays: '' })].map((requirement: any, index: number) => h`<fieldset><legend>Requirement ${index + 1}</legend>${select('Course', 'courses', courseOptions, requirement.course, { required: false, blank: '—' })}${select('Prerequisite', 'prerequisites', courseOptions, requirement.prerequisite ?? '', { required: false, blank: 'None' })}${field('Days to complete', 'dueDays', { type: 'number', value: requirement.dueDays, required: false })}${field('Renew every (days)', 'renewalDays', { type: 'number', value: requirement.renewalDays ?? '', required: false })}</fieldset>`)
  const body = h`<h1>Role paths</h1><p class="lede">A path lists the courses a team needs, in order, with prerequisites and renewal intervals. Saving creates a new path revision; earlier assignments keep theirs.</p>
${paths.map(path => card(path.name, h`<p class="muted">Team: ${teams.find(team => team.id === path.team)?.name} · ${path.number ? `revision ${path.number}` : 'no requirements yet'}</p>${path.requirements.length ? h`<ol class="rows numbered">${path.requirements.map((requirement: any) => h`<li class="row"><span class="row-text"><span class="row-title">${title(requirement.course)}</span><span class="row-meta">${days(requirement.dueDays)} to complete${requirement.prerequisite ? `, after ${title(requirement.prerequisite)}` : ''}${requirement.renewalDays ? `, renew every ${days(requirement.renewalDays)}` : ''}</span></span></li>`)}</ol>` : ''}
<p class="muted">Access window: ${describeRule(path.access)}</p>${actor.owner ? h`<details><summary>Set the access window</summary>${windowForm('access.rule', '/app/paths', [hidden('scope', 'path'), hidden('target', path.id)], path.access, 'Save window')}</details>` : ''}
${path.number ? form('path.assign', '/app/paths', [hidden('path', path.id)], 'Assign to the team') : ''}<details><summary>Edit requirements</summary>${form('path.revise', '/app/paths', [hidden('path', path.id), requirementRows(path)], 'Save as new revision')}</details>`))}
${card('New path', form('path.create', '/app/paths', [field('Name', 'name'), select('Team', 'team', teams.map(team => ({ value: team.id, label: team.name })))], 'Create path'))}`
  return page('Paths', actor, body, { current: '/app/paths', url })
}

export async function attemptPage(env: Bindings, actor: Actor, id: string, url: URL) {
  const attempt = await attemptDetail(env, actor, id)
  const names = await memberNames(env)
  const assessorId = attempt.kind === 'practical' ? (await all(env, 'SELECT s.assessor_id FROM beam_attempts t JOIN beam_assessment_revisions s ON s.id = t.assessment_revision_id WHERE t.id = ?', id))[0]?.assessor_id : null
  const assessor = actor.roles.has('assessor') && attempt.learner !== actor.id && attempt.state === 'awaiting_review' && !attempt.reset && !!assessorId && assessorId === actor.id
  const state = ({ awaiting_review: 'waiting for the assessor', accepted: 'accepted', rejected: 'returned for resubmission', scored: 'scored' } as Record<string, string>)[attempt.state] ?? attempt.state.replace(/_/g, ' ')
  const body = h`${backLink(`/app/learn/${attempt.assignment}`, 'Assignment')}<h1>${attempt.kind === 'quiz' ? 'Quiz' : 'Practical'} attempt ${attempt.number}</h1><p class="subtitle">Learner: ${names.get(attempt.learner)} · ${state}${attempt.kind === 'quiz' ? ` · ${attempt.scoringRule}` : attempt.state === 'awaiting_review' && assessorId ? ` · ${names.get(assessorId)} decides` : ''}</p>
<div class="narrow">${attempt.kind === 'quiz' ? card('Result', h`<p>Score ${attempt.score} of ${attempt.maxScore} — ${attempt.passed ? 'passed' : 'not passed'}; ${attempt.retryDecision}.</p>`) : card('Evidence', h`<p>${attempt.evidence}</p>${attempt.attachment ? h`<p><a href="/app/files/attachment/${attempt.attachment}">Download the evidence file</a></p>` : ''}`)}
${timingCard(attempt.timing, (await business(env))!.timezone)}${attempt.reset ? h`<p class="flash" role="status">Before a reset: ${attempt.reset.reason}</p>` : ''}${attempt.decision ? card('Decision', h`<p>${names.get(attempt.decision.assessor)}: ${attempt.decision.decision === 'accepted' ? 'accepted' : 'returned for resubmission'} — ${attempt.decision.note}</p>`) : ''}
${assessor ? card('Your decision', form('practical.decide', `/app/attempts/${id}`, [hidden('attempt', id), select('Decision', 'decision', [{ value: 'accepted', label: 'Accept the evidence' }, { value: 'rejected', label: 'Not yet: ask for resubmission' }]), area('Note to the learner', 'note')], 'Record decision')) : ''}</div>`
  return page('Attempt', actor, body, { url })
}

