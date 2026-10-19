// ORG-005 on People: instructor grants (all courses or one unit's, optionally until an end) for the owner, and for a
// learning administrator within their own units.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { all } from '../core'
import { instructorGrants } from '../instructors'
import { business } from '../people'
import { card, field, form, h, hidden, rows, select, when } from './html'

export async function instructorsCard(env: Bindings, actor: Actor, people: { id: string; name: string }[]) {
  if (!actor.owner && !actor.adminUnits.length) return ''
  const [grants, zone, units] = await Promise.all([instructorGrants(env, actor), business(env).then(value => value!.timezone), all<{ id: string; name: string }>(env, 'SELECT id, name FROM beam_units ORDER BY name')])
  const mine = units.filter(unit => actor.owner || actor.adminUnits.includes(unit.id))
  const scope = [...(actor.owner ? [{ value: '', label: 'Every course' }] : []), ...mine.map(unit => ({ value: unit.id, label: `Courses of ${unit.name}` }))]
  return card('Instructors', h`<p class="muted">An instructor can be named on sessions of the courses their access covers, and keeps those sessions’ rosters and attendance while it lasts. They change no assessment, completion, person or policy.</p>
${grants.length ? rows(grants.map(grant => ({ title: `${grant.memberName}: ${grant.unitName ? `courses of ${grant.unitName}` : 'every course'}`, meta: grant.state === 'active' ? (grant.expiresAt ? `until ${when(grant.expiresAt, zone)}` : 'no end date') : grant.state,
  aside: grant.state === 'active' ? form('instructor.revoke', '/app/people', [hidden('grant', grant.id)], 'Revoke', { secondary: true }) : '' }))) : ''}
<details><summary>Give instructor access</summary>${form('instructor.grant', '/app/people', [select('Instructor', 'member', people.map(person => ({ value: person.id, label: person.name }))), select('Covers', 'unit', scope, actor.owner ? '' : mine[0]?.id ?? ''), field('Ends after (optional)', 'expiresOn', { type: 'date', required: false })], 'Give access')}</details>`, { id: 'instructors' })
}
