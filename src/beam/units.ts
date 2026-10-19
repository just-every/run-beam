// ORG-002: business units and delegated learning administrators. The owner keeps
// installation, identity, providers and grants; a learning administrator manages
// the catalog, enrollment and reports of the units granted to them. Grants are
// read on every request (actor.ts), so expiry and revocation apply to every page,
// API call and download at once.
import type { Bindings } from '../auth.server'
import { requireOwner, type Actor, type Role } from './actor'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { requireBusiness } from './people'
import { addDays, zonedInstant } from './time'
import { courseUnits } from './scope'

const outside = (actor: Actor) => courseUnits(actor).length ? 'outside_your_units' : actor.authorOf.length ? 'outside_your_courses' : 'forbidden'

/** A course in a unit whose catalog this person manages: as its learning administrator, or by a courses permission (ORG-010). */
export async function courseInUnits(env: Bindings, actor: Actor, course: string) {
  const units = courseUnits(actor)
  return units.length > 0 && !!await one(env, 'SELECT 1 FROM beam_courses WHERE id = ? AND unit_id IN (SELECT value FROM json_each(?))', course, JSON.stringify(units))
}

/** The owner and the given roles reach every course; a learning administrator only their units' courses, and a
 * course's own author (ORG-003) only that course where authors are allowed. */
export async function requireCourseRole(env: Bindings, actor: Actor, course: string, ...roles: Role[]) {
  if (actor.owner || roles.some(role => actor.roles.has(role))) return
  if (roles.includes('author') && actor.authorOf.includes(course)) return
  insist(await courseInUnits(env, actor, course), outside(actor), 403)
}

/** The owner names a unit and the teams it holds; a team belongs to one unit at a time. */
export async function createUnit(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const name = input.text('name', { max: 80 })
  insist(!await one(env, 'SELECT 1 FROM beam_units WHERE name = ?', name), 'unit_exists', 409)
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_units (id, name, created_by, created_at) VALUES (?, ?, ?, ?)', id, name, actor.id, now()), ...await teamStatements(env, id, input)], { actor, action: 'unit.create', subject: id, detail: { name, teams: input.list('teams') } })
  return { id, name }
}

export async function setUnitTeams(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const unit = await requireUnit(env, input.text('unit'))
  await commit(env, [stmt(env, 'UPDATE beam_teams SET unit_id = NULL WHERE unit_id = ?', unit), ...await teamStatements(env, unit, input)], { actor, action: 'unit.teams', subject: unit, detail: { teams: input.list('teams') } })
  return { id: unit, teams: input.list('teams') }
}

async function teamStatements(env: Bindings, unit: string, input: Input) {
  const teams = input.list('teams')
  for (const team of teams) insist(await one(env, 'SELECT 1 FROM beam_teams WHERE id = ?', team), 'team_not_found', 404)
  return teams.map(team => stmt(env, 'UPDATE beam_teams SET unit_id = ? WHERE id = ?', unit, team))
}

async function requireUnit(env: Bindings, unit: string) {
  insist(await one(env, 'SELECT 1 FROM beam_units WHERE id = ?', unit), 'unit_not_found', 404)
  return unit
}

/** The owner places a course in a unit, or takes it out of every unit. */
export async function setCourseUnit(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const course = input.text('course')
  insist(await one(env, 'SELECT 1 FROM beam_courses WHERE id = ?', course), 'course_not_found', 404)
  const unit = input.text('unit', { optional: true }) || null
  if (unit) await requireUnit(env, unit)
  await commit(env, [stmt(env, 'UPDATE beam_courses SET unit_id = ? WHERE id = ?', unit, course)], { actor, action: 'course.unit', subject: course, detail: { unit } })
  return { id: course, unit }
}

/** The unit a new course goes into: optional for the owner and authors, one of their own units for an administrator. */
export async function newCourseUnit(env: Bindings, actor: Actor, input: Input) {
  const unit = input.text('unit', { optional: true }) || null
  if (!(actor.owner || actor.roles.has('author'))) {
    insist(courseUnits(actor).length, 'forbidden', 403)
    insist(unit && courseUnits(actor).includes(unit), 'outside_your_units', 403)
  }
  return unit ? await requireUnit(env, unit) : null
}

