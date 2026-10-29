// Read-only provider qualification. Supply the three named bindings only through
// the fleet injector. This script never prints identities, credentials or provider bodies.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { fixture } from './regression-fixture.mjs'
const names = ['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET']
assert.ok(names.every(name => process.env[name]), 'Microsoft server bindings are required')
let providerCalls = 0
const f = await fixture({ bindings: { ...Object.fromEntries(names.map(name => [name, process.env[name]])), ENTRA_SCIM_TOKEN: randomBytes(32).toString('hex') }, outboundService: async request => {
  const url = new URL(request.url)
  if (!['login.microsoftonline.com', 'graph.microsoft.com'].includes(url.hostname)) return null
  assert.equal(url.protocol, 'https:'); providerCalls++
  const bytes = ['GET', 'HEAD'].includes(request.method) ? undefined : new Uint8Array(await request.arrayBuffer())
  if (url.hostname === 'login.microsoftonline.com' && request.method === 'POST') {
    const fields = new URLSearchParams(new TextDecoder().decode(bytes))
    assert.ok(fields.get('client_id') === process.env.ENTRA_CLIENT_ID, 'Forwarded client binding matches')
    assert.ok(fields.get('client_secret') === process.env.ENTRA_CLIENT_SECRET, 'Forwarded credential binding matches')
    assert.equal(fields.get('grant_type'), 'client_credentials')
  }
  const requestHeaders = new Headers(request.headers)
  for (const name of ['content-length', 'host', 'connection', 'transfer-encoding']) requestHeaders.delete(name)
  const response = await fetch(request.url, { method: request.method, headers: requestHeaders, body: bytes, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
  if (!response.ok && url.hostname === 'login.microsoftonline.com') {
    const error = await response.clone().json().catch(() => ({}))
    console.log(JSON.stringify({ operation: 'token diagnostic', status: response.status, error: error.error, codes: error.error_codes }))
  }
  const responseHeaders = new Headers(response.headers)
  responseHeaders.delete('content-encoding'); responseHeaders.delete('content-length')
  return new Response(await response.arrayBuffer(), { status: response.status, headers: responseHeaders })
} })
try {
  await f.api('manager', 'microsoft.check', { consent: true }, 403)
  await f.api('owner', 'microsoft.check', { consent: false }, 409)
  assert.equal(providerCalls, 0)
  const result = await f.api('owner', 'microsoft.check', { consent: true })
  assert.equal(result.token, 'accepted')
  assert.ok(result.directoryUsers > 0)
  console.log(JSON.stringify({ operation: 'live Microsoft account check', token: result.token, directoryUsers: result.directoryUsers,
    licensedUsers: result.licensedUsers, directoryComplete: result.directoryComplete, sites: result.sites?.length ?? 0,
    sitesComplete: result.sitesComplete ?? false, sitesUnavailable: result.sitesUnavailable ?? null, sitesProviderStatus: result.sitesProviderStatus ?? null, sharePointLicenseMissing: result.sharePointLicenseMissing ?? false }))
  assert.equal((await f.h.raw('/api/beam/entra/configure', { cookie: f.cookies.owner, body: { tenantId: process.env.ENTRA_TENANT_ID, clientId: process.env.ENTRA_CLIENT_ID, enabled: true, consent: true, reason: 'Read-only sandbox discovery qualification' } })).status, 200)
  assert.equal((await f.h.raw('/auth/settings/identity', { cookie: f.cookies.owner, body: { idpSignIn: true } })).status, 200)
  const start = await f.h.raw('/auth/oidc/beam-entra/start', { body: { returnTo: '/app/learning' } })
  assert.equal(start.status, 303)
  const destination = new URL(start.headers.get('location'))
  assert.ok(destination.origin + destination.pathname === `https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}/oauth2/v2.0/authorize`)
  console.log('PASS live tenant OIDC discovery and start; interactive learner sign-in is still unqualified')
  assert.equal((await f.h.raw('/api/beam/entra/configure', { cookie: f.cookies.owner, body: { tenantId: process.env.ENTRA_TENANT_ID, clientId: process.env.ENTRA_CLIENT_ID, enabled: false, consent: true, reason: 'End local sandbox qualification' } })).status, 200)
  const disabled = await f.h.raw('/auth/oidc/beam-entra/start', { body: { returnTo: '/app/learning' } })
  assert.equal(disabled.status, 403)
  await f.api('owner', 'microsoft.configure', { operation: 'revoke' })
  const before = providerCalls
  await f.api('owner', 'microsoft.preview', { item: 'synthetic-beam-1' }, 409)
  assert.equal(providerCalls, before)
  console.log('PASS live token and directory; consent, non-owner refusal and local connection revocation; licensed document qualification remains required')
} finally { await f.h.close() }
