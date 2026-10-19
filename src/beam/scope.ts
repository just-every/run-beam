// Whose learning a person may manage. The owner reaches everyone; anyone else reaches the members of the teams they
// manage, directly or under unexpired coverage (ORG-004), and of their administered units' teams (ORG-002). The actor
// carries both lists, read on every request, so a grant's end or revocation applies to the next page, call or download.
import { isManager, type Actor } from './actor'
import { insist } from './core'

export const inScope = (actor: Actor, learner: string) => actor.learners === null || actor.learners.includes(learner)

/** A manager or learning administrator acting for this learner. */
export const manages = (actor: Actor, learner: string) => (isManager(actor) || actor.adminUnits.length > 0) && inScope(actor, learner)

const outside = (actor: Actor) => actor.adminUnits.length && !actor.managedTeams.length && !actor.owner ? 'outside_your_units' : 'learner_outside_your_team'

export function requireLearnerScope(actor: Actor, learner: string) {
  insist(isManager(actor) || actor.adminUnits.length, 'forbidden', 403)
  insist(inScope(actor, learner), outside(actor), 403)
}

export function requireTeamScope(actor: Actor, team: string) {
  insist(actor.teams === null || actor.teams.includes(team), outside(actor), 403)
}

/** For SQL: null for the owner, otherwise the JSON array of reachable people (or teams). Refuses everyone else. */
export function learnerScope(actor: Actor): string | null {
  insist(isManager(actor) || actor.adminUnits.length, 'forbidden', 403)
  return actor.learners && JSON.stringify(actor.learners)
}
export const teamScope = (actor: Actor): string | null => actor.teams && JSON.stringify(actor.teams)

/** SQL condition: the column is in the scope bound twice after it (null binds mean everyone). */
export const IN_SCOPE = (column: string) => `(? IS NULL OR ${column} IN (SELECT value FROM json_each(?)))`
