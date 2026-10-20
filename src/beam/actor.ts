// The signed-in person as Beam sees them: an operator-auth session joined to
// a Beam member and that member's learning roles. The owner holds every role.
import { operatorAuth, type Bindings } from '../auth.server'
import { delegatedSession } from './agent-credentials'
import { applicationActor, isAppRequest } from './app-credentials'
import { BeamError, all, insist, newId, now, one, stmt } from './core'

export const ROLES = ['author', 'reviewer', 'learner', 'manager', 'assessor'] as const
export type Role = typeof ROLES[number]

/** ORG-010: what a custom role can hold. Owner authority, provider secrets and named reviewer or assessor decisions
 * are never among them. */
export const PERMISSIONS = ['courses', 'people', 'enrollment', 'reports', 'live_sessions', 'certificates', 'integrations', 'notifications'] as const
export type Permission = typeof PERMISSIONS[number]
/** Where one permission reaches: its teams (and their members) and its business units. */
export interface Reach { teams: string[]; units: string[]; locations: string[]; learners: string[] }

export interface Actor {
  id: string
  sessionId: string
  /** How this session signed in: native (emailed link), oidc, password, dev or review; agent for a preparation credential. */
  sessionKind: string
  email: string
  name: string
  /** The business's name, once the owner has set it up. */
  business: string | null
  owner: boolean
  agent: boolean
  roles: Set<Role>
  /** ORG-002: the business units this person administers under an active grant, read on every request. */
  adminUnits: string[]
  /** ORG-003: the courses this person may author without the author role. */
  authorOf: string[]
  /** ORG-004: the teams this person manages, directly or under unexpired coverage; managing one gives the manager role. */
  managedTeams: string[]
  /** Null for the owner (every team and person); otherwise the teams this person manages or administers, and their members. */
  teams: string[] | null
  learners: string[] | null
  /** ORG-010: each permission held through custom roles, with where it reaches. */
  grants: Partial<Record<Permission, Reach>>
  /** ORG-005: holds an active auditor grant (read-only shared evidence). */
  auditor: boolean
  /** CONNECT-014: set for an application credential's request (app-credentials.ts); agent is also true. */
  app?: { id: string; name: string; audience: string }
  /** ORG-012: set while a viewer sees Beam as this learner, read-only (view-as.ts); the request runs as the learner. */
  viewAs?: { session: string; viewer: { id: string; name: string }; expiresAt: number }
  /** Set for page requests: what the app frame shows around the page (ui/html.ts). */
  shell?: { people: number; waiting: number; now: number; zone: string }
}

export async function currentActor(env: Bindings, request: Request): Promise<Actor | null> {
  if (isAppRequest(request)) return await applicationActor(env, request)
  const agent = request.headers.has('authorization')
  const session = agent ? await delegatedSession(env, request) : await operatorAuth(env).getSession(request)
  if (!session) return null
  const email = session.operator.email.toLowerCase()
  const owner = session.operator.role === 'owner'
  let member = await linkedMember(env, session.operator.id, email)
  if (!member && owner) { await ensureMember(env, email, session.operator.displayName, [...ROLES]); member = await linkedMember(env, session.operator.id, email) }
  if (!member) throw new BeamError('not_a_member', 403)
  return resolveAuthority(env, member, { sessionId: session.id, sessionKind: 'kind' in session ? String(session.kind) : 'agent', email, owner, agent })
}

/** Live authority for a saved dashboard's creator or named viewer; never a simulated session. */
export async function dashboardAuthority(env: Bindings, memberId: string): Promise<Actor | null> {
  const member = await one<{ id: string; name: string; business: string | null; email: string; role: string }>(env,
    `SELECT m.id, m.name, o.email, o.role, (SELECT name FROM beam_business WHERE singleton = 1) AS business
     FROM beam_members m JOIN oa_operators o ON o.id = m.operator_id WHERE m.id = ? AND o.status = 'active'`, memberId)
  if (!member) return null
  return resolveAuthority(env, member, { sessionId: '', sessionKind: 'dashboard-authority', email: member.email.toLowerCase(), owner: member.role === 'owner', agent: false })
}

async function resolveAuthority(env: Bindings, member: { id: string; name: string; business?: string | null },
  { sessionId, sessionKind, email, owner, agent }: { sessionId: string; sessionKind: string; email: string; owner: boolean; agent: boolean }): Promise<Actor> {
  const roles = new Set((await all<{ role: Role }>(env, 'SELECT role FROM beam_member_roles WHERE member_id = ?', member.id)).map(row => row.role))
  if (owner) ROLES.forEach(role => roles.add(role))
  // An agent credential never carries administration; the owner already holds every authority.
  const adminUnits = agent || owner ? [] : (await all<{ unit_id: string }>(env, 'SELECT DISTINCT unit_id FROM beam_admin_grants WHERE member_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY unit_id', member.id, now())).map(row => row.unit_id)
  const authorOf = (await all<{ course_id: string }>(env, 'SELECT course_id FROM beam_course_authors WHERE member_id = ? ORDER BY course_id', member.id)).map(row => row.course_id)
  const managedTeams = owner ? [] : (await all<{ team_id: string }>(env, 'SELECT DISTINCT team_id FROM beam_team_managers WHERE member_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY team_id', member.id, now())).map(row => row.team_id)
  if (managedTeams.length) roles.add('manager')
  const teams = owner ? null : (await all<{ id: string }>(env, 'SELECT id FROM beam_teams WHERE id IN (SELECT value FROM json_each(?)) OR unit_id IN (SELECT value FROM json_each(?)) ORDER BY id', JSON.stringify(managedTeams), JSON.stringify(adminUnits))).map(row => row.id)
  const learners = teams && (await all<{ member_id: string }>(env, 'SELECT DISTINCT member_id FROM beam_team_members WHERE team_id IN (SELECT value FROM json_each(?))', JSON.stringify(teams))).map(row => row.member_id)
  const grants = agent || owner ? {} : await customGrants(env, member.id)
  const auditor = !agent && !owner && !!await one(env, 'SELECT 1 FROM beam_auditor_grants WHERE member_id = ? AND revoked_at IS NULL AND expires_at > ?', member.id, now())
  return { id: member.id, sessionId, sessionKind, email, name: member.name, business: member.business ?? null, owner, agent, roles, adminUnits, authorOf, managedTeams, teams, learners, grants, auditor }
}

