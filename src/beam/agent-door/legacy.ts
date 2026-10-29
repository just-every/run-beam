import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { delegatedSession } from '../agent-credentials'
import { BeamError } from '../core'
import { beamAgentDoor } from './index'
import { toolSpecs } from './tool-specs'

/** The existing preparation API is an adapter into the same policy pipeline. */
export async function legacyPreparation(env: Bindings, actor: Actor, request: Request, path: string): Promise<Response> {
  const url = new URL(request.url)
  let id: string | undefined
  const spec = toolSpecs.find(item => {
    if (request.method === 'POST') return item.action === path
    if (!item.view) return false
    const [prefix, suffix] = item.view.split(':id')
    if (suffix === undefined) return item.view === path
    if (!path.startsWith(prefix) || !path.endsWith(suffix)) return false
    const value = path.slice(prefix.length, suffix ? -suffix.length : undefined)
    if (!value || value.includes('/')) return false
    id = value
    return true
  })
  if (!spec) throw new BeamError('agent_scope_forbidden', 403)
  let args: Record<string, unknown> = Object.fromEntries(url.searchParams)
  if (id) args.id = id
  if (request.method === 'POST') {
    if (request.headers.get('content-type')?.startsWith('application/json')) args = await request.json()
    else {
      const form = await request.formData()
      args = Object.fromEntries(form)
      for (const [name, schema] of Object.entries(spec.inputSchema.properties ?? {})) {
        if (!schema || typeof schema !== 'object' || !form.has(name)) continue
        if (schema.type === 'array') args[name] = form.getAll(name)
        if (schema.type === 'integer') args[name] = Number(form.get(name))
        if (schema.type === 'boolean') args[name] = ['yes', 'on', 'true'].includes(String(form.get(name)))
      }
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new BeamError('invalid_json')
    args.idempotency_key ??= request.headers.get('idempotency-key') ?? crypto.randomUUID()
  }
  const delegation = await delegatedSession(env, request)
  const result = await beamAgentDoor(env).invoke(spec.name, args, {
    person: { id: actor.id }, agent: { id: `beam-preparation:${actor.sessionId}`, name: 'Beam preparation agent', specialist: 'learning' },
    clientId: `preparation:${actor.sessionId}:${delegation.expiresAt}`, scopes: toolSpecs.map(item => item.scope),
  })
  if (result.outcome !== 'done') {
    const code = result.code ?? 'agent_refused'
    const status = code === 'unauthenticated' ? 401 : /forbidden|scope|human_|owner_|outside_|not_granted/.test(code) ? 403
      : /not_found|unavailable/.test(code) && !code.startsWith('policy') ? 404
      : /conflict|stale|approval|review|policy|paused|in_progress/.test(code) ? 409 : 400
    return Response.json({ error: code, code, ...result.fields, ...(result.approval ? { approval: result.approval } : {}), decision: result.decision }, { status, headers: { 'cache-control': 'no-store' } })
  }
  if (spec.name === 'beam.source.read') {
    const source = result.result as { base64: string; mediaType: string; filename: string }
    return new Response(Uint8Array.from(atob(source.base64), value => value.charCodeAt(0)), {
      headers: { 'content-type': source.mediaType, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(source.filename)}`,
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" },
    })
  }
  return Response.json(result.result, { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
}
