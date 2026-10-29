import type { Bindings } from '../../auth.server'
import { insist, one, sha256Hex } from '../core'

export type EntraBindings = Bindings & {
 ENTRA_TENANT_ID?: string; ENTRA_CLIENT_ID?: string; ENTRA_CLIENT_SECRET?: string; ENTRA_SCIM_TOKEN?: string
}
export interface Connection { tenant_id: string; client_id: string; enabled: number; revision: number; consent_by: string; consent_at: number; reason: string }
export const providerId = 'beam-entra'
export const issuerOf = (tenant: string) => `https://login.microsoftonline.com/${tenant}/v2.0`
export const connection = (env: EntraBindings) => one<Connection>(env, 'SELECT * FROM beam_entra_connection WHERE singleton=1')
export function text(value: unknown, name: string, max = 255): string {
 insist(typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value), `invalid_${name}`)
 return value
}
export function guid(value: unknown, name: string) {
 const result = text(value, name, 36).toLowerCase()
 insist(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(result), `invalid_${name}`)
 return result
}
export const ready = (env: EntraBindings, c: Connection | null) => !!c && c.enabled === 1 && c.tenant_id === env.ENTRA_TENANT_ID?.toLowerCase() && c.client_id === env.ENTRA_CLIENT_ID?.toLowerCase() && !!env.ENTRA_CLIENT_SECRET && !!env.ENTRA_SCIM_TOKEN
export async function body(request: Request): Promise<Record<string, any>> {
 insist(/^application\/(?:scim\+)?json(?:\s*;|$)/i.test(request.headers.get('content-type') || ''), 'unsupported_content_type', 415)
 const reader = request.body?.getReader(), chunks: Uint8Array[] = []; let length = 0
 try {
  if (reader) while (true) { const next = await reader.read(); if (next.done) break; length += next.value.length; insist(length <= 131072, 'input_too_large', 413); chunks.push(next.value) }
 } finally { if (reader) void reader.cancel().catch(() => {}) }
 const bytes = new Uint8Array(length); let offset = 0
 for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
 let value
 try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { insist(false, 'invalid_json') }
 insist(value && typeof value === 'object' && !Array.isArray(value), 'invalid_json')
 return value
}
export async function tokenMatches(actual: string, expected: string) {
 const [left, right] = await Promise.all([sha256Hex(new TextEncoder().encode(actual)), sha256Hex(new TextEncoder().encode(expected))])
 let difference = 0
 for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i)
 return difference === 0
}
export const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-type': 'application/scim+json' }
