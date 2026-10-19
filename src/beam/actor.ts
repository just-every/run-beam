// The signed-in person as Beam sees them: an operator-auth session joined to
// a Beam member and that member's learning roles. The owner holds every role.
import { operatorAuth, type Bindings } from '../auth.server'
import { delegatedSession } from './agent-credentials'
import { BeamError, all, insist, newId, now, one, stmt } from './core'

export const ROLES = ['author', 'reviewer', 'learner', 'manager', 'assessor'] as const
export type Role = typeof ROLES[number]

/** ORG-010: what a custom role can hold. Owner authority, provider secrets and named reviewer or assessor decisions
 * are never among them. */
export const PERMISSIONS = ['courses', 'people', 'enrollment', 'reports', 'live_sessions', 'certificates', 'integrations', 'notifications'] as const
export type Permission = typeof PERMISSIONS[number]
/** Where one permission reaches: its teams (and their members) and its business units. */
export interface Reach { teams: string[]; units: string[]; learners: string[] }

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
  /** ORG-012: set while a viewer sees Beam as this learner, read-only (view-as.ts); the request runs as the learner. */
  viewAs?: { session: string; viewer: { id: string; name: string }; expiresAt: number }
  /** Set for page requests: what the app frame shows around the page (ui/html.ts). */
  shell?: { people: number; waiting: number; now: number; zone: string }
}

export async function currentActor(env: Bindings, request: Request): Promise<Actor | null> {
  const agent = request.headers.has('authorization')
  const session = agent ? await delegatedSession(env, request) : await operatorAuth(env).getSession(request)
  if (!session) return null
  const email = session.operator.email.toLowerCase()
  const owner = session.operator.role === 'owner'
  let member = await one<{ id: string; name: string; business?: string | null }>(env, 'SELECT id, name, (SELECT name FROM beam_business WHERE singleton = 1) AS business FROM beam_members WHERE email = ?', email)
  if (!member && owner) member = await ensureMember(env, email, session.operator.displayName, [...ROLES])
  if (!member) throw new BeamError('not_a_member', 403)
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
  return { id: member.id, sessionId: session.id, sessionKind: 'kind' in session ? String(session.kind) : 'agent', email, name: member.name, business: member.business ?? null, owner, agent, roles, adminUnits, authorOf, managedTeams, teams, learners, grants, auditor }
}

/** The permissions of every custom role this member holds, merged, each with the teams, units and people it reaches. */
async function customGrants(env: Bindings, memberId: string) {
  const held = await all<{ permissions: string; teams: string; units: string }>(env, 'SELECT r.permissions, r.teams, r.units FROM beam_custom_role_grants g JOIN beam_custom_roles r ON r.id = g.role_id WHERE g.member_id = ? AND g.revoked_at IS NULL', memberId)
  const grants: Partial<Record<Permission, Reach>> = {}
  for (const role of held) for (const permission of JSON.parse(role.permissions) as Permission[]) {
    const reach = grants[permission] ??= { teams: [], units: [], learners: [] }
    reach.units = [...new Set([...reach.units, ...JSON.parse(role.units)])]
    const teams = (await all<{ id: string }>(env, 'SELECT id FROM beam_teams WHERE id IN (SELECT value FROM json_each(?)) OR unit_id IN (SELECT value FROM json_each(?))', role.teams, role.units)).map(row => row.id)
    reach.teams = [...new Set([...reach.teams, ...teams])]
  }
  for (const reach of Object.values(grants)) reach.learners = (await all<{ member_id: string }>(env, 'SELECT DISTINCT member_id FROM beam_team_members WHERE team_id IN (SELECT value FROM json_each(?))', JSON.stringify(reach.teams))).map(row => row.member_id)
  return grants
}

export async function ensureMember(env: Bindings, email: string, name: string, roles: Role[]) {
  const existing = await one<{ id: string; name: string }>(env, 'SELECT id, name FROM beam_members WHERE email = ?', email)
  if (existing) return existing
  const id = newId()
  await env.DB.batch([
    stmt(env, 'INSERT INTO beam_members (id, email, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING', id, email, name, now()),
    ...roles.map(role => stmt(env, 'INSERT OR IGNORE INTO beam_member_roles (member_id, role) SELECT id, ? FROM beam_members WHERE email = ?', role, email)),
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
