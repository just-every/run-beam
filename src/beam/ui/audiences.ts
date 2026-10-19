// AUTO-001 on the page: Automation lists the audiences this person manages, each with its rule, state, current members,
// past members with the reason they left, and exclusions with their reasons; a draft is previewed before it is enabled.
// Nothing here edits a saved rule: a changed rule is a new audience.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { audiencesView, type AudienceRule } from '../audiences'
import { all } from '../core'
import { directoryFields } from '../directory'
import { area, card, checks, field, form, h, hidden, rows, select, when } from './html'

const OUTCOME: Record<string, string> = { member: 'joined', assigned: 'joined and enrolled', already_open: 'joined; already enrolled', already_completed: 'joined; already completed the course', course_unavailable: 'joined; course not available' }
export const LEFT: Record<string, string> = { no_longer_matches: 'no longer matches', on_leave: 'on leave', left_business: 'left the business', excluded: 'excluded' }
const STATE: Record<string, string> = { draft: 'Draft: preview it first', active: 'Active: synchronizes on every roster change', paused: 'Paused' }

function describeRule(rule: AudienceRule, names: Map<string, string>) {
  const parts = [
    rule.jobRoles.length ? `role ${rule.jobRoles.join(' or ')}` : '', rule.locations.length ? `location ${rule.locations.join(' or ')}` : '', rule.departments.length ? `department ${rule.departments.join(' or ')}` : '',
    rule.teams.length ? `team ${rule.teams.map(id => names.get(id) ?? id).join(' or ')}` : '', rule.managers.length ? `manager ${rule.managers.map(id => names.get(id) ?? id).join(' or ')}` : '',
    ...Object.entries(rule.custom).map(([id, values]) => `${names.get(id) ?? id} ${values.join(' or ')}`),
    rule.hiredWithinDays !== null ? `hired within ${rule.hiredWithinDays} days` : '', rule.transferredWithinDays !== null ? `transferred within ${rule.transferredWithinDays} days` : '',
    `employment ${rule.employment.map(value => value === 'leave' ? 'on leave' : value).join(' or ')}`,
  ]
  return parts.filter(Boolean).join('; ')
}

export async function audienceCards(env: Bindings, actor: Actor, zone: string, courses: { value: string; label: string }[]) {
  const scope = actor.owner ? null : JSON.stringify(actor.adminUnits)
  const [view, fields, teams, managers, units] = await Promise.all([audiencesView(env, actor), directoryFields(env),
    all<{ id: string; name: string }>(env, 'SELECT id, name FROM beam_teams WHERE (? IS NULL OR unit_id IN (SELECT value FROM json_each(?))) ORDER BY name', scope, scope),
    all<{ id: string; name: string }>(env, 'SELECT id, name FROM beam_members WHERE id IN (SELECT manager_id FROM beam_members) ORDER BY name'),
    all<{ id: string; name: string }>(env, 'SELECT id, name FROM beam_units WHERE id IN (SELECT value FROM json_each(?)) ORDER BY name', JSON.stringify(actor.adminUnits))])
  const names = new Map([...teams, ...managers, ...fields.map(item => ({ id: item.id, name: item.label }))].map(item => [item.id, item.name]))
  const audienceCard = (audience: any) => card(audience.name, h`<p>${describeRule(audience.rule, names)}${audience.courseTitle ? h`; enrolls in <strong>${audience.courseTitle}</strong> due in ${audience.dueDays} ${audience.dueDays === 1 ? 'day' : 'days'}` : ''}.</p>
<p class="muted">${STATE[audience.state]}${audience.syncedAt ? ` · synchronized ${when(audience.syncedAt, zone)}` : ''}</p>
${audience.members.length ? h`<h3>Members (${audience.members.length})</h3>${rows(audience.members.map((item: any) => ({ title: item.name, meta: `${OUTCOME[item.outcome]} ${when(item.joinedAt, zone)}`, href: `/app/records/${item.member}`,
    aside: form('audience.exclude', '/app/automation', [hidden('audience', audience.id), hidden('member', item.member), field('Reason', 'reason')], 'Exclude', { secondary: true }) })))}` : h`<p class="muted">No members.</p>`}
${audience.history.length ? h`<details><summary>Past members</summary>${rows(audience.history.map((item: any) => ({ title: item.name, meta: `left ${when(item.leftAt, zone)}: ${LEFT[item.leftReason]} · joined ${when(item.joinedAt, zone)}` })))}</details>` : ''}
${audience.exclusions.length ? h`<h3>Exclusions</h3>${rows(audience.exclusions.map((item: any) => ({ title: item.name, meta: `${item.reason} · by ${item.excludedBy} ${when(item.excludedAt, zone)}${item.liftedAt ? ` · lifted ${when(item.liftedAt, zone)}` : ''}`,
    aside: item.liftedAt ? '' : form('audience.include', '/app/automation', [hidden('audience', audience.id), hidden('member', item.member)], 'Lift', { secondary: true }) })))}` : ''}
${form('audience.preview', '/app/automation', [hidden('audience', audience.id)], 'Preview', { secondary: true })}
${audience.state !== 'active' && audience.previewedAt ? form('audience.state', '/app/automation', [hidden('audience', audience.id), hidden('state', 'active')], 'Enable') : ''}
${audience.state === 'active' ? h`${form('audience.sync', '/app/automation', [hidden('audience', audience.id)], 'Synchronize now', { secondary: true })}${form('audience.state', '/app/automation', [hidden('audience', audience.id), hidden('state', 'paused')], 'Pause', { secondary: true })}` : ''}`, { id: `audience-${audience.id}` })
  const create = card('New audience', form('audience.save', '/app/automation', [field('Name', 'name'),
    units.length > 1 ? select('Unit', 'unit', units.map(unit => ({ value: unit.id, label: unit.name }))) : '',
    area('Roles (one per line)', 'jobRoles', '', false), area('Locations (one per line)', 'locations', '', false), area('Departments (one per line)', 'departments', '', false),
    teams.length ? checks('Teams', 'teams', teams.map(team => ({ value: team.id, label: team.name }))) : '', managers.length ? checks('Manager', 'managers', managers.map(person => ({ value: person.id, label: person.name }))) : '',
    checks('Employment', 'employment', [{ value: 'active', label: 'Active' }, { value: 'leave', label: 'On leave' }], ['active']),
    ...fields.map(item => area(`${item.label} (one value per line)`, `custom_${item.id}`, '', false)),
    field('Hired within (days)', 'hiredWithinDays', { type: 'number', required: false }), field('Transferred within (days)', 'transferredWithinDays', { type: 'number', required: false, hint: 'A transfer is a change of role, department or location.' }),
    select('Enroll in', 'course', courses, '', { required: false, blank: 'No course (membership only)' }), field('Due in (days)', 'dueDays', { type: 'number', value: 14, required: false })], 'Save as draft'))
  return h`<h2>Audiences</h2><p class="muted">An audience follows directory fields. Conditions of different kinds must all hold; values listed for one kind are alternatives. Joining enrolls the person in the audience’s course unless they already have it open or completed; leaving withdraws only the open assignment the audience made, and completions stay.</p>${view.audiences.map(audienceCard)}${create}`
}
