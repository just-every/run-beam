// Current human authority for a delegated integration. Provider/platform secrets stay with the owner.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { insist, one } from './core'

export function integrationHuman(actor: Actor) {
  insist(!actor.agent && !actor.viewAs, 'human_session_required', 403)
  insist(actor.owner || actor.adminUnits.length || actor.grants.integrations, 'integration_authority_required', 403)
}
export function integrationUnit(actor: Actor, unit: string | null, courses = false) {
  return actor.owner || Boolean(unit && (actor.adminUnits.includes(unit) ||
    actor.grants.integrations?.units.includes(unit) && (!courses || actor.grants.courses?.units.includes(unit))))
}
export async function integrationCourse(env: Bindings, actor: Actor, course: string, courses = false) {
  const row = await one(env, 'SELECT unit_id FROM beam_courses WHERE id=?', course)
  return Boolean(row && integrationUnit(actor, row.unit_id, courses))
}
export async function requireIntegrationCourse(env: Bindings, actor: Actor, course: string, courses = false) {
  integrationHuman(actor)
  insist(await integrationCourse(env, actor, course, courses), 'integration_outside_your_scope', 403)
}
export async function integrationTeam(env: Bindings, actor: Actor, team: string) {
  if (actor.owner) return true
  const row = await one(env, 'SELECT unit_id FROM beam_teams WHERE id=?', team)
  return Boolean(row && (actor.adminUnits.includes(row.unit_id) || actor.grants.integrations?.teams.includes(team)))
}