/** The permissions of every custom role this member holds, merged, each with the teams, units and people it reaches. */
async function customGrants(env: Bindings, memberId: string) {
  const held = await all<{ permissions: string; teams: string; units: string; locations: string }>(env, 'SELECT r.permissions, r.teams, r.units, r.locations FROM beam_custom_role_grants g JOIN beam_custom_roles r ON r.id = g.role_id WHERE g.member_id = ? AND g.revoked_at IS NULL', memberId)
  const grants: Partial<Record<Permission, Reach>> = {}
  for (const role of held) for (const permission of JSON.parse(role.permissions) as Permission[]) {
    const reach = grants[permission] ??= { teams: [], units: [], locations: [], learners: [] }
    reach.units = [...new Set([...reach.units, ...JSON.parse(role.units)])]
    const teams = (await all<{ id: string }>(env, 'SELECT id FROM beam_teams WHERE id IN (SELECT value FROM json_each(?)) OR unit_id IN (SELECT value FROM json_each(?))', role.teams, role.units)).map(row => row.id)
    reach.teams = [...new Set([...reach.teams, ...teams])]
    reach.locations = [...new Set([...reach.locations, ...JSON.parse(role.locations)])]
  }
  // ORG-001: a role limited to locations reaches the people whose directory location is one of them.
  for (const reach of Object.values(grants)) reach.learners = (await all<{ member_id: string }>(env, 'SELECT DISTINCT member_id FROM beam_team_members WHERE team_id IN (SELECT value FROM json_each(?)) UNION SELECT id FROM beam_members WHERE location IN (SELECT value FROM json_each(?))', JSON.stringify(reach.teams), JSON.stringify(reach.locations))).map(row => row.member_id)
  return grants
}

/** ORG-001: a sign-in account reaches its Beam member by account id, so a work email change keeps the same person. An
 * account not yet linked (a first sign-in after an invitation, or after an archive restore, which carries no accounts)
 * links to the member whose work email it signed in with, if that member has no live account of its own. */
async function linkedMember(env: Bindings, operatorId: string, email: string) {
  const select = 'SELECT id, name, (SELECT name FROM beam_business WHERE singleton = 1) AS business FROM beam_members'
  const linked = await one<{ id: string; name: string; business?: string | null }>(env, `${select} WHERE operator_id = ?`, operatorId)
  if (linked) return linked
  await env.DB.prepare('UPDATE beam_members SET operator_id = ? WHERE email = ? AND (operator_id IS NULL OR operator_id NOT IN (SELECT id FROM oa_operators)) AND NOT EXISTS (SELECT 1 FROM beam_members WHERE operator_id = ?)').bind(operatorId, email, operatorId).run()
  return await one<{ id: string; name: string; business?: string | null }>(env, `${select} WHERE operator_id = ?`, operatorId)
}

/** A member for this work email (created with these roles when new), linked to the email's sign-in account if it has one. */
export async function ensureMember(env: Bindings, email: string, name: string, roles: Role[]) {
  const existing = await one<{ id: string; name: string }>(env, 'SELECT id, name FROM beam_members WHERE email = ?', email)
  if (existing) return existing
  const id = newId()
  await env.DB.batch([
    stmt(env, 'INSERT INTO beam_members (id, email, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING', id, email, name, now()),
    ...roles.map(role => stmt(env, 'INSERT OR IGNORE INTO beam_member_roles (member_id, role) SELECT id, ? FROM beam_members WHERE email = ?', role, email)),
    stmt(env, 'UPDATE beam_members SET operator_id = (SELECT id FROM oa_operators WHERE lower(email) = ?) WHERE email = ? AND (operator_id IS NULL OR operator_id NOT IN (SELECT id FROM oa_operators))', email, email),
  ])
  return (await one<{ id: string; name: string }>(env, 'SELECT id, name FROM beam_members WHERE email = ?', email))!
}

export function requireRole(actor: Actor, ...roles: Role[]) {
  insist(actor.owner || roles.some(role => actor.roles.has(role)), 'forbidden', 403)
}

export function requireOwner(actor: Actor) {
  insist(actor.owner, 'owner_required', 403)
}

export const isManager = (actor: Actor) => actor.owner || actor.roles.has('manager')
