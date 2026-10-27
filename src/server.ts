import { themeAsset, themeDocument } from './beam/portal-theme'
import { runWebhooks } from './beam/webhooks'
import { runRenewals } from './beam/renewals'
import { runEscalations } from './beam/escalations'
import { withDemo } from './modules/demo/index.mjs'
import start from '@tanstack/react-start/server-entry'
import { Hono } from 'hono'
import { dispatch } from './base/dispatch'
import { rejectedResponse } from './base/rejected-response'
import { staticAssetResponse } from './base/static-assets'
import { deploymentHealth } from './base/deployment-health'
import { lobbyResponse } from './base/lobby'
import { setupStateResponse } from './base/setup-state'
import { authResponse, runtimeBindings, type Bindings } from './auth.server'
import { identity } from './identity'
import { beamResponse } from './beam/http'
import { seedDemo } from './demo'
import { scheduledInactivity } from './beam/inactivity-scheduled'
import { runUpkeep } from './beam/upkeep'
import { beamImportDoor } from './beam/movein/door'

const api = new Hono<{ Bindings: Bindings }>()
api.get('/health', (context) => context.json({ status: 'ok', ...deploymentHealth(context.env) }))

// Start documents keep their own cache policy and add no-transform, so no proxy
// rewrites the HTML React hydrates (src/base/hydration/README.md).
function noTransform(response: Response): Response {
  const headers = new Headers(response.headers), policy = headers.get('cache-control')
  headers.set('cache-control', policy ? `${policy}, no-transform` : 'no-transform')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export default withDemo({
  async scheduled(_controller, env) {
    const bindings = runtimeBindings(env)
    // One job's failure never skips the other; both are still reported as failures.
    for (const result of await Promise.allSettled([scheduledInactivity(bindings), runUpkeep(bindings), runEscalations(bindings), runRenewals(bindings), runWebhooks(bindings)])) if (result.status === 'rejected') throw result.reason
  },
  async fetch(request, env, execution) {
    const imported = await beamImportDoor(request, runtimeBindings(env))
    if (imported) return themeDocument(runtimeBindings(env), imported)
    // Authorization is exclusively Beam's scoped agent door. Never allow a
    // co-present human cookie to turn a bearer request into a form/auth action.
    if (request.headers.has('authorization') && !new URL(request.url).pathname.startsWith('/api/beam/')) {
      return rejectedResponse(request, Response.json({ error: 'agent_scope_forbidden' }, { status: 403, headers: { 'cache-control': 'no-store' } }))
    }
    const themedAsset = await themeAsset(runtimeBindings(env), request)
    if (themedAsset) return themedAsset
    const asset = await staticAssetResponse(request, env)
    if (asset) return asset
    const auth = await authResponse(request, env)
    if (auth) return themeDocument(runtimeBindings(env), auth, new URL(request.url).pathname === '/signin')
    // The installed variant: the Lobby at / and the public claim state it reads.
    const state = await setupStateResponse(request, runtimeBindings(env))
    if (state) return state
    const lobby = await lobbyResponse(request, runtimeBindings(env), identity)
    if (lobby) return themeDocument(runtimeBindings(env), lobby)
    const beam = await beamResponse(request, env)
    if (beam && new URL(request.url).pathname.startsWith('/app/portal/')) return beam
    if (beam) return request.headers.has('authorization') && beam.status >= 400 ? rejectedResponse(request, beam) : themeDocument(runtimeBindings(env), beam)
    return dispatch(request, () => api.fetch(request, env, execution), async () => noTransform(await start.fetch(request)))
  },
} satisfies ExportedHandler<Bindings>, { seed: seedDemo })
