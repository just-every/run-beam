import { portalThemeCard } from './portal-theme'
import { gustoLanguageCards } from './gusto-language'
import { t, counted, localeNumber, quizDecision, quizScoringRule } from '../messages'
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
import { formatDate, localDate, usZone } from '../time'
import { providerCosts } from '../costs'
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
  // OPS-009: US time zones (with their daylight saving) come first; due dates and reminders follow each zone's rules.
  const zones = [...new Set([...(current?.timezone ? [current.timezone] : []), ...Intl.supportedValuesOf('timeZone')])], us = zones.filter(usZone)
  const costs = current ? await providerCosts(env, actor) : null
  const healthLink = current ? card('Service health', h`<p><a href="/app/business/health">Readiness, jobs, roster synchronization, limits and ownership costs</a></p>`) : ''
  const body = h`<h1>${current ? 'Business settings' : 'Set up your business'}</h1>${current ? '' : h`<p class="subtitle">Name your business and its time zone before anything else.</p>`}<div class="card settings">${form('business.configure', '/app', [field('Business name', 'name', { value: current?.name ?? '' }), select('Time zone for due dates', 'timezone', [...us.map(zone => ({ value: zone, label: zone, group: 'United States' })), ...zones.filter(zone => !usZone(zone)).map(zone => ({ value: zone, label: zone, group: 'Elsewhere' }))], current?.timezone ?? 'America/Chicago', { hint: 'Daylight saving time applies automatically.' })], 'Save')}</div>${healthLink}${current && costs ? h`${card('Provider costs (USD)', h`<p>Charged by Beam: USD ${(costs.spentCents / 100).toFixed(2)}. Estimated provider reservations today: USD ${(costs.estimatedReservedCents / 100).toFixed(2)} (${costs.timezone}). Daily model and automation ceiling: USD ${(costs.ceilingCents / 100).toFixed(2)}.</p><p class="muted">${costs.note}</p><p><a href="/app/model-account">AI preparation account and paid request history</a></p>${costs.model ? h`<p>OpenAI preparation: ${costs.model.enabled ? 'enabled' : 'disabled'} · retained reservations USD ${(costs.model.reservedEstimateCents / 100).toFixed(2)} · usage estimate USD ${(costs.model.usageEstimateCents / 100).toFixed(2)} (not an invoice). Failed or pending requests with unknown billing: ${costs.model.unknownBillingRequests}, retaining USD ${(costs.model.unknownBillingReservedCents / 100).toFixed(2)}.</p>` : ''}${costs.ocr ? h`<p>OpenAI source OCR: ${costs.ocr.enabled ? 'enabled' : 'disabled'}. Retained request estimates: USD ${(costs.ocr.reservedEstimateCents / 100).toFixed(2)} across ${costs.ocr.requests} requests, including failures and unknown outcomes. Estimated usage at declared rates: USD ${(costs.ocr.usageEstimateCents / 100).toFixed(2)}; these are not provider charges or an invoice. Approved maximum estimate per document: USD ${(costs.ocr.approvedMaximumCents / 100).toFixed(2)}. <a href="/app/sources/ocr">OCR account, limits and request history</a>.</p>` : ''}`)}${policyCard(await exceptionPolicy(env))}${card('Microsoft connections', h`<p><a href="/app/integrations/microsoft">Microsoft procedure sources</a></p><p><a href="/app/integrations/entra">Microsoft workplace identity</a></p>`)}${card('Retention and erasure', h`<p><a href="/app/erasure">Preview erasure, manage legal holds and inspect deletion reports</a></p>`) }${card('Data export', h`<p>Download learning records as documented JSON, with stable identifiers, file digests and links to original files and certificates.</p><p><a href="/app/data-export.json" download>Download learning data</a></p><p class="muted">Keep this private: it includes employee records and assessment evidence. Installation backups use rer export. <a href="https://github.com/just-every/run-beam/blob/main/docs/data-export.md">Format documentation</a>.</p>`)}` : ''}`
  return page('Business', actor, h`${body}${current ? await portalThemeCard(env, actor) : ''}`, { url })
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
<section class="card table-card" aria-labelledby="people"><h2 class="card-title table-title" id="people">People</h2><div class="table-wrap"><table class="stacked"><thead><tr><th scope="col">Name</th><th scope="col">Roles</th><th scope="col">Teams</th>${actor.owner ? h`<th scope="col">Access</th>` : ''}</tr></thead><tbody>${list.members.map(member => h`<tr><td>${cellLabel('Name')}<a href="/app/records/${member.id}">${member.name}</a><br><span class="muted">${[member.employeeId ? `ID ${member.employeeId}` : '', member.email ?? 'no work email', member.employment && member.employment !== 'active' ? EMPLOYMENT_LABELS[member.employment] : ''].filter(Boolean).join(' · ')}</span></td><td>${cellLabel('Roles')}${member.owner ? 'Owner (every role)' : actor.owner ? h`<details><summary>${roleNames(member.roles) || 'none'}</summary>${form('person.roles', '/app/people', [hidden('member', member.id), checks('Roles', 'roles', roleOptions, member.roles)], 'Save roles')}</details>` : roleNames(member.roles)}</td><td>${cellLabel('Teams')}${member.teams.map((team: string) => teamOptions.find(option => option.value === team)?.label).join(', ') || '—'}</td>${actor.owner ? h`<td class="cell-access">${cellLabel('Access')}${member.owner ? 'Owner' : member.erasedAt || member.erasurePending ? 'Erased or erasure in progress' : h`${access(member).label}${form('person.access', '/app/people', [hidden('member', member.id), hidden('status', access(member).status)], access(member).action, { secondary: true })}`}</td>` : ''}</tr>`)}</tbody></table></div></section>
${actor.owner ? card('Invite a staff member', h`<p class="muted">Beam is for adult staff. The invitation is an ordinary sign-in email.</p>${form('person.invite', '/app/people', [field('Name', 'name'), field('Email', 'email', { type: 'email' }), checks('Roles', 'roles', roleOptions, ['learner']), teamOptions.length ? checks('Teams', 'teams', teamOptions) : ''], 'Send invitation')}`)
    : unitTeams.length ? card('Invite a learner', h`<p class="muted">Beam is for adult staff. The invitation is an ordinary sign-in email; they join as a learner in the teams you choose. The owner gives other roles.</p>${form('person.invite', '/app/people', [field('Name', 'name'), field('Email', 'email', { type: 'email' }), hidden('roles', 'learner'), checks('Teams', 'teams', unitTeams)], 'Send invitation')}`) : ''}
