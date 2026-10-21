// A preparation-only delegation of a live human session. The signed token is
// never a session cookie and stores no credential in Beam's portable data.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { insist, now, one } from './core'
import type { Input } from './input'
import { requireLoopback } from '../modules/operator-auth/index.mjs'

const PURPOSE = 'beam-preparation-v1'
const encoder = new TextEncoder()
const PREPARATION_ACTIONS = new Set([
  'course.create', 'course.details', 'course.lesson', 'course.lesson.remove',
  'course.block', 'course.block.change', 'course.block.reuse',
  'course.lesson.move', 'course.question', 'course.question.remove',
  'course.assessment', 'course.survey', 'course.submit', 'proposal.create', 'impact.propose', 'agent.propose', 'outcome.plan', 'diagnosis.prepare',
])
// Each handler still checks the specific role its action or view needs.
const PREPARERS = ['author', 'reviewer', 'manager'] as const
const PREPARATION_READ = /^(me|members|sources|courses|courses\/[\w-]+|revisions\/[\w-]+|source-files\/[\w-]+|people|paths|report|proposals|proposals\/[\w-]+|impact\/[\w-]+|questions\/[\w-]+|diagnosis-imports\/[\w-]+)$/

async function signingKey(env: Bindings) {
  return crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

async function liveSession(env: Bindings, id: string) {
  // Dev/review sessions depend on request-local admission. They cannot mint or
  // back delegations: use an ordinary email-link or OIDC sign-in instead.
  return one<{ id: string; expiresAt: number; operatorId: string; email: string; name: string; role: string }>(env, `SELECT s.id, s.expires_at AS expiresAt, o.id AS operatorId, o.email, o.display_name AS name, o.role
    FROM oa_sessions s JOIN oa_operators o ON o.id = s.operator_id
    WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ?
      AND s.kind IN ('native', 'oidc') AND o.status = 'active' AND s.operator_version = o.version`, id, now())
}

export async function issueAgentCredential(env: Bindings, actor: Actor, input: Input) {
  insist(!actor.agent, 'human_session_required', 403)
  insist(PREPARERS.some(role => actor.roles.has(role)), 'forbidden', 403)
  const session = await liveSession(env, actor.sessionId)
  insist(session, 'ordinary_signin_required', 403)
  const seconds = input.integer('expiresInSeconds', { min: 1, max: 3600, optional: true }) ?? 3600
  const expiresAt = Math.min(now() + seconds * 1000, session.expiresAt)
  const payload = btoa(JSON.stringify({ session: session.id, expiresAt, origin: env.AUTH_ORIGIN })).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  const signed = `${PURPOSE}.${payload}`
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(env), encoder.encode(signed)))
  const hex = Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('')
  return { token: `${signed}.${hex}`, expiresAt, scope: 'preparation' }
}

export async function delegatedSession(env: Bindings, request: Request) {
  const url = new URL(request.url), host = request.headers.get('host')
  insist(url.origin === env.AUTH_ORIGIN && (!host || host.toLowerCase() === url.host.toLowerCase()), 'invalid_host', 403)
  if (env.AUTH_LOCAL === 'true') requireLoopback(request)
  const header = request.headers.get('authorization') ?? ''
  insist(header.length <= 2000, 'invalid_agent_credential', 401)
  const match = header.match(/^Bearer (beam-preparation-v1\.[A-Za-z0-9_-]+)\.([a-f0-9]{64})$/)
  insist(match, 'invalid_agent_credential', 401)
  const signature = Uint8Array.from(match[2].match(/../g)!, byte => parseInt(byte, 16))
  insist(await crypto.subtle.verify('HMAC', await signingKey(env), signature, encoder.encode(match[1])), 'invalid_agent_credential', 401)
  let claim: { session?: string; expiresAt?: number; origin?: string }
  try { claim = JSON.parse(atob(match[1].split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))) }
  catch { insist(false, 'invalid_agent_credential', 401) }
  insist(claim && typeof claim.session === 'string' && Number.isSafeInteger(claim.expiresAt) && claim.expiresAt! > now() && claim.origin === env.AUTH_ORIGIN, 'invalid_agent_credential', 401)
  const session = await liveSession(env, claim.session)
  insist(session && claim.expiresAt! <= session.expiresAt, 'invalid_agent_credential', 401)
  return { id: session.id, operator: { id: session.operatorId, email: session.email, displayName: session.name, role: session.role } }
}

export function requireAgentScope(actor: Actor, path: string, method: string) {
  if (!actor.agent) return
  const allowed = method === 'POST' ? PREPARATION_ACTIONS.has(path) : PREPARATION_READ.test(path)
  insist(allowed, 'agent_scope_forbidden', 403)
  // /me can explain a role removal. Every preparation read/write still needs
  // current authority; role changes never live only in token claims.
  if (path !== 'me') insist(PREPARERS.some(role => actor.roles.has(role)), 'forbidden', 403)
}
