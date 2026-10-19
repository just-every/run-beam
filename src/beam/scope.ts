// Whose learning a person may manage. The owner reaches everyone; anyone else reaches the members of the teams they
// manage, directly or under unexpired coverage (ORG-004), of their administered units' teams (ORG-002), and, for one
// permission, of the teams and units a custom role gives them (ORG-010). The actor carries all of it, read on every
// request, so a grant's end, revocation or change applies to the next page, call or download.
import { isManager, type Actor, type Permission } from './actor'
import { insist } from './core'

const authority = (actor: Actor) => isManager(actor) || actor.adminUnits.length > 0

/** Manager or administrator scope only (no custom role): the owner, or a member of a team they manage or administer. */
export const inScope = (actor: Actor, learner: string) => actor.learners === null || actor.learners.includes(learner)

/** Holds this permission by manager or administrator authority, or through a custom role. */
export const permits = (actor: Actor, ...permissions: Permission[]) => authority(actor) || permissions.some(permission => actor.grants[permission])

/** Acting for this learner under any of these permissions (or as their manager or administrator). */
export function manages(actor: Actor, learner: string, ...permissions: Permission[]) {
  return (authority(actor) && inScope(actor, learner)) || permissions.some(permission => actor.grants[permission]?.learners.includes(learner))
}

const outside = (actor: Actor) => actor.adminUnits.length && !actor.managedTeams.length && !actor.owner ? 'outside_your_units' : 'learner_outside_your_team'

export function requireLearnerScope(actor: Actor, learner: string, ...permissions: Permission[]) {
  insist(permits(actor, ...permissions), 'forbidden', 403)
  insist(manages(actor, learner, ...permissions), outside(actor), 403)
}

export function requireTeamScope(actor: Actor, team: string, ...permissions: Permission[]) {
  const mine = authority(actor) && (actor.teams === null || actor.teams.includes(team))
  insist(mine || permissions.some(permission => actor.grants[permission]?.teams.includes(team)), outside(actor), 403)
}

const union = (actor: Actor, list: 'learners' | 'teams', permissions: Permission[]) =>
  JSON.stringify([...new Set([...(authority(actor) ? actor[list]! : []), ...permissions.flatMap(permission => actor.grants[permission]?.[list] ?? [])])])

/** For SQL: null for the owner, otherwise the JSON array of reachable people. Refuses everyone else. */
export function learnerScope(actor: Actor, ...permissions: Permission[]): string | null {
  insist(permits(actor, ...permissions), 'forbidden', 403)
  return actor.learners === null ? null : union(actor, 'learners', permissions)
}
export const teamScope = (actor: Actor, ...permissions: Permission[]): string | null => actor.teams === null ? null : union(actor, 'teams', permissions)

/** Units whose courses this person writes: administered units and those of a custom role with the courses permission. */
export const courseUnits = (actor: Actor) => [...new Set([...actor.adminUnits, ...(actor.grants.courses?.units ?? [])])]

/** SQL condition: the column is in the scope bound twice after it (null binds mean everyone). */
export const IN_SCOPE = (column: string) => `(? IS NULL OR ${column} IN (SELECT value FROM json_each(?)))`
