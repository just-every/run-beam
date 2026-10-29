import type { Bindings } from '../../auth.server'
import { createAgentDoor, type Trust } from '../../modules/agent-door/index.ts'
import { people } from './people'
import { createTools } from './tools'
import { currentScopes, localCredential } from './credentials'

export const capabilities = ['tools', 'policy', 'pause', 'audit', 'idempotency'] as const
export const notTools = [
  { clauses: ['LEARN-003', 'LEARN-011'], reason: 'screen' as const },
  { clauses: ['LEARN-004', 'LEARN-005'], reason: 'device' as const },
  { clauses: ['MOVE-001', 'MOVE-002', 'MOVE-003', 'MOVE-004', 'MOVE-005', 'MOVE-006', 'MOVE-007', 'MOVE-008', 'MOVE-009'], reason: 'import-door' as const },
  { clauses: ['OPS-006', 'OPS-007'], reason: 'installation' as const },
  { clauses: ['CONNECT-014', 'CONNECT-017', 'AUTHOR-002', 'AUTHOR-007', 'AUTHOR-008', 'LEARN-008', 'LEARN-009'], reason: 'connector' as const },
]
function trust(env: Bindings): Trust | null {
  const issuer = env.RER_OWNER_CLAIM_ISSUER, installationId = env.RER_OWNER_CLAIM_INSTALLATION_ID
  const appOrigin = env.RER_OWNER_CLAIM_APP_ORIGIN ?? env.AUTH_ORIGIN, keys = env.RER_OWNER_CLAIM_PUBLIC_KEYS
  if (![issuer, installationId, keys, env.RER_OWNER_CLAIM_APP_ORIGIN].some(Boolean)) return null
  if (!issuer || !installationId || !keys) throw new Error('Incomplete agent door trust configuration')
  return { issuer, installationId, appOrigin, publicKeys: JSON.parse(keys) }
}
export function beamAgentDoor(env: Bindings) {
  const tools = createTools(env)
  const door = createAgentDoor({ seed: 'beam', name: 'Beam', specialist: 'learning', db: env.DB, origin: env.AUTH_ORIGIN,
    capabilities: [...capabilities], trust: trust(env), people: people(env), tools, resources: [], notTools,
    paths: ['/api/beam/mcp'], localCredentials: request => localCredential(env, tools, request),
    currentScopes: principal => currentScopes(env, tools, principal) })
  return { ...door, async handle(request: Request) {
    if (new URL(request.url).pathname === '/api/beam/mcp' && request.headers.has('cookie')) {
      return Response.json({ code: 'mcp_session_refused' }, { status: 403 })
    }
    return door.handle(request)
  } }
}
