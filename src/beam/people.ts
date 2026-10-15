// Flow 1: one business, adult staff identities, teams and learning roles.
import { operatorAuth, type Bindings } from '../auth.server'
import { normalizeEmail } from '../modules/operator-auth/index.mjs'
import { ROLES, ensureMember, isManager, requireOwner, requireRole, type Actor, type Role } from './actor'
import { all, commit, insist, newId, now, one, stmt } from './core'
import type { Input } from './input'
import { validTimezone } from './time'

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
  await commit(env, [stmt(env, 'INSERT INTO beam_business (singleton, name, timezone, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(singleton) DO UPDATE SET name = excluded.name, timezone = excluded.timezone, updated_at = excluded.updated_at', name, timezone, now())], { actor: actor.id, action: 'business.configure', subject: 'business', detail: { name, timezone } })
  return { name, timezone }
}

function roleList(input: Input): Role[] {
  const roles = input.list('roles')
  insist(roles.every(role => (ROLES as readonly string[]).includes(role)), 'invalid_roles')
  return roles as Role[]
}

export async function invitePerson(env: Bindings, request: Request, actor: Actor, input: Input) {
  requireOwner(actor)
  const email = normalizeEmail(input.text('email', { max: 254 }))
  insist(email, 'invalid_email')
  const name = input.text('name', { max: 120 })
  const roles = roleList(input)
  insist(roles.length > 0, 'roles_required')
  const teams = input.list('teams')
  // A member restored from an archive has no sign-in account (archives never carry them): inviting them again
  // gives them one and keeps their restored roles, teams and records.
  insist(!await one(env, 'SELECT 1 FROM beam_members WHERE email = ?', email) || !await operatorFor(env, request, email), 'already_member', 409)
  await operatorAuth(env).invite(request, { email, displayName: name, role: 'member', returnTo: '/app' })
  const member = await ensureMember(env, email, name, roles)
  for (const team of teams) insist(await one(env, 'SELECT 1 FROM beam_teams WHERE id = ?', team), 'team_not_found', 404)
  await commit(env, teams.map(team => stmt(env, 'INSERT OR IGNORE INTO beam_team_members (team_id, member_id) VALUES (?, ?)', team, member.id)), { actor: actor.id, action: 'person.invite', subject: member.id, detail: { email, roles, teams } })
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
  await commit(env, [stmt(env, 'DELETE FROM beam_member_roles WHERE member_id = ?', member.id), ...roles.map(role => stmt(env, 'INSERT INTO beam_member_roles (member_id, role) VALUES (?, ?)', member.id, role))], { actor: actor.id, action: 'person.roles', subject: member.id, detail: { roles } })
  return { email: member.email, roles }
}

export async function setAccess(env: Bindings, request: Request, actor: Actor, input: Input) {
  requireOwner(actor)
  const member = await memberByEmail(env, input.text('email', { max: 254 }))
  const status = input.text('status')
  insist(status === 'active' || status === 'inactive', 'invalid_status')
  const auth = operatorAuth(env)
  const operator = await operatorFor(env, request, member.email)
  if (!operator && status === 'active') {
    // Restored from an archive without a sign-in account: restoring access sends an ordinary invitation.
    await auth.invite(request, { email: member.email, displayName: member.name, role: 'member', returnTo: '/app' })
    await commit(env, [], { actor: actor.id, action: 'person.reinvite', subject: member.id })
    return { email: member.email, status: 'invited' }
  }
  insist(operator, 'person_not_found', 404)
  insist(operator.role !== 'owner', 'owner_access_fixed')
  await auth.setOperatorStatus(request, operator.id, status)
  if (status === 'inactive') for (const session of await auth.listSessions(request, operator.id)) if (session.active) await auth.revokeSession(request, session.id)
  await commit(env, [], { actor: actor.id, action: `person.${status}`, subject: member.id })
  return { email: member.email, status }
}

export async function createTeam(env: Bindings, actor: Actor, input: Input) {
  requireRole(actor, 'manager')
  const name = input.text('name', { max: 80 })
  insist(!await one(env, 'SELECT 1 FROM beam_teams WHERE name = ?', name), 'team_exists', 409)
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_teams (id, name, created_at) VALUES (?, ?, ?)', id, name, now())], { actor: actor.id, action: 'team.create', subject: id, detail: { name } })
  return { id, name }
}

export async function setTeamMembers(env: Bindings, actor: Actor, input: Input) {
  requireRole(actor, 'manager')
  const team = input.text('team')
  insist(await one(env, 'SELECT 1 FROM beam_teams WHERE id = ?', team), 'team_not_found', 404)
  const members = input.list('members')
  for (const member of members) insist(await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', member), 'person_not_found', 404)
  await commit(env, [stmt(env, 'DELETE FROM beam_team_members WHERE team_id = ?', team), ...members.map(member => stmt(env, 'INSERT INTO beam_team_members (team_id, member_id) VALUES (?, ?)', team, member))], { actor: actor.id, action: 'team.members', subject: team, detail: { members } })
  return { team, members }
}

export async function people(env: Bindings, request: Request, actor: Actor) {
  insist(isManager(actor), 'forbidden', 403)
  const members = await all(env, 'SELECT m.id, m.email, m.name, (SELECT json_group_array(role) FROM beam_member_roles r WHERE r.member_id = m.id) AS roles, (SELECT json_group_array(team_id) FROM beam_team_members t WHERE t.member_id = m.id) AS teams FROM beam_members m ORDER BY m.name')
  const statuses = actor.owner ? new Map((await operatorAuth(env).listOperators(request)).map(operator => [operator.email.toLowerCase(), operator])) : new Map()
  return {
    members: members.map(member => ({ id: member.id, email: member.email, name: member.name, roles: statuses.get(member.email)?.role === 'owner' ? [...ROLES] : JSON.parse(member.roles), teams: JSON.parse(member.teams), status: statuses.get(member.email)?.status ?? null, owner: statuses.get(member.email)?.role === 'owner' })),
    teams: await all(env, 'SELECT id, name FROM beam_teams ORDER BY name'),
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
