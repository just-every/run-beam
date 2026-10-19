// Flow 1: one business, adult staff identities, teams and learning roles.
import { operatorAuth, type Bindings } from '../auth.server'
import { normalizeEmail } from '../modules/operator-auth/index.mjs'
import { ROLES, ensureMember, requireOwner, type Actor, type Permission, type Role } from './actor'
import { all, commit, insist, newId, now, one, stmt } from './core'
import type { Input } from './input'
import { validTimezone } from './time'
import { teamManagers } from './managers'
import { IN_SCOPE, inScope, learnerScope, teamScope } from './scope'

export interface Business { name: string; timezone: string }

export async function business(env: Bindings): Promise<Business | null> {
  return await one<Business>(env, 'SELECT name, timezone FROM beam_business WHERE singleton = 1')
}

export async function requireBusiness(env: Bindings): Promise<Business> {
  const value = await business(env)
  insist(value, 'business_not_configured', 409)
  return value
}

export async function configureBusiness(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const name = input.text('name', { max: 120 })
  const timezone = input.text('timezone', { max: 64 })
  insist(validTimezone(timezone), 'invalid_timezone')
  await commit(env, [stmt(env, 'INSERT INTO beam_business (singleton, name, timezone, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(singleton) DO UPDATE SET name = excluded.name, timezone = excluded.timezone, updated_at = excluded.updated_at', name, timezone, now())], { actor, action: 'business.configure', subject: 'business', detail: { name, timezone } })
  return { name, timezone }
}

function roleList(input: Input): Role[] {
  const roles = input.list('roles')
  insist(roles.every(role => (ROLES as readonly string[]).includes(role)), 'invalid_roles')
  return roles as Role[]
}

/** ORG-002: a learning administrator changes only the teams of the units they administer; the owner changes any team. */
async function requireUnitTeams(env: Bindings, actor: Actor, teams: string[]) {
  if (!actor.owner) insist(actor.adminUnits.length, 'owner_required', 403)
  for (const team of teams) {
    const row = await one<{ unit_id: string | null }>(env, 'SELECT unit_id FROM beam_teams WHERE id = ?', team)
    insist(row, 'team_not_found', 404)
    insist(actor.owner || actor.adminUnits.includes(row.unit_id ?? ''), 'outside_your_units', 403)
  }
}

/** The owner invites anyone with any roles; a learning administrator invites new learners into their units' teams. */
export async function invitePerson(env: Bindings, request: Request, actor: Actor, input: Input) {
  const teams = input.list('teams')
  await requireUnitTeams(env, actor, teams)
  insist(actor.owner || teams.length > 0, 'outside_your_units', 403)
  const email = normalizeEmail(input.text('email', { max: 254 }))
  insist(email, 'invalid_email')
  const name = input.text('name', { max: 120 })
  const roles = roleList(input)
  insist(roles.length > 0, 'roles_required')
  // Roles reach the whole installation, so only the owner gives more than the learner role.
  insist(actor.owner || roles.every(role => role === 'learner'), 'owner_required', 403)
  // A member restored from an archive has no sign-in account (archives never carry them): the owner inviting them
  // again gives them one and keeps their restored roles, teams and records. An administrator invites only new people.
  const existing = await one(env, 'SELECT 1 FROM beam_members WHERE email = ?', email)
  insist(!existing || (actor.owner && !await operatorFor(env, request, email)), 'already_member', 409)
  await operatorAuth(env).invite(request, { email, displayName: name, role: 'member', returnTo: '/app' })
  const member = await ensureMember(env, email, name, roles)
  await commit(env, teams.map(team => stmt(env, 'INSERT OR IGNORE INTO beam_team_members (team_id, member_id) VALUES (?, ?)', team, member.id)), { actor, action: 'person.invite', subject: member.id, detail: { email, roles, teams } })
  return { id: member.id, email, roles, teams }
}

async function operatorFor(env: Bindings, request: Request, email: string) {
  return (await operatorAuth(env).listOperators(request)).find(candidate => candidate.email.toLowerCase() === email)
}

async function memberByEmail(env: Bindings, value: string) {
  const member = await one<{ id: string; email: string; name: string }>(env, 'SELECT id, email, name FROM beam_members WHERE email = ?', normalizeEmail(value))
  insist(member, 'person_not_found', 404)
  return member
}

export async function setRoles(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const member = await memberByEmail(env, input.text('email', { max: 254 }))
  insist(member.id !== actor.id, 'owner_roles_fixed')
  const roles = roleList(input)
  await commit(env, [stmt(env, 'DELETE FROM beam_member_roles WHERE member_id = ?', member.id), ...roles.map(role => stmt(env, 'INSERT INTO beam_member_roles (member_id, role) VALUES (?, ?)', member.id, role))], { actor, action: 'person.roles', subject: member.id, detail: { roles } })
  return { email: member.email, roles }
}

