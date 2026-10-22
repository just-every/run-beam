import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { loadCaptionSource } from './captions'
import { sourceFile } from './sources'

/** Caption bytes use the original source's current staff/citation/learner-access rules. */
export async function captionFile(env: Bindings, actor: Actor, version: string) {
  await sourceFile(env, actor, version, true)
  const caption = await loadCaptionSource(env, version)
  return new Response(new Uint8Array(caption.bytes), { headers: {
    'content-type': 'text/vtt; charset=utf-8',
    'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(caption.filename)}`,
    'cache-control': 'private, no-store',
    'content-security-policy': "sandbox; default-src 'none'",
    'x-content-type-options': 'nosniff',
  } })
}