${await directoryCards(env, actor)}
${isManager(actor) || actor.adminUnits.length ? card('Teams', h`${list.teams.map(team => teamDetails(actor, team, list, everyone, zone))}${actor.owner ? form('team.create', '/app/people', [field('New team (for example Front desk)', 'name')], 'Add team') : ''}`) : ''}
${await unitsCard(env, actor, list.members, list.teams)}
${await rolesCard(env, actor, list.members, list.teams)}
${await auditorsCard(env, actor, list.members, list.teams)}
${await instructorsCard(env, actor, list.members as { id: string; name: string }[])}
${await inactivityCard(env, actor, list.teams as { id: string; name: string }[], zone, request)}`
  return page('People', actor, h`${body}${await gustoLanguageCards(env, actor)}`, { current: '/app/people', url, wide: true })
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
  const questions = attempt.kind === 'quiz' && attempt.responses.length ? card(t(actor, 'Questions'), h`${attempt.feedback === 'withheld' ? h`<p class="muted">${t(actor, 'Which answers were right is shown later, as this course decides.')}</p>` : ''}<ol>${attempt.responses.map((response: any) => h`<li><p>${response.prompt} <span class="muted">· ${counted(actor, 'point', 'points', response.weight)}</span></p><p class="muted">${response.kind === 'text' ? t(actor, 'Written answer') : t(actor, 'Answer')}: ${answerLabel(response) || '—'}${'points' in response ? ` · ${response.points === null ? t(actor, 'waiting for the assessor') : t(actor, '{score} of {total}', { score: localeNumber(actor, response.points), total: localeNumber(actor, response.weight) })}` : ''}</p></li>`)}</ol>`) : ''
  const pendingText = attempt.responses.filter((response: any) => response.kind === 'text' && response.points === null)
  const state = ({ awaiting_review: 'waiting for the assessor', accepted: t(actor, 'accepted'), rejected: t(actor, 'returned for resubmission'), scored: 'scored' } as Record<string, string>)[attempt.state] ?? attempt.state.replace(/_/g, ' ')
  const body = h`${backLink(`/app/learn/${attempt.assignment}`, t(actor, 'Assignment'))}<h1>${t(actor, '{kind} attempt {n}', { kind: t(actor, attempt.kind === 'quiz' ? 'Quiz' : 'Practical'), n: localeNumber(actor, attempt.number) })}</h1><p class="subtitle">${t(actor, 'Learner')}: ${names.get(attempt.learner)} · ${t(actor, state)}${attempt.kind === 'quiz' ? ` · ${quizScoringRule(actor, attempt.scoringRule)}` : attempt.state === 'awaiting_review' && assessorId ? ` · ${t(actor, '{name} decides', { name: names.get(assessorId) ?? '' })}` : ''}</p>