export async function setAccess(env: Bindings, request: Request, actor: Actor, input: Input) {
  const status = input.text('status')
  insist(status === 'active' || status === 'inactive', 'invalid_status')
  return await changeAccess(env, request, actor, input.text('email', { max: 254 }), status)
}

/** The owner removes or restores one person's access through Base: removal ends their sessions; evidence stays. */
export async function changeAccess(env: Bindings, request: Request, actor: Actor, email: string, status: 'active' | 'inactive', detail?: unknown) {
  requireOwner(actor)
  const member = await memberByEmail(env, email)
  const auth = operatorAuth(env)
  const operator = await operatorFor(env, request, member.email)
  if (!operator && status === 'active') {
    // Restored from an archive without a sign-in account: restoring access sends an ordinary invitation.
    await auth.invite(request, { email: member.email, displayName: member.name, role: 'member', returnTo: '/app' })
    await commit(env, [], { actor, action: 'person.reinvite', subject: member.id })
    return { email: member.email, status: 'invited' }
  }
  insist(operator, 'person_not_found', 404)
  insist(operator.role !== 'owner', 'owner_access_fixed')
  await auth.setOperatorStatus(request, operator.id, status)
  if (status === 'inactive') for (const session of await auth.listSessions(request, operator.id)) if (session.active) await auth.revokeSession(request, session.id)
  await commit(env, [], { actor, action: `person.${status}`, subject: member.id, detail })
  return { email: member.email, status }
}

/** The owner creates teams and names their managers (ORG-004); a team's managers act only for its members. */
export async function createTeam(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const name = input.text('name', { max: 80 })
  insist(!await one(env, 'SELECT 1 FROM beam_teams WHERE name = ?', name), 'team_exists', 409)
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_teams (id, name, created_at) VALUES (?, ?, ?)', id, name, now())], { actor, action: 'team.create', subject: id, detail: { name } })
  return { id, name }
}

/** Sets a team's members: the owner for any team; a learning administrator (ORG-002) for a team of their units, from
 * people already in their units' teams, so nobody outside their units is drawn in. */
export async function setTeamMembers(env: Bindings, actor: Actor, input: Input) {
  const team = input.text('team')
  await requireUnitTeams(env, actor, [team])
  const members = input.list('members')
  for (const member of members) insist(await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', member), 'person_not_found', 404)
  for (const member of members) insist(actor.owner || inScope(actor, member), 'outside_your_units', 403)
  await commit(env, [stmt(env, 'DELETE FROM beam_team_members WHERE team_id = ?', team), ...members.map(member => stmt(env, 'INSERT INTO beam_team_members (team_id, member_id) VALUES (?, ?)', team, member))], { actor, action: 'team.members', subject: team, detail: { members } })
  return { team, members }
}

/** Everyone for the owner; a manager sees their teams' people (ORG-004), a learning administrator their units' (ORG-002). */
export async function people(env: Bindings, request: Request, actor: Actor, ...permissions: Permission[]) {
  const reach: Permission[] = permissions.length ? permissions : ['people']
  const scope = learnerScope(actor, ...reach), teams = teamScope(actor, ...reach)
  const members = await all(env, `SELECT m.id, m.email, m.name, (SELECT json_group_array(role) FROM beam_member_roles r WHERE r.member_id = m.id) AS roles, (SELECT json_group_array(team_id) FROM beam_team_members t WHERE t.member_id = m.id) AS teams FROM beam_members m
    WHERE ${IN_SCOPE('m.id')} ORDER BY m.name`, scope, scope)
  const statuses = actor.owner ? new Map((await operatorAuth(env).listOperators(request)).map(operator => [operator.email.toLowerCase(), operator])) : new Map()
  return {
    members: members.map(member => ({ id: member.id, email: member.email, name: member.name, roles: statuses.get(member.email)?.role === 'owner' ? [...ROLES] : JSON.parse(member.roles), teams: JSON.parse(member.teams), status: statuses.get(member.email)?.status ?? null, owner: statuses.get(member.email)?.role === 'owner' })),
    teams: await all(env, `SELECT id, name, unit_id AS unit FROM beam_teams WHERE ${IN_SCOPE('id')} ORDER BY name`, teams, teams),
    managers: await teamManagers(env, actor.teams),
  }
}

/** Names for display: members are visible by name to every signed-in member. */
export async function memberNames(env: Bindings): Promise<Map<string, string>> {
  return new Map((await all<{ id: string; name: string }>(env, 'SELECT id, name FROM beam_members')).map(row => [row.id, row.name]))
}

export async function membersWithRole(env: Bindings, role: Role) {
  const owner = await one<{ email: string }>(env, "SELECT email FROM oa_operators WHERE role = 'owner'")
  return await all<{ id: string; name: string; email: string }>(env, 'SELECT DISTINCT m.id, m.name, m.email FROM beam_members m LEFT JOIN beam_member_roles r ON r.member_id = m.id WHERE r.role = ? OR m.email = ? ORDER BY m.name', role, owner?.email ?? '')
}
