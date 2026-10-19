// ORG-010 on the People page: the owner's custom roles, their permissions and scope, and who holds each.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { all } from '../core'
import { rolesView } from '../roles'
import { card, checks, field, form, h, hidden, rows, select } from './html'

const LABELS: Record<string, string> = { courses: 'Courses', people: 'People', enrollment: 'Enrollment', reports: 'Reports', live_sessions: 'Live sessions', certificates: 'Certificates', integrations: 'Integrations', notifications: 'Notifications' }

export async function rolesCard(env: Bindings, actor: Actor, people: { id: string; name: string; owner?: boolean }[], teams: Record<string, any>[]) {
  if (!actor.owner) return ''
  const [view, units, locations] = await Promise.all([rolesView(env, actor), all<{ id: string; name: string }>(env, 'SELECT id, name FROM beam_units ORDER BY name'), all<{ location: string }>(env, 'SELECT DISTINCT location FROM beam_members WHERE location IS NOT NULL ORDER BY location')])
  const permissionOptions = view.permissions.map(permission => ({ value: permission, label: LABELS[permission] }))
  const teamOptions = teams.map(team => ({ value: team.id, label: team.name })), unitOptions = units.map(unit => ({ value: unit.id, label: unit.name }))
  const fields = (role?: Record<string, any>) => [role ? hidden('role', role.id) : '', field('Role name (for example Site training coordinator)', 'name', { value: role?.name ?? '' }), checks('Permissions', 'permissions', permissionOptions, role?.permissions ?? []),
    teamOptions.length ? checks('Limited to teams', 'teams', teamOptions, role?.teams ?? []) : '', unitOptions.length ? checks('Limited to business units', 'units', unitOptions, role?.units ?? []) : '',
    locations.length ? checks('Limited to locations (from the directory)', 'locations', locations.map(row => ({ value: row.location, label: row.location })), role?.locations ?? []) : '']
  const grantees = people.filter(person => !person.owner).map(person => ({ value: person.id, label: person.name }))
  return card('Custom roles', h`<p class="muted">A custom role gives only the ticked permissions, only within its teams, business units or locations. Owner settings, sign-in providers and named reviewer or assessor decisions are never part of one. A change applies to every holder on their next page.</p>
${view.roles.map(role => h`<details><summary>${role.name} · ${role.permissions.map((permission: string) => LABELS[permission]).join(', ')}</summary>${rows(role.holders.map((grant: any) => ({ title: grant.memberName, aside: form('role.revoke', '/app/people', [hidden('grant', grant.id)], 'Revoke', { secondary: true }) })))}
${grantees.length ? form('role.grant', '/app/people', [hidden('role', role.id), select('Give this role to', 'member', grantees)], 'Grant role') : ''}${form('role.save', '/app/people', fields(role), 'Save role')}</details>`)}
<details><summary>New custom role</summary>${form('role.save', '/app/people', fields(), 'Create role')}</details>`)
}