/** The grant's end: an exact instant (`expiresAt`, ISO 8601 with its offset) or the end of a day in the business's zone (`expiresOn`). */
export async function expiry(env: Bindings, input: Input) {
  const instant = input.text('expiresAt', { optional: true, max: 40 })
  const day = input.text('expiresOn', { optional: true, max: 10 })
  if (!instant && !day) return null
  const at = instant ? (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(instant) ? Date.parse(instant) : NaN) : zonedInstant(addDays(day, 1), '00:00', (await requireBusiness(env)).timezone)
  insist(Number.isFinite(at), 'invalid_expiresAt')
  insist(at > now(), 'expiry_in_past')
  return at
}

/** The owner makes a member the learning administrator of one unit, optionally until an expiry. */
export async function grantAdministration(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const member = input.text('member')
  insist(await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', member), 'person_not_found', 404)
  insist(member !== actor.id, 'owner_roles_fixed')
  const unit = await requireUnit(env, input.text('unit'))
  const expiresAt = await expiry(env, input)
  insist(!await one(env, `SELECT 1 FROM beam_admin_grants WHERE member_id = ? AND unit_id = ? AND ${ACTIVE}`, member, unit, now()), 'grant_exists', 409)
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_admin_grants (id, member_id, unit_id, granted_by, granted_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)', id, member, unit, actor.id, now(), expiresAt)], { actor, action: 'admin.grant', subject: id, detail: { member, unit, expiresAt } })
  return { id, member, unit, expiresAt }
}

export async function revokeAdministration(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const id = input.text('grant')
  const at = now()
  const result = await env.DB.batch([
    stmt(env, `UPDATE beam_admin_grants SET revoked_by = ?, revoked_at = ? WHERE id = ? AND ${ACTIVE}`, actor.id, at, id, at),
    stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, ?, ?, ?, ? WHERE changes() = 1', at, actor.id, 'admin.revoke', id, '{}'),
  ])
  insist(result[0].meta.changes === 1, 'grant_not_active', 404)
  return { id, revokedAt: at }
}

/** SQL: a grant row that is neither revoked nor past its expiry at the bound instant. */
export const ACTIVE = 'revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)'

/** Units with their teams and grants: every unit for the owner, their own active units for an administrator. */
export async function unitsView(env: Bindings, actor: Actor) {
  insist(actor.owner || actor.adminUnits.length, 'forbidden', 403)
  const at = now(), scope = actor.owner ? null : JSON.stringify(actor.adminUnits)
  const units = await all(env, `SELECT u.id, u.name, (SELECT json_group_array(json_object('id', t.id, 'name', t.name)) FROM beam_teams t WHERE t.unit_id = u.id) AS teams,
    (SELECT COUNT(*) FROM beam_courses c WHERE c.unit_id = u.id) AS courses FROM beam_units u WHERE (? IS NULL OR u.id IN (SELECT value FROM json_each(?))) ORDER BY u.name`, scope, scope)
  const grants = await all(env, `SELECT g.id, g.member_id AS member, m.name AS memberName, g.unit_id AS unit, g.granted_by AS grantedBy, g.granted_at AS grantedAt, g.expires_at AS expiresAt, g.revoked_by AS revokedBy, rm.name AS revokedByName, g.revoked_at AS revokedAt
    FROM beam_admin_grants g JOIN beam_members m ON m.id = g.member_id LEFT JOIN beam_members rm ON rm.id = g.revoked_by WHERE (? IS NULL OR g.member_id = ?) ORDER BY g.granted_at DESC, g.rowid DESC`, scope && actor.id, actor.id)
  const state = (grant: { revokedAt: number | null; expiresAt: number | null }) => grant.revokedAt ? 'revoked' : grant.expiresAt && grant.expiresAt <= at ? 'expired' : 'active'
  return { units: units.map(unit => ({ ...unit, teams: JSON.parse(unit.teams) }) as Row), grants: grants.map(grant => ({ ...grant, state: state(grant as never) }) as Row) }
}
