import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { delegatedSession } from '../agent-credentials'
import { blockInput } from '../blocks'
import { Input } from '../input'
import { BeamError } from '../core'
import { beamAgentDoor } from './index'
import { toolSpecs } from './tool-specs'
import { blockSchema } from './schema-draft'

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
    if (spec.action === 'course.block' && !args.content) {
      const value = blockInput(Input.of(args)) as Record<string, unknown>
      const variants = (blockSchema as { oneOf: { properties: Record<string, { const?: unknown }> }[] }).oneOf
      const shape = variants.find(item => item.properties.kind.const === value.kind)
      if (!shape) throw new BeamError('invalid_block_kind')
      args.content = Object.fromEntries(Object.entries(value).filter(([key, value]) => value !== undefined && Object.hasOwn(shape.properties, key)))
    }
    args.idempotency_key ??= request.headers.get('idempotency-key') ?? crypto.randomUUID()
  }
  const delegation = await delegatedSession(env, request)
  const result = await beamAgentDoor(env).invoke(spec.name, args, {
    person: { id: actor.id }, agent: { id: `beam-preparation:${actor.sessionId}`, name: 'Beam preparation agent', specialist: 'learning' },
    clientId: `preparation:${actor.sessionId}:${delegation.expiresAt}`, scopes: toolSpecs.map(item => item.scope),
  })
  if (result.outcome !== 'done') {
    const code = result.code ?? 'agent_refused'
    const statuses: Record<string, number> = {
      unauthenticated: 401, insufficient_scope: 403, tool_not_found: 404,
      invalid_arguments: 400, idempotency_key_required: 400, idempotency_conflict: 409,
      revision_conflict: 409, call_in_progress: 409, policy_unset: 409,
      policy_unavailable: 409, policy_blocked: 409, agents_paused: 409,
      approval_required: 409, review_required: 409, consent_revoked: 401,
    }
    const status = typeof result.fields?.native_status === 'number' ? result.fields.native_status : statuses[code] ?? 500
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
