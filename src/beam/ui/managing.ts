// Owner and manager pages: business, people and teams, paths, and practical attempts for their assessor. The
// manager's main screen is ui/compliance.ts.
import type { Bindings } from '../../auth.server'
import { ROLES, isManager, requireOwner, requireRole, type Actor } from '../actor'
import { listPaths } from '../assignments'
import { listCourses } from '../courses'
import { all } from '../core'
import { computeDues } from '../due-rules'
import { attemptDetail } from '../learning'
import { business, memberNames, people } from '../people'
import { queues } from '../records'
import { formatDate, localDate } from '../time'
import { area, backLink, card, cellLabel, checks, field, fileField, form, h, hidden, page, rows, select, when } from './html'
import { describeRule, windowForm } from './access'
import { timingCard } from './timing'
import { unitsCard } from './units'
import { rolesCard } from './roles'
import { auditorsCard } from './evidence'
import { policyCard } from './exceptions'
import { inactivityCard } from './inactivity'
import { exceptionPolicy } from '../exceptions'
import { sessionOptionCounts } from '../live'
import { instructorsCard } from './instructors'
import { EMPLOYMENT_LABELS, directoryCards } from './directory'

const ROLE_LABELS: Record<string, string> = { author: 'Author', reviewer: 'Reviewer', learner: 'Learner', manager: 'Manager', assessor: 'Assessor' }
const roleOptions = ROLES.map(role => ({ value: role, label: ROLE_LABELS[role] }))
const days = (value: number | string) => `${value} ${Number(value) === 1 ? 'day' : 'days'}`

const ANCHOR_OPTIONS = [{ value: 'enrollment', label: 'Days after enrollment' }, { value: 'hire', label: 'Days after the hire date' }, { value: 'transfer', label: 'Days after the transfer date' }, { value: 'prerequisite', label: 'Days after completing the prerequisite' }, { value: 'fixed', label: 'On a fixed date' }]
const SKIPPED: Record<string, string> = { no_hire_date: 'no hire date in the directory', no_transfer_date: 'no transfer date in the directory' }
const ANCHOR_TEXT: Record<string, string> = { enrollment: 'enrollment', hire: 'the hire date', transfer: 'the transfer date', prerequisite: 'completing the prerequisite' }

export async function businessPage(env: Bindings, actor: Actor, url: URL) {
  requireOwner(actor)
  const current = await business(env)
  const zones = Intl.supportedValuesOf('timeZone')
  const body = h`<h1>${current ? 'Business settings' : 'Set up your business'}</h1>${current ? '' : h`<p class="subtitle">Name your business and its time zone before anything else.</p>`}<div class="card settings">${form('business.configure', '/app', [field('Business name', 'name', { value: current?.name ?? '' }), select('Time zone for due dates', 'timezone', zones.map(zone => ({ value: zone, label: zone })), current?.timezone ?? 'America/Chicago')], 'Save')}</div>${current ? policyCard(await exceptionPolicy(env)) : ''}`
  return page('Business', actor, body, { url })
}

// ORG-004: the owner names each team's managers; the owner, or a learning administrator for a team of their units
// (ORG-002), sets its members. The owner or a direct manager hands the team to someone for a while (coverage), with an
// end and a reason, and either can end it early.
function teamDetails(actor: Actor, team: Record<string, any>, list: Awaited<ReturnType<typeof people>>, everyone: { value: string; label: string }[], zone: string) {
  const grants = list.managers.filter(grant => grant.team === team.id && grant.state === 'active')
  const direct = grants.filter(grant => grant.kind === 'direct'), coverage = grants.filter(grant => grant.kind === 'coverage')
  const mine = actor.owner || direct.some(grant => grant.member === actor.id)
  const members = actor.owner || actor.adminUnits.includes(team.unit)
  return h`<details><summary>${team.name} · ${direct.map(grant => grant.memberName).join(', ') || 'no manager'}</summary>
${members ? form('team.members', '/app/people', [hidden('team', team.id), checks('Members', 'members', list.members.map(member => ({ value: member.id, label: member.name })), list.members.filter(member => member.teams.includes(team.id)).map(member => member.id))], 'Save members') : ''}${actor.owner ? form('team.managers', '/app/people', [hidden('team', team.id), checks('Managers', 'members', everyone, direct.map(grant => grant.member), { scroll: true })], 'Save managers') : ''}
${coverage.length ? rows(coverage.map(grant => ({ title: `${grant.memberName} covers until ${when(grant.expiresAt, zone)}`, meta: grant.reason, aside: actor.owner || grant.grantedBy === actor.id ? form('team.coverage.end', '/app/people', [hidden('grant', grant.id)], 'End coverage', { secondary: true }) : '' }))) : ''}
${mine ? h`<details><summary>Hand this team to someone for a while</summary>${form('team.coverage', '/app/people', [hidden('team', team.id), select('Covering manager', 'member', everyone), field('Ends after', 'expiresOn', { type: 'date' }), area('Reason', 'reason')], 'Grant coverage')}</details>` : ''}</details>`
}

