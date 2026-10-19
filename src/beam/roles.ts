// ORG-010: custom administrator roles. The owner names a role, ticks permissions
// from a fixed list and limits it to chosen teams or business units; owner
// authority, provider secrets and named reviewer or assessor decisions are never
// on the list. Holders' permissions are read on every request (actor.ts), so
// editing a role applies to every holder at once. Every save, grant and
// revocation is an audited commit.
import type { Bindings } from '../auth.server'
import { PERMISSIONS, requireOwner, type Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'

/** Creates a role, or with `role` replaces an existing role's name, permissions and scope. */
export async function saveRole(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const name = input.text('name', { max: 80 })
  const permissions = [...new Set(input.list('permissions'))]
  insist(permissions.length > 0 && permissions.every(permission => (PERMISSIONS as readonly string[]).includes(permission)), 'invalid_permissions')
  const teams = [...new Set(input.list('teams'))], units = [...new Set(input.list('units'))], locations = [...new Set(input.list('locations'))]
  insist(teams.length + units.length + locations.length > 0, 'scope_required')
  insist(locations.every(location => location.length <= 80), 'too_long_locations')
  for (const team of teams) insist(await one(env, 'SELECT 1 FROM beam_teams WHERE id = ?', team), 'team_not_found', 404)
  for (const unit of units) insist(await one(env, 'SELECT 1 FROM beam_units WHERE id = ?', unit), 'unit_not_found', 404)
  const existing = input.text('role', { optional: true })
  const at = now(), detail = { name, permissions, teams, units, locations }
  if (existing) {
    const before = await one(env, 'SELECT name, permissions, teams, units, locations FROM beam_custom_roles WHERE id = ?', existing)
    insist(before, 'role_not_found', 404)
    await commit(env, [stmt(env, 'UPDATE beam_custom_roles SET name = ?, permissions = ?, teams = ?, units = ?, locations = ?, updated_by = ?, updated_at = ? WHERE id = ?', name, JSON.stringify(permissions), JSON.stringify(teams), JSON.stringify(units), JSON.stringify(locations), actor.id, at, existing)],
      { actor, action: 'role.change', subject: existing, detail: { ...detail, before: { name: before.name, permissions: JSON.parse(before.permissions), teams: JSON.parse(before.teams), units: JSON.parse(before.units), locations: JSON.parse(before.locations) } } })
    return { id: existing, ...detail }
  }
  insist(!await one(env, 'SELECT 1 FROM beam_custom_roles WHERE name = ?', name), 'role_exists', 409)
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_custom_roles (id, name, permissions, teams, units, locations, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, name, JSON.stringify(permissions), JSON.stringify(teams), JSON.stringify(units), JSON.stringify(locations), actor.id, at, actor.id, at)],
    { actor, action: 'role.create', subject: id, detail })
  return { id, ...detail }
}

export async function grantRole(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const role = input.text('role'), member = input.text('member')
  insist(await one(env, 'SELECT 1 FROM beam_custom_roles WHERE id = ?', role), 'role_not_found', 404)
  insist(await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', member), 'person_not_found', 404)
  insist(member !== actor.id, 'owner_roles_fixed')
  insist(!await one(env, 'SELECT 1 FROM beam_custom_role_grants WHERE role_id = ? AND member_id = ? AND revoked_at IS NULL', role, member), 'grant_exists', 409)
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_custom_role_grants (id, role_id, member_id, granted_by, granted_at) VALUES (?, ?, ?, ?, ?)', id, role, member, actor.id, now())], { actor, action: 'role.grant', subject: id, detail: { role, member } })
  return { id, role, member }
}

export async function revokeRole(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const id = input.text('grant'), at = now()
  const result = await env.DB.batch([
    stmt(env, 'UPDATE beam_custom_role_grants SET revoked_by = ?, revoked_at = ? WHERE id = ? AND revoked_at IS NULL', actor.id, at, id),
    stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, ?, ?, ?, ? WHERE changes() = 1', at, actor.id, 'role.revoke', id, '{}'),
  ])
  insist(result[0].meta.changes === 1, 'grant_not_active', 404)
  return { id, revokedAt: at }
}

/** The owner's roles with their holders, or the roles this person holds. */
export async function rolesView(env: Bindings, actor: Actor) {
  const mine = actor.owner ? null : actor.id
  const roles = await all(env, 'SELECT id, name, permissions, teams, units, locations, updated_at AS updatedAt FROM beam_custom_roles r WHERE ? IS NULL OR EXISTS (SELECT 1 FROM beam_custom_role_grants g WHERE g.role_id = r.id AND g.member_id = ? AND g.revoked_at IS NULL) ORDER BY name', mine, mine)
  const grants = await all(env, 'SELECT g.id, g.role_id AS role, g.member_id AS member, m.name AS memberName, g.granted_at AS grantedAt, g.revoked_at AS revokedAt FROM beam_custom_role_grants g JOIN beam_members m ON m.id = g.member_id WHERE (? IS NULL OR g.member_id = ?) ORDER BY g.granted_at, g.rowid', mine, mine)
  return { permissions: PERMISSIONS, roles: roles.map(role => ({ ...role, permissions: JSON.parse(role.permissions), teams: JSON.parse(role.teams), units: JSON.parse(role.units), locations: JSON.parse(role.locations), holders: grants.filter(grant => grant.role === role.id && !grant.revokedAt) }) as Row), grants }
}
