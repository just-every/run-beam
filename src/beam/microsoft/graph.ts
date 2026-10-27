import type { Bindings } from '../../auth.server'
import { BeamError, insist } from '../core'

async function microsoftFetch(input: string, init: RequestInit) {
  try { return await fetch(input, init) } catch { throw new BeamError('microsoft_provider_unavailable', 503) }
}
export function microsoftUrl(value: unknown) {
  insist(typeof value === 'string' && value.length <= 16_000, 'microsoft_destination_invalid', 409)
  try { return new URL(value) } catch { throw new BeamError('microsoft_destination_invalid', 409) }
}
async function microsoftJson(response: Response, maximum: number) {
  const bytes = await boundedBytes(response, maximum)
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new BeamError('microsoft_response_invalid', 502) }
}
export const GRAPH = 'https://graph.microsoft.com/v1.0'
export const segment = (value: string) => { insist(/^[A-Za-z0-9_,!.-]{1,300}$/.test(value) && value !== '.' && value !== '..', 'microsoft_invalid_id'); return encodeURIComponent(value) }
export async function boundedBytes(response: Response, maximum = 25_000_000) {
  insist(response.body, 'microsoft_empty_response', 502)
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; insist(size <= maximum, 'microsoft_response_limit', 422); chunks.push(part.value) }
  } catch (error) { if (error instanceof BeamError) throw error; throw new BeamError('microsoft_response_interrupted', 502) }
  finally { await reader.cancel().catch(() => {}) }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}
export async function graphToken(env: Bindings) {
  insist(env.ENTRA_TENANT_ID && /^[a-f0-9-]{36}$/i.test(env.ENTRA_TENANT_ID) && env.ENTRA_CLIENT_ID && env.ENTRA_CLIENT_SECRET, 'microsoft_credentials_required', 409)
  const response = await microsoftFetch(`https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30_000), headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.ENTRA_CLIENT_ID, client_secret: env.ENTRA_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
  })
  if (!response.ok) { await response.body?.cancel(); throw new BeamError('microsoft_token_denied', 502) }
  const body = await microsoftJson(response, 100_000)
  insist(typeof body.access_token === 'string' && body.token_type?.toLowerCase() === 'bearer', 'microsoft_token_invalid', 502)
  return body.access_token as string
}
export async function graphResponse(token: string, path: string) {
  insist(path.startsWith('/') && !path.startsWith('//') && !path.includes('\\'), 'microsoft_invalid_path')
  const response = await microsoftFetch(GRAPH + path, { redirect: 'manual', signal: AbortSignal.timeout(30_000), headers: { authorization: `Bearer ${token}` } })
  if (!response.ok) {
    let sharePointLicenseMissing = false
    try { const error = await microsoftJson(response, 100_000); sharePointLicenseMissing = /does not have a SPO license|SharePoint.*(?:not provisioned|license)/i.test(error?.error?.message ?? '') } catch {}
    throw new BeamError([401, 403, 404, 410].includes(response.status) ? 'microsoft_rights_unavailable' : 'microsoft_provider_unavailable', 409, { providerStatus: response.status, sharePointLicenseMissing })
  }
  return response
}
export const graphJson = async (token: string, path: string) => microsoftJson(await graphResponse(token, path), 1_000_000)
export async function graphContent(token: string, path: string, hostname: string) {
  // Graph returns a short-lived download location. It never receives a second bearer.
  let response = await microsoftFetch(GRAPH + path + '/content', { redirect: 'manual', signal: AbortSignal.timeout(30_000), headers: { authorization: `Bearer ${token}` } })
  if (response.status === 302) {
    const location = response.headers.get('location'); await response.body?.cancel()
    const target = location ? microsoftUrl(location) : null
    insist(target && target.protocol === 'https:' && target.hostname === hostname && !target.username && !target.password && !target.hash, 'microsoft_download_destination_refused', 409)
    response = await microsoftFetch(target.href, { redirect: 'manual', signal: AbortSignal.timeout(30_000) })
  }
  if (!response.ok) { await response.body?.cancel(); throw new BeamError('microsoft_rights_unavailable', 409) }
  return boundedBytes(response)
}