export async function peoplePage(env: Bindings, actor: Actor, request: Request, url: URL) {
  const list = await people(env, request, actor)
  const everyone = [...await memberNames(env)].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  const zone = (await business(env))!.timezone
  const teamOptions = list.teams.map(team => ({ value: team.id, label: team.name }))
  const unitTeams = list.teams.filter(team => actor.adminUnits.includes(team.unit)).map(team => ({ value: team.id, label: team.name }))
  const roleNames = (roles: string[]) => roles.map(role => ROLE_LABELS[role]).join(', ')
  // A member restored from an archive has no sign-in account yet: Restore access sends them an invitation.
  const access = (member: any) => member.status === 'inactive' ? { label: 'No access', action: 'Restore access', status: 'active' } : member.status === null ? { label: 'Needs an invitation', action: 'Restore access', status: 'active' } : { label: member.status === 'invited' ? 'Invited' : 'Active', action: 'Remove access', status: 'inactive' }
  const body = h`<h1>People and teams</h1>
<section class="card table-card" aria-labelledby="people"><h2 class="card-title table-title" id="people">People</h2><div class="table-wrap"><table class="stacked"><thead><tr><th scope="col">Name</th><th scope="col">Roles</th><th scope="col">Teams</th>${actor.owner ? h`<th scope="col">Access</th>` : ''}</tr></thead><tbody>${list.members.map(member => h`<tr><td>${cellLabel('Name')}<a href="/app/records/${member.id}">${member.name}</a><br><span class="muted">${[member.employeeId ? `ID ${member.employeeId}` : '', member.email ?? 'no work email', member.employment && member.employment !== 'active' ? EMPLOYMENT_LABELS[member.employment] : ''].filter(Boolean).join(' · ')}</span></td><td>${cellLabel('Roles')}${member.owner ? 'Owner (every role)' : actor.owner ? h`<details><summary>${roleNames(member.roles) || 'none'}</summary>${form('person.roles', '/app/people', [hidden('member', member.id), checks('Roles', 'roles', roleOptions, member.roles)], 'Save roles')}</details>` : roleNames(member.roles)}</td><td>${cellLabel('Teams')}${member.teams.map((team: string) => teamOptions.find(option => option.value === team)?.label).join(', ') || '—'}</td>${actor.owner ? h`<td class="cell-access">${cellLabel('Access')}${member.owner ? 'Owner' : h`${access(member).label}${form('person.access', '/app/people', [hidden('member', member.id), hidden('status', access(member).status)], access(member).action, { secondary: true })}`}</td>` : ''}</tr>`)}</tbody></table></div></section>
${actor.owner ? card('Invite a staff member', h`<p class="muted">Beam is for adult staff. The invitation is an ordinary sign-in email.</p>${form('person.invite', '/app/people', [field('Name', 'name'), field('Email', 'email', { type: 'email' }), checks('Roles', 'roles', roleOptions, ['learner']), teamOptions.length ? checks('Teams', 'teams', teamOptions) : ''], 'Send invitation')}`)
    : unitTeams.length ? card('Invite a learner', h`<p class="muted">Beam is for adult staff. The invitation is an ordinary sign-in email; they join as a learner in the teams you choose. The owner gives other roles.</p>${form('person.invite', '/app/people', [field('Name', 'name'), field('Email', 'email', { type: 'email' }), hidden('roles', 'learner'), checks('Teams', 'teams', unitTeams)], 'Send invitation')}`) : ''}
${await directoryCards(env, actor)}
${isManager(actor) || actor.adminUnits.length ? card('Teams', h`${list.teams.map(team => teamDetails(actor, team, list, everyone, zone))}${actor.owner ? form('team.create', '/app/people', [field('New team (for example Front desk)', 'name')], 'Add team') : ''}`) : ''}
${await unitsCard(env, actor, list.members, list.teams)}
${await rolesCard(env, actor, list.members, list.teams)}
${await auditorsCard(env, actor, list.members, list.teams)}
${await instructorsCard(env, actor, list.members as { id: string; name: string }[])}
${await inactivityCard(env, actor, list.teams as { id: string; name: string }[], zone, request)}`
  return page('People', actor, body, { current: '/app/people', url, wide: true })
}

