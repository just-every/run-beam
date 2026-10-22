// Carry a secret across POST/Redirect/GET without putting it in the address or
// retaining its plaintext server-side. The browser drops the cookie on opening
// the result, so reloading only reads and cannot repeat the original write.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'

const NAME = 'beam_form_result'
const LIFETIME = 120
const encoder = new TextEncoder()
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
const decode = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0))
const context = (actor: Actor, path: string) => encoder.encode(`${actor.id}\0${actor.sessionId}\0${path}`)
const key = async (env: Bindings) => crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', encoder.encode(`beam-form-result-v1\0${env.SESSION_SECRET}`)), 'AES-GCM', false, ['encrypt', 'decrypt'])
const cookie = (env: Bindings, path: string, value: string, age: number) => `${NAME}=${value}; Path=${path}; Max-Age=${age}; HttpOnly; SameSite=Strict${new URL(env.AUTH_ORIGIN).protocol === 'https:' ? '; Secure' : ''}`

export async function redirectWithResult(env: Bindings, actor: Actor, path: string, value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: context(actor, path) }, await key(env), encoder.encode(JSON.stringify({ expires: Date.now() + LIFETIME * 1000, value })))
  return new Response(null, { status: 303, headers: {
    location: path, 'set-cookie': cookie(env, path, `${encode(iv)}.${encode(new Uint8Array(sealed))}`, LIFETIME),
    'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
  } })
}

export async function readFormResult<T>(env: Bindings, actor: Actor, request: Request): Promise<T | null> {
  const value = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${NAME}=`))?.slice(NAME.length + 1)
  if (!value) return null
  try {
    const [iv, sealed] = value.split('.')
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: context(actor, new URL(request.url).pathname) }, await key(env), decode(sealed))
    const result = JSON.parse(new TextDecoder().decode(bytes))
    return result.expires > Date.now() ? result.value as T : null
  } catch { return null }
}

export function clearFormResult(env: Bindings, path: string, response: Response) {
  response.headers.append('set-cookie', cookie(env, path, '', 0))
  response.headers.set('cache-control', 'no-store')
  response.headers.set('referrer-policy', 'no-referrer')
  return response
}
