// CONNECT-014: application credentials the owner issues on Access. Each has one audience (roster.read, catalog.read,
// enrollments.write, reports.read or results.write), an optional team scope (none: the whole business) and an expiry of 1 to 90 days.
// The token `beam-app-v1.<id>.<secret>` is shown once; only the secret's SHA-256 is kept. Rotating replaces the secret
// at once; revoking ends the credential. A credential acts as the issuing owner narrowed to its audience's routes and
// its teams, never as a session, and is limited to 60 requests a minute. Preparation credentials keep their BEAM-14 limits.
// OPS-007: a credential an installation restore brought back (restored_at, migration 0070) stays disabled until the
// owner rotates it, which reissues its secret; the archive never carried that secret's hash.
import type { Bindings } from '../auth.server'
import { requireOwner, type Actor, type Role } from './actor'
import { all, BeamError, commit, insist, newId, now, one, sha256Hex, stmt } from './core'
import type { Input } from './input'
import { requireLoopback } from '../modules/operator-auth/index.mjs'
import { MCP_TOOLS } from './mcp'

export const AUDIENCES = ['roster.read', 'catalog.read', 'enrollments.write', 'reports.read', 'results.write', 'mcp'] as const
export type Audience = typeof AUDIENCES[number]
export const RATE_PER_MINUTE = 60
const DAY = 86_400_000
// The routes each audience opens: GET for reads, POST for the writes.
const ROUTES: Record<Audience, { method: 'GET' | 'POST'; paths: string[] }> = {
  'roster.read': { method: 'GET', paths: ['v1/people'] },
  'catalog.read': { method: 'GET', paths: ['v1/courses'] },
  'enrollments.write': { method: 'POST', paths: ['v1/enrollments'] },
  // REPORT-004: the BI feed beside the paged report.
  'reports.read': { method: 'GET', paths: ['v1/report', 'v1/report/feed.json', 'v1/report/feed.csv'] },
  'results.write': { method: 'POST', paths: ['v1/results'] },
  // CONNECT-016: the MCP endpoint; the grant's tool list narrows it further (mcp.ts).
  'mcp': { method: 'POST', paths: ['mcp'] },
}
const TOKEN = /^Bearer beam-app-v1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/
const encoder = new TextEncoder()
const secret = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
const digest = (value: string) => sha256Hex(encoder.encode(value))

export const isAppRequest = (request: Request) => (request.headers.get('authorization') ?? '').startsWith('Bearer beam-app-v1.')
/** Servers calling with a credential send no Origin; the same-origin check stays for any request carrying a cookie. */
export const exemptFromOriginCheck = (request: Request) => isAppRequest(request) && !request.headers.has('cookie')

