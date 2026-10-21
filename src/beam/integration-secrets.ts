// Integration secrets are sealed at rest under the installation's existing server-only session secret.
// Archives withhold these ciphertexts. Losing/rotating that root requires explicit integration key rotation.
import type { Bindings } from '../auth.server'
import { insist } from './core'
const enc = new TextEncoder()
const bytes = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0))
const base64 = (value: Uint8Array) => btoa(String.fromCharCode(...value))
async function key(env: Bindings) {
  return await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', enc.encode(`beam.integration.v1:${env.SESSION_SECRET}`)), 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export async function sealSecret(env: Bindings, value: string, purpose: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(purpose) }, await key(env), enc.encode(value))
  return `${base64(iv)}.${base64(new Uint8Array(cipher))}`
}
export async function openSecret(env: Bindings, value: string, purpose: string) {
  try {
    const [iv, cipher] = value.split('.')
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv), additionalData: enc.encode(purpose) }, await key(env), bytes(cipher)))
  } catch { insist(false, 'integration_key_unavailable', 409) }
}
export const randomSecret = () => base64(crypto.getRandomValues(new Uint8Array(32)))
export async function signWebhook(secret: string, body: string) {
  const key = await crypto.subtle.importKey('raw', bytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body))), b => b.toString(16).padStart(2, '0')).join('')
}