<div class="narrow">${attempt.kind === 'quiz' ? card(t(actor, 'Result'), h`<p>${attempt.state === 'awaiting_review' ? h`${t(actor, 'Score so far {score} of {total}', { score: localeNumber(actor, attempt.score), total: localeNumber(actor, attempt.maxScore) })}` : h`${t(actor, 'Score {score} of {total}', { score: localeNumber(actor, attempt.score), total: localeNumber(actor, attempt.maxScore) })} — ${attempt.passed ? t(actor, 'passed') : t(actor, 'not passed')}`}; ${quizDecision(actor, attempt.retryDecision)}.</p>`) : card(t(actor, 'Evidence'), h`<p>${attempt.evidence}</p>${attempt.attachment ? h`<p><a href="/app/files/attachment/${attempt.attachment}">${t(actor, 'Download the evidence file')}</a></p>` : ''}`)}
${timingCard(attempt.timing, (await business(env))!.timezone, actor.locale)}${attempt.reset ? h`<p class="flash" role="status">${t(actor, 'Before a reset:')} ${attempt.reset.reason}</p>` : ''}${questions}${attempt.decision ? card(t(actor, 'Decision'), h`<p>${names.get(attempt.decision.assessor)}: ${attempt.decision.decision === 'graded' ? t(actor, 'graded the written answers') : attempt.decision.decision === 'accepted' ? t(actor, 'accepted') : t(actor, 'returned for resubmission')} — ${attempt.decision.note}</p>`) : ''}
${assessor && attempt.kind === 'quiz' ? card('Grade the written answers', form('quiz.grade', `/app/attempts/${id}`, [hidden('attempt', id), ...pendingText.map((response: any) => field(`${response.prompt} (0 to ${response.weight} points)`, `points_${response.question}`, { type: 'number' })), area('Note to the learner', 'note')], 'Record grades')) : ''}
${assessor && attempt.kind === 'practical' ? card('Your decision', form('practical.decide', `/app/attempts/${id}`, [hidden('attempt', id), select(t(actor, 'Decision'), 'decision', [{ value: 'accepted', label: 'Accept the evidence' }, { value: 'rejected', label: 'Not yet: ask for resubmission' }]), area('Note to the learner', 'note')], 'Record decision')) : ''}</div>`
  return page(t(actor, 'Attempt'), actor, body, { url })
}