export async function pathsPage(env: Bindings, actor: Actor, url: URL) {
  requireRole(actor, 'manager')
  const teamIds = actor.teams && JSON.stringify(actor.teams)
  const [paths, courses, sessionOptions, teams] = await Promise.all([listPaths(env, actor), listCourses(env), sessionOptionCounts(env), all(env, 'SELECT id, name FROM beam_teams WHERE (? IS NULL OR id IN (SELECT value FROM json_each(?))) ORDER BY name', teamIds, teamIds)])
  // A retired course stays named on the paths that hold it but is not offered for new requirements (AUTHOR-005).
  const courseOptions = courses.filter(course => !course.retiredAt).map(course => ({ value: course.id, label: course.title }))
  const title = (id: string | null) => courses.find(course => course.id === id)?.title ?? ''
  // AUTO-003: the due dates assigning each path now would set, computed without writing anything.
  const previews = new Map<string, unknown>()
  for (const path of paths.filter(item => item.revision)) {
    const members = (await all<{ member_id: string }>(env, 'SELECT member_id FROM beam_team_members WHERE team_id = ?', path.team)).map(row => row.member_id)
    const { dues } = await computeDues(env, path.revision, members)
    previews.set(path.id, dues.length ? h`<details><summary>Due dates if assigned now</summary>${rows(dues.slice(0, 300).map(due => ({ title: `${due.name}: ${title(due.course)}`, meta: due.dueAt ? `due ${when(due.dueAt, due.timezone, due.timezone)} (${due.timezone})` : `not assigned: ${SKIPPED[due.skipped!] ?? due.skipped}` })))}</details>` : '')
  }
  const requirementRows = (path: any) => [...path.requirements, ...Array(3).fill({ course: '', prerequisite: '', dueDays: 14, renewalDays: '' })].map((requirement: any, index: number) => h`<fieldset><legend>Requirement ${index + 1}</legend>${select('Course', 'courses', courseOptions, requirement.course, { required: false, blank: '—' })}${select('Prerequisite', 'prerequisites', courseOptions, requirement.prerequisite ?? '', { required: false, blank: 'None' })}${select('Due', 'dueAnchors', ANCHOR_OPTIONS, requirement.dueAnchor ?? 'enrollment')}${field('Days after it', 'dueDays', { type: 'number', value: requirement.dueAnchor === 'fixed' ? '' : requirement.dueDays, required: false })}${field('Fixed due date', 'dueOn', { type: 'date', value: requirement.dueOn ?? '', required: false, hint: 'Only when due on a fixed date.' })}${field('Renew every (days)', 'renewalDays', { type: 'number', value: requirement.renewalDays ?? '', required: false })}</fieldset>`)
  const body = h`<h1>Role paths</h1><p class="lede">A path lists the courses a team needs, in order, with prerequisites and renewal intervals. Saving creates a new path revision; earlier assignments keep theirs. A course with scheduled sessions makes the path blended: its learners choose a session under Sessions once its prerequisite is complete.</p>
${paths.map(path => card(path.name, h`<p class="muted">Team: ${teams.find(team => team.id === path.team)?.name} · ${path.number ? `revision ${path.number}` : 'no requirements yet'}</p>${path.requirements.length ? h`<ol class="rows numbered">${path.requirements.map((requirement: any) => h`<li class="row"><span class="row-text"><span class="row-title">${title(requirement.course)}</span><span class="row-meta">${requirement.dueAnchor === 'fixed' ? `due ${requirement.dueOn}` : `due ${days(requirement.dueDays)} after ${ANCHOR_TEXT[requirement.dueAnchor ?? 'enrollment']}`}${requirement.prerequisite ? `, after ${title(requirement.prerequisite)}` : ''}${requirement.renewalDays ? `, renew every ${days(requirement.renewalDays)}` : ''}${sessionOptions.get(requirement.course) ? h`, <a href="/app/sessions">${sessionOptions.get(requirement.course)} scheduled ${sessionOptions.get(requirement.course) === 1 ? 'session' : 'sessions'}</a>` : ''}</span></span></li>`)}</ol>` : ''}
<p class="muted">Access window: ${describeRule(path.access)}</p>${actor.owner ? h`<details><summary>Set the access window</summary>${windowForm('access.rule', '/app/paths', [hidden('scope', 'path'), hidden('target', path.id)], path.access, 'Save window')}</details>` : ''}
${path.number ? h`${previews.get(path.id)}${form('path.assign', '/app/paths', [hidden('path', path.id)], 'Assign to the team')}` : ''}<details><summary>Edit requirements</summary>${form('path.revise', '/app/paths', [hidden('path', path.id), requirementRows(path)], 'Save as new revision')}</details>`))}
${card('New path', form('path.create', '/app/paths', [field('Name', 'name'), select('Team', 'team', teams.map(team => ({ value: team.id, label: team.name })))], 'Create path'))}`
  return page('Paths', actor, body, { current: '/app/paths', url })
}

