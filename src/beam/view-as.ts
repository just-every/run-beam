// ORG-012: "View as". The owner, a learning administrator (ORG-002), a custom role with the people permission (ORG-010)
// or a manager for their own team opens one learner's pages exactly as that learner sees them, read-only. The view
// rides on the viewer's own sign-in plus a session cookie naming the view; on every request the view is checked again
// (open, not past its 15 minutes, viewer still holding authority over the learner) and the request runs as the learner
// with only the learner role. http.ts refuses every write, form, evidence download and non-learner page while it
// lasts; nothing it serves moves the learner's progress or viewed state. Starts and ends are audited (OPS-001).
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { commit, insist, newId, now, one, stmt } from './core'
import type { Input } from './input'
import { requireLearnerScope } from './scope'

export const VIEW_MINUTES = 15
const COOKIE = 'beam_view'

/** Refuses a view the viewer may not open: themselves, the owner, another administrator, or someone outside their reach. */
async function requireViewable(env: Bindings, viewer: Actor, learner: string) {
  insist(!viewer.agent && !viewer.viewAs, 'forbidden', 403)
  const member = await one<{ id: string; email: string; name: string }>(env, 'SELECT id, email, name FROM beam_members WHERE id = ?', learner)
  insist(member, 'person_not_found', 404)
  insist(member.id !== viewer.id, 'cannot_view_yourself', 403)
  insist(!await one(env, "SELECT 1 FROM oa_operators WHERE lower(email) = ? AND role = 'owner'", member.email), 'cannot_view_owner', 403)
  const at = now()
  const administrator = await one(env, `SELECT 1 FROM beam_admin_grants WHERE member_id = ?1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?2)
    UNION SELECT 1 FROM beam_custom_role_grants WHERE member_id = ?1 AND revoked_at IS NULL`, learner, at)
  insist(!administrator, 'cannot_view_administrator', 403)
  requireLearnerScope(viewer, learner, 'people')
  return member
}

export async function startView(env: Bindings, actor: Actor, input: Input) {
  const learner = await requireViewable(env, actor, input.text('learner'))
  const id = newId(), at = now(), expiresAt = at + VIEW_MINUTES * 60_000
  await commit(env, [
    stmt(env, "UPDATE beam_view_sessions SET ended_at = ?, end_reason = 'replaced' WHERE viewer_id = ? AND ended_at IS NULL", at, actor.id),
    stmt(env, 'INSERT INTO beam_view_sessions (id, viewer_id, learner_id, started_at, expires_at) VALUES (?, ?, ?, ?, ?)', id, actor.id, learner.id, at, expiresAt),
  ], { actor, action: 'view.start', subject: learner.id, detail: { session: id, expiresAt } })
  return { id, learner: learner.id, expiresAt }
}

/** Ends a view and records how long it lasted; a timed-out view ends at its expiry. */
async function endView(env: Bindings, viewer: string, session: { id: string; learner_id: string; started_at: number; expires_at: number }, reason: 'exit' | 'timeout' | 'authority_ended') {
  const endedAt = reason === 'timeout' ? session.expires_at : now()
  await commit(env, [stmt(env, 'UPDATE beam_view_sessions SET ended_at = ?, end_reason = ? WHERE id = ? AND ended_at IS NULL', endedAt, reason, session.id)],
    { actor: viewer, action: 'view.end', subject: session.learner_id, detail: { session: session.id, reason, startedAt: session.started_at, endedAt, seconds: Math.round((endedAt - session.started_at) / 1000) } })
  return { id: session.id, learner: session.learner_id, endedAt }
}

const cookieValue = (request: Request) => request.headers.get('cookie')?.split(/;\s*/).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? ''

/** The viewer's open view, if this request carries one. An expired view, or one whose authority has ended, ends here. */
export async function viewing(env: Bindings, request: Request, viewer: Actor): Promise<Actor | null> {
  const id = cookieValue(request)
  if (!id || viewer.agent) return null
  const session = await one<{ id: string; learner_id: string; started_at: number; expires_at: number }>(env, 'SELECT id, learner_id, started_at, expires_at FROM beam_view_sessions WHERE id = ? AND viewer_id = ? AND ended_at IS NULL', id, viewer.id)
  if (!session) return null
  if (session.expires_at <= now()) { await endView(env, viewer.id, session, 'timeout'); return null }
  const learner = await requireViewable(env, viewer, session.learner_id).catch(() => null)
  if (!learner) { await endView(env, viewer.id, session, 'authority_ended'); return null }
  return {
    id: learner.id, sessionId: session.id, sessionKind: 'view', email: learner.email, name: learner.name, business: viewer.business, owner: false, agent: false,
    roles: new Set(['learner']), adminUnits: [], authorOf: [], managedTeams: [], teams: [], learners: [], grants: {}, auditor: false,
    viewAs: { session: session.id, viewer: { id: viewer.id, name: viewer.name }, expiresAt: session.expires_at },
  }
}

/** Exit: ends the open view named by the cookie, as its viewer. */
export async function exitView(env: Bindings, request: Request, actor: Actor) {
  insist(actor.viewAs, 'not_viewing', 409)
  const session = (await one<{ id: string; learner_id: string; started_at: number; expires_at: number }>(env, 'SELECT id, learner_id, started_at, expires_at FROM beam_view_sessions WHERE id = ? AND ended_at IS NULL', actor.viewAs.session))!
  return await endView(env, actor.viewAs.viewer.id, session, 'exit')
}

export const viewCookie = (env: Bindings, value: string | null) =>
  `${COOKIE}=${value ?? ''}; Path=/; HttpOnly; SameSite=Strict${env.AUTH_ORIGIN.startsWith('https:') ? '; Secure' : ''}; Max-Age=${value ? VIEW_MINUTES * 60 : 0}`

/** While viewing: the learner's own pages and reads only. Evidence files, policy documents (opening one records it as
 * viewed), practice runs and anonymous questions stay closed. */
export const VIEW_PAGES = /^\/app(\/learning|\/learn\/[\w-]+(\/lessons\/[\w-]+|\/quiz|\/practical)?|\/attempts\/[\w-]+|\/certificates\/[\w-]+|\/acknowledgments\/[\w-]+)?$/
export const VIEW_READS = /^(me|records\/me|assignments\/[\w-]+|attempts\/[\w-]+|certificates\/[\w-]+|acknowledgments|acknowledgments\/[\w-]+|reminders)$/
