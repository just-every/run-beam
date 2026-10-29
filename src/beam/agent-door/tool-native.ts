import type { Bindings } from '../../auth.server.ts'
import type { ToolContext } from '../../modules/agent-door/index.ts'
import type { Actor } from '../actor.ts'
import { requireAgentScope } from '../agent-credentials.ts'
import { actions } from '../actions.ts'
import { insist, one } from '../core.ts'
import { Input } from '../input.ts'
import { searchMaterial } from '../mcp.ts'
import { sourceFile } from '../sources.ts'
import { route } from '../views.ts'
import { peopleFor } from './people.ts'
import type { ToolSpec } from './tool-specs.ts'
import { requireLocalMaterial } from './tool-material.ts'

export const nativePath = (spec: ToolSpec, args: Record<string, unknown>) => spec.view?.replace(':id', String(args.id))

/** A Request supplies URL filters to native services; it is never dispatched or
 * fetched. Authentication is the already admitted live Actor, not a cookie. */
export function nativeRequest(env: Bindings, path: string, args: Record<string, unknown> = {}, method = 'GET') {
  const url = new URL(`/api/beam/${path}`, env.AUTH_ORIGIN)
  if (method === 'GET') for (const [key, value] of Object.entries(args)) if (key !== 'id' && typeof value === 'string') url.searchParams.set(key, value)
  return new Request(url, { method, headers: { origin: env.AUTH_ORIGIN } })
}

export async function admitNative(env: Bindings, spec: ToolSpec, args: Record<string, unknown>, actor: Actor) {
  // MCP application grants have their separate three-tool scope, narrowed by
  // actorFor. All ordinary preparation tools retain native preparation scope.
  if (!actor.app) {
    if (spec.action) requireAgentScope(actor, spec.action, 'POST')
    else if (spec.view) requireAgentScope(actor, nativePath(spec, args)!, 'GET')
    else requireAgentScope(actor, 'courses', 'GET')
  }
  await requireLocalMaterial(env, spec, args)
}

function actionValues(spec: ToolSpec, args: Record<string, unknown>, ctx: ToolContext) {
  const values: Record<string, unknown> = { ...args, agent: ctx.agent.name.slice(0, 120) }
  // Native forms use field presence for these checkboxes. A JSON false means
  // absence, rather than accidentally turning the native option on.
  const flags = spec.action === 'course.question' ? ['always', 'ignoreCase'] : spec.action === 'course.assessment' ? ['shuffle'] : []
  for (const key of flags) if (values[key] === false) delete values[key]
  return values
}

async function sourceBytes(env: Bindings, actor: Actor, id: string) {
  const response = await sourceFile(env, actor, id, true)
  const file = await one(env, 'SELECT filename,media_type AS mediaType,size,sha256 FROM beam_source_versions WHERE id=?', id)
  insist(file, 'source_version_not_found', 404)
  const bytes = new Uint8Array(await response.arrayBuffer())
  let encoded = ''
  // Do not spread a whole document onto the JS argument stack.
  for (let offset = 0; offset < bytes.length; offset += 24_576) encoded += btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24_576)))
  return { id, ...file, base64: encoded }
}

export async function runNative(env: Bindings, spec: ToolSpec, args: Record<string, unknown>, actor: Actor, ctx: ToolContext) {
  await admitNative(env, spec, args, actor)
  if (spec.action) return actions[spec.action](env, actor, Input.of(actionValues(spec, args, ctx)), nativeRequest(env, spec.action, {}, 'POST'))
  if (spec.name === 'beam.material.search') return searchMaterial(env, Input.of(args).text('query', { max: 200 }))
  if (spec.view === 'people') return peopleFor(env, actor, ctx)
  if (spec.view === 'source-files/:id') return sourceBytes(env, actor, String(args.id))
  const path = nativePath(spec, args)!
  const { view, id } = route(path)
  return view(env, actor, nativeRequest(env, path, args), id)
}
