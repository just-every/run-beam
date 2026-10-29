import type { Bindings } from '../../auth.server'
import { delegatedSession } from '../agent-credentials'
import { currentActor } from '../actor'
import { one } from '../core'
import { isAppRequest } from '../app-credentials'
import type { Principal, ToolDefinition } from '../../modules/agent-door/index.ts'

export const legacyTools: Record<string, string> = {
  search_material: 'beam.material.search', read_report: 'beam.report.read', propose_course_change: 'beam.draft.propose',
}
export function appScopes(tools: ToolDefinition[], names: string[]) {
  const allowed = names.map(name => legacyTools[name])
  return tools.filter(tool => allowed.includes(tool.name)).map(tool => tool.scope)
}

export async function localCredential(env: Bindings, tools: ToolDefinition[], request: Request) {
  if (!request.headers.has('authorization')) return null
  const actor = await currentActor(env, request)
  if (!actor?.agent) return null
  if (isAppRequest(request)) {
    if (!actor.app || actor.app.audience !== 'mcp') return null
    return { sponsor: { id: actor.id }, agent: { id: `beam-app:${actor.app.id}`, name: actor.app.name, specialist: 'learning' },
      clientId: `app:${actor.app.id}`, scopes: appScopes(tools, actor.app.tools) }
  }
  const delegation = await delegatedSession(env, request)
  return { sponsor: { id: actor.id }, agent: { id: `beam-preparation:${actor.sessionId}`, name: 'Beam preparation agent', specialist: 'learning' },
    clientId: `preparation:${actor.sessionId}:${delegation.expiresAt}`, scopes: tools.map(tool => tool.scope) }
}

/** Recheck native credential custody at approval execution as well as admission. */
export async function currentScopes(env: Bindings, tools: ToolDefinition[], principal: Principal) {
  if (!principal.consent && principal.clientId?.startsWith('app:')) {
    const row = await one(env, `SELECT tools_json FROM beam_app_credentials WHERE id=? AND audience='mcp' AND issued_by=?
      AND revoked_at IS NULL AND restored_at IS NULL AND expires_at>?`, principal.clientId.slice(4), principal.person.id, Date.now())
    return row ? appScopes(tools, JSON.parse(row.tools_json)) : []
  }
  if (!principal.consent && principal.clientId?.startsWith('preparation:')) {
    const [sessionId, expiresAt] = principal.clientId.slice(12).split(':')
    if (!expiresAt || Number(expiresAt) <= Date.now()) return []
    const row = await one(env, `SELECT 1 FROM oa_sessions s JOIN beam_members m ON m.operator_id=s.operator_id
      JOIN oa_operators o ON o.id=s.operator_id WHERE s.id=? AND m.id=? AND s.revoked_at IS NULL AND s.expires_at>?
      AND s.kind IN ('native','oidc') AND o.status='active' AND s.operator_version=o.version`, sessionId, principal.person.id, Date.now())
    return row ? tools.map(tool => tool.scope) : []
  }
  return principal.scopes
}
