// The signed-in person as Beam sees them: an operator-auth session joined to
// a Beam member and that member's learning roles. The owner holds every role.
import { operatorAuth, type Bindings } from '../auth.server'
import { delegatedSession } from './agent-credentials'
import { BeamError, all, insist, newId, now, one, stmt } from './core'

export const ROLES = ['author', 'reviewer', 'learner', 'manager', 'assessor'] as const
export type Role = typeof ROLES[number]

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
  return { id: member.id, sessionId: session.id, sessionKind: 'kind' in session ? String(session.kind) : 'agent', email, name: member.name, business: member.business ?? null, owner, agent, roles, adminUnits, authorOf }
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