export async function attemptPage(env: Bindings, actor: Actor, id: string, url: URL) {
  const attempt = await attemptDetail(env, actor, id)
  const names = await memberNames(env)
  const assessorId = attempt.assessor ?? null
  const assessor = actor.roles.has('assessor') && attempt.learner !== actor.id && attempt.state === 'awaiting_review' && !attempt.reset && !!assessorId && assessorId === actor.id
  // LEARN-001: each question asked, the answer given and, where the feedback timing allows, the points it earned.
  const answerLabel = (response: any) => Array.isArray(response.answer) ? response.answer.map((part: unknown) => part === -1 || part === '' ? '—' : String(typeof part === 'number' && response.kind === 'choice' ? part + 1 : part)).join(', ') : ''
  const questions = attempt.kind === 'quiz' && attempt.responses.length ? card('Questions', h`${attempt.feedback === 'withheld' ? h`<p class="muted">Which answers were right is shown later, as this course decides.</p>` : ''}<ol>${attempt.responses.map((response: any) => h`<li><p>${response.prompt} <span class="muted">· ${response.weight} ${response.weight === 1 ? 'point' : 'points'}</span></p><p class="muted">${response.kind === 'text' ? 'Written answer' : 'Answer'}: ${answerLabel(response) || '—'}${'points' in response ? ` · ${response.points === null ? 'waiting for the assessor' : `${response.points} of ${response.weight}`}` : ''}</p></li>`)}</ol>`) : ''
  const pendingText = attempt.responses.filter((response: any) => response.kind === 'text' && response.points === null)
  const state = ({ awaiting_review: 'waiting for the assessor', accepted: 'accepted', rejected: 'returned for resubmission', scored: 'scored' } as Record<string, string>)[attempt.state] ?? attempt.state.replace(/_/g, ' ')
  const body = h`${backLink(`/app/learn/${attempt.assignment}`, 'Assignment')}<h1>${attempt.kind === 'quiz' ? 'Quiz' : 'Practical'} attempt ${attempt.number}</h1><p class="subtitle">Learner: ${names.get(attempt.learner)} · ${state}${attempt.kind === 'quiz' ? ` · ${attempt.scoringRule}` : attempt.state === 'awaiting_review' && assessorId ? ` · ${names.get(assessorId)} decides` : ''}</p>
<div class="narrow">${attempt.kind === 'quiz' ? card('Result', h`<p>${attempt.state === 'awaiting_review' ? h`Score so far ${attempt.score} of ${attempt.maxScore}` : h`Score ${attempt.score} of ${attempt.maxScore} — ${attempt.passed ? 'passed' : 'not passed'}`}; ${attempt.retryDecision}.</p>`) : card('Evidence', h`<p>${attempt.evidence}</p>${attempt.attachment ? h`<p><a href="/app/files/attachment/${attempt.attachment}">Download the evidence file</a></p>` : ''}`)}
${timingCard(attempt.timing, (await business(env))!.timezone)}${attempt.reset ? h`<p class="flash" role="status">Before a reset: ${attempt.reset.reason}</p>` : ''}${questions}${attempt.decision ? card('Decision', h`<p>${names.get(attempt.decision.assessor)}: ${attempt.decision.decision === 'graded' ? 'graded the written answers' : attempt.decision.decision === 'accepted' ? 'accepted' : 'returned for resubmission'} — ${attempt.decision.note}</p>`) : ''}
${assessor && attempt.kind === 'quiz' ? card('Grade the written answers', form('quiz.grade', `/app/attempts/${id}`, [hidden('attempt', id), ...pendingText.map((response: any) => field(`${response.prompt} (0 to ${response.weight} points)`, `points_${response.question}`, { type: 'number' })), area('Note to the learner', 'note')], 'Record grades')) : ''}
${assessor && attempt.kind === 'practical' ? card('Your decision', form('practical.decide', `/app/attempts/${id}`, [hidden('attempt', id), select('Decision', 'decision', [{ value: 'accepted', label: 'Accept the evidence' }, { value: 'rejected', label: 'Not yet: ask for resubmission' }]), area('Note to the learner', 'note')], 'Record decision')) : ''}</div>`
  return page('Attempt', actor, body, { url })
}

