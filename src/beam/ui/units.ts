// ORG-002 on the People page: the owner's business units and administrator grants,
// and a learning administrator's own units with when each grant ends.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { business } from '../people'
import { unitsView } from '../units'
import { card, checks, field, form, h, hidden, rows, select, when } from './html'

const STATES: Record<string, string> = { active: 'active', expired: 'expired', revoked: 'revoked' }

export async function unitsCard(env: Bindings, actor: Actor, people: { id: string; name: string; owner?: boolean }[], teams: Record<string, any>[]) {
  if (!actor.owner && !actor.adminUnits.length) return ''
  const [view, zone] = await Promise.all([unitsView(env, actor), business(env).then(value => value!.timezone)])
  const name = (unit: string) => view.units.find(row => row.id === unit)?.name ?? unit
  const ends = (grant: any) => grant.state === 'revoked' ? `revoked ${when(grant.revokedAt, zone)} by ${grant.revokedByName}` : grant.expiresAt ? `${grant.state === 'expired' ? 'expired' : 'until'} ${when(grant.expiresAt, zone)}` : 'no end date'
  if (!actor.owner) return card('Your administration', h`<p class="muted">You manage courses, enrollment and reports for these business units.</p>${rows(view.grants.filter(grant => grant.state === 'active').map(grant => ({ title: name(grant.unit), meta: ends(grant) })))}`)
  const teamOptions = teams.map(team => ({ value: team.id, label: team.name }))
  const unitOptions = view.units.map(unit => ({ value: unit.id, label: unit.name }))
  const grantees = people.filter(person => !person.owner).map(person => ({ value: person.id, label: person.name }))
  return card('Business units and administrators', h`<p class="muted">A learning administrator manages the courses, enrollment and reports of one unit's teams. Installation, sign-in, providers and these grants stay with the owner.</p>
${view.units.map(unit => h`<details><summary>${unit.name} · ${unit.teams.map((team: any) => team.name).join(', ') || 'no teams'}</summary>${form('unit.teams', '/app/people', [hidden('unit', unit.id), checks('Teams', 'teams', teamOptions, unit.teams.map((team: any) => team.id))], 'Save teams')}</details>`)}
${view.grants.length ? rows(view.grants.map(grant => ({ title: `${grant.memberName}: ${name(grant.unit)}`, meta: `${STATES[grant.state]} · granted ${when(grant.grantedAt, zone)} · ${ends(grant)}`, aside: grant.state === 'active' ? form('admin.revoke', '/app/people', [hidden('grant', grant.id)], 'Revoke', { secondary: true }) : '' }))) : ''}
${unitOptions.length && grantees.length ? h`<details><summary>Grant administration</summary>${form('admin.grant', '/app/people', [select('Person', 'member', grantees), select('Business unit', 'unit', unitOptions), field('Ends after (optional)', 'expiresOn', { type: 'date', required: false })], 'Grant')}</details>` : ''}
<details><summary>New business unit</summary>${form('unit.create', '/app/people', [field('Name (for example North region)', 'name'), teamOptions.length ? checks('Teams', 'teams', teamOptions) : ''], 'Add unit')}</details>`)
}
