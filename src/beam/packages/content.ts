import type { Bindings } from '../../auth.server'
import { insist, sha256Hex } from '../core'
import { all, one } from '../core'
import { initialState } from './state'
import { runtimeScript } from './api-script'
import { playbackSession } from './runtime'

/** Opaque, short-lived asset capability. Every read rechecks its human session and assignment authority. */
export async function packageContentResponse(env: Bindings, request: Request): Promise<Response | null> {
  const url = new URL(request.url), match = url.pathname.match(/^\/beam-package\/([\w-]+)\/(.+)$/)
  if (!match) return null
  insist(request.method === 'GET' || request.method === 'HEAD', 'method_not_allowed', 405)
  const { session, pkg, sco, run, actor } = await playbackSession(env, match[1])
  let path: string
  try { path = decodeURIComponent(match[2]) } catch { insist(false, 'invalid_asset_path', 404) }
  insist(!path.split('/').some(part => part === '..' || part === '.' || !part) && !/[\\\x00-\x1f]/.test(path), 'invalid_asset_path', 404)
  const asset = (await all(env, 'SELECT * FROM beam_package_assets WHERE package_id=? AND path=?', pkg.id, path))[0]
  insist(asset, 'package_asset_missing', 404)
  const object = await env.FILES.get(`sha256/${asset.sha256}`)
  insist(object, 'package_asset_missing', 503)
  const bytes = new Uint8Array(await object.arrayBuffer())
  insist(bytes.length === asset.size && await sha256Hex(bytes) === asset.sha256, 'file_integrity', 503)
  const prefix = `${env.AUTH_ORIGIN}/beam-package/${session.id}/`
  let body: BodyInit = bytes as BodyInit
  if (pkg.standard !== 'cmi5' && asset.media_type.startsWith('text/html')) {
    const latest = await one<{payload_json:string}>(env, "SELECT payload_json FROM beam_package_events WHERE session_id=? AND event IN ('commit','terminate') ORDER BY at DESC,rowid DESC LIMIT 1", session.id)
    const initial = JSON.parse(latest?.payload_json ?? session.initial_json) as Record<string,string>
    const script = `<script>${runtimeScript(pkg.manifest.standard, initial, session.id).replaceAll('</script', '<\\/script')}</script>`
    const html = new TextDecoder().decode(bytes)
    body = /^\s*<!doctype[^>]*>/i.test(html) ? html.replace(/^(\s*<!doctype[^>]*>)/i, `$1${script}`) : script + html
  }
  return new Response(request.method === 'HEAD' ? null : body, { headers: {
    'content-type': asset.media_type, 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
    'content-security-policy': `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' ${prefix}; style-src 'unsafe-inline' ${prefix}; img-src data: ${prefix}; font-src ${prefix}; media-src ${prefix}; connect-src ${pkg.standard === 'cmi5' ? `${env.AUTH_ORIGIN}/api/beam/cmi5/${session.id}/` : "'none'"}; frame-src 'none'; form-action 'none'; frame-ancestors 'self'; base-uri 'none'`,
  } })
}