export async function issueCredential(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  insist(!actor.agent, 'human_session_required', 403)
  const name = input.text('name', { max: 80 })
  const audience = input.text('audience', { max: 40 }) as Audience
  insist(AUDIENCES.includes(audience), 'invalid_audience')
  const teams = [...new Set(input.list('teams'))]
  for (const team of teams) insist(await one(env, 'SELECT 1 FROM beam_teams WHERE id = ?', team), 'team_not_found', 404)
  // CONNECT-016: an MCP grant names its tools explicitly; other audiences have none.
  const tools = audience === 'mcp' ? [...new Set(input.list('tools'))] : []
  insist(audience !== 'mcp' || (tools.length > 0 && tools.every(tool => (MCP_TOOLS as readonly string[]).includes(tool))), 'invalid_tools')
  const days = input.integer('expiresInDays', { min: 1, max: 90, optional: true }) ?? 30
  const id = newId(), value = secret(), expiresAt = now() + days * DAY
  await commit(env, [stmt(env, 'INSERT INTO beam_app_credentials (id, name, audience, teams_json, tools_json, secret_sha256, issued_by, issued_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, name, audience, JSON.stringify(teams), JSON.stringify(tools), await digest(value), actor.id, now(), expiresAt)],
    { actor, action: 'app.issue', subject: id, detail: { name, audience, teams, tools, expiresAt } })
  return { id, token: `beam-app-v1.${id}.${value}`, audience, teams, tools, expiresAt }
}

export async function rotateCredential(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  insist(!actor.agent, 'human_session_required', 403)
  const credential = await one(env, 'SELECT id, audience, teams_json, expires_at FROM beam_app_credentials WHERE id = ? AND revoked_at IS NULL AND expires_at > ?', input.text('credential', { max: 64 }), now())
  insist(credential, 'credential_not_found', 404)
  const value = secret()
  await commit(env, [stmt(env, 'UPDATE beam_app_credentials SET secret_sha256 = ?, rotated_at = ?, restored_at = NULL WHERE id = ?', await digest(value), now(), credential.id)], { actor, action: 'app.rotate', subject: credential.id })
  return { id: credential.id, token: `beam-app-v1.${credential.id}.${value}`, audience: credential.audience, teams: JSON.parse(credential.teams_json), expiresAt: credential.expires_at }
}

export async function revokeCredential(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const credential = await one(env, 'SELECT id FROM beam_app_credentials WHERE id = ? AND revoked_at IS NULL', input.text('credential', { max: 64 }))
  insist(credential, 'credential_not_found', 404)
  await commit(env, [stmt(env, 'UPDATE beam_app_credentials SET revoked_by = ?, revoked_at = ? WHERE id = ?', actor.id, now(), credential.id)], { actor, action: 'app.revoke', subject: credential.id })
  return { id: credential.id, revoked: true }
}

export async function listCredentials(env: Bindings, actor: Actor) {
  requireOwner(actor)
  return await all<{ id: string; name: string; audience: string; teams: string; issuedAt: number; expiresAt: number; rotatedAt: number | null; revokedAt: number | null; restoredAt: number | null }>(env, 'SELECT id, name, audience, teams_json AS teams, tools_json AS tools, issued_at AS issuedAt, expires_at AS expiresAt, rotated_at AS rotatedAt, revoked_at AS revokedAt, restored_at AS restoredAt FROM beam_app_credentials ORDER BY issued_at DESC')
    .then(rows => rows.map(row => ({ ...row, teams: JSON.parse(row.teams), tools: JSON.parse((row as any).tools) as string[], state: row.revokedAt ? 'revoked' : row.expiresAt <= now() ? 'expired' : row.restoredAt ? 'restored' : 'active' })))
}

/** The credential behind a request, counted against its rate limit. Any failure is the same 401. */
export async function applicationCredential(env: Bindings, request: Request) {
  const url = new URL(request.url), host = request.headers.get('host')
  insist(url.origin === env.AUTH_ORIGIN && (!host || host.toLowerCase() === url.host.toLowerCase()), 'invalid_host', 403)
  if (env.AUTH_LOCAL === 'true') requireLoopback(request)
  const match = (request.headers.get('authorization') ?? '').match(TOKEN)
  insist(match, 'invalid_application_credential', 401)
  const credential = await one(env, 'SELECT * FROM beam_app_credentials WHERE id = ? AND revoked_at IS NULL AND restored_at IS NULL AND expires_at > ?', match[1], now())
  insist(credential && credential.secret_sha256 === await digest(match[2]), 'invalid_application_credential', 401)
  const minute = Math.floor(now() / 60_000)
  const used = await one<{ count: number }>(env, 'INSERT INTO beam_app_usage (credential, minute, count) VALUES (?, ?, 1) ON CONFLICT (credential, minute) DO UPDATE SET count = count + 1 RETURNING count', credential.id, minute)
  if (used!.count > RATE_PER_MINUTE) throw new BeamError('rate_limited', 429, { limit: RATE_PER_MINUTE, per: 'minute' })
  return { id: credential.id as string, name: credential.name as string, audience: credential.audience as Audience, teams: JSON.parse(credential.teams_json) as string[], tools: JSON.parse(credential.tools_json) as string[], issuedBy: credential.issued_by as string }
}

/** The issuing owner's authority narrowed to one audience and the credential's teams; it ends if they stop being owner. */
export async function applicationActor(env: Bindings, request: Request): Promise<Actor> {
  const credential = await applicationCredential(env, request)
  return scopedApplicationActor(env, credential)
}

/** Re-read the saved grant when an approved shared-door call executes later. */
export async function agentApplicationActor(env: Bindings, id: string, sponsor: string): Promise<Actor> {
  const row = await one(env, 'SELECT * FROM beam_app_credentials WHERE id=? AND issued_by=? AND revoked_at IS NULL AND restored_at IS NULL AND expires_at>?', id, sponsor, now())
  insist(row && row.audience === 'mcp', 'invalid_application_credential', 401)
  return scopedApplicationActor(env, { id: row.id, name: row.name, audience: row.audience, teams: JSON.parse(row.teams_json), tools: JSON.parse(row.tools_json), issuedBy: row.issued_by })
}

async function scopedApplicationActor(env: Bindings, credential: Awaited<ReturnType<typeof applicationCredential>>): Promise<Actor> {
  const owner = await one<{ id: string; name: string; email: string | null; business: string | null }>(env, "SELECT m.id, m.name, m.email, (SELECT name FROM beam_business WHERE singleton = 1) AS business FROM beam_members m JOIN oa_operators o ON o.id = m.operator_id WHERE m.id = ? AND o.role = 'owner' AND o.status = 'active'", credential.issuedBy)
  insist(owner, 'invalid_application_credential', 401)
  const teams = credential.teams.length ? credential.teams : null
  const learners = teams && (await all<{ member_id: string }>(env, 'SELECT DISTINCT member_id FROM beam_team_members WHERE team_id IN (SELECT value FROM json_each(?))', JSON.stringify(teams))).map(row => row.member_id)
  const roles = new Set<Role>(credential.audience === 'enrollments.write' || credential.audience === 'reports.read' ? ['manager'] : [])
  return { id: owner.id, name: owner.name, email: owner.email ?? '', business: owner.business, sessionId: `app:${credential.id}`, sessionKind: 'application', owner: false, agent: true, roles, adminUnits: [], authorOf: [], managedTeams: [], teams, learners, grants: {}, auditor: false, app: { id: credential.id, name: credential.name, audience: credential.audience, tools: credential.tools } }
}

/** An application reaches only its audience's route; everything else, publication included, is refused. */
export function requireAppScope(actor: Actor, path: string, method: string) {
  const route = ROUTES[actor.app!.audience as Audience]
  if (route.paths.includes(path) && route.method === method) return
  const other = Object.values(ROUTES).some(item => item.paths.includes(path))
  throw new BeamError(other ? 'audience_forbidden' : 'application_scope_forbidden', 403)
}
