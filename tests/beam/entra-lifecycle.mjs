import assert from 'node:assert/strict'
import { fixture } from './regression-fixture.mjs'
import { bindings, clientId, entraEdge, externalGroup, externalId, foreignTenant, issuer, scimToken, tenantId } from './entra-edge.mjs'
const USER = 'urn:ietf:params:scim:schemas:core:2.0:User'
const GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group'
const PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'
// One bounded public-door check; callers register it in the shared regression runner.
export async function entraCheck() {
 const edge = entraEdge(), f = await fixture({ bindings, outboundService: edge.outboundService }), { h, cookies, api } = f
 const owner = async (action, body, status = 200, cookie = cookies.owner) => {
  const r = await h.fetch(`/api/beam/entra/${action}`, { method: 'POST', headers: { origin: h.origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal(r.status, status, `Entra ${action}`); return r.json()
 }
 const scim = async (path, method = 'GET', body, status = 200, token = scimToken, extra = {}) => {
  const r = await h.fetch(`/scim/v2/${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/scim+json', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  assert.equal(r.status, status, `SCIM ${method} ${path}`)
  return status === 204 ? null : r.json()
 }
 const patch = (path, value, op = 'replace') => ({ schemas: [PATCH], Operations: [{ op, path, value }] })
 const signIn = async (claims = {}, { status = 303, invalidSignature = false } = {}) => {
  const start = await h.fetch('/auth/oidc/beam-entra/start', { method: 'POST', headers: { origin: h.origin, 'content-type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' }, body: JSON.stringify({ returnTo: '/app/learning' }) })
  assert.equal(start.status, 303, 'Entra start')
  const authorization = new URL(start.headers.get('location'))
  assert.equal(authorization.origin + authorization.pathname, `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`)
  const code = edge.grant(authorization, claims, { invalidSignature }), cookie = start.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  const path = `/auth/oidc/beam-entra/callback?state=${authorization.searchParams.get('state')}&code=${code}`
  const response = await h.fetch(path, { headers: { cookie, 'CF-Connecting-IP': '192.0.2.1' } })
  assert.equal(response.status, status, 'Entra callback')
  const signed = response.headers.getSetCookie().filter(c => !c.includes('Max-Age=0')).map(c => c.split(';')[0]).join('; ')
  return { cookie: signed, callback: path, correlation: cookie }
 }
 try {
  await owner('configure', { tenantId, clientId, enabled: true, consent: true, reason: 'Test tenant reviewed' }, 403, cookies.manager)
  await owner('configure', { tenantId: foreignTenant, clientId, enabled: true, consent: true, reason: 'Foreign tenant' }, 409)
  await owner('configure', { tenantId, clientId, enabled: true, reason: 'Missing consent' }, 403)
  await owner('configure', { tenantId, clientId, enabled: true, consent: true, reason: 'Entra tenant and provisioning scope reviewed' })
  await scim('Users', 'GET', undefined, 401, 'synthetic-beam-99')
  const userBody = { schemas: [USER], externalId, userName: 'entra.employee@example.test', displayName: 'Entra employee', active: true }
  await scim('Users', 'POST', { ...userBody, userName: 'owner@example.test' }, 409)
  await scim('Users', 'POST', { ...userBody, roles: ['owner'] }, 400)
  const user = await scim('Users', 'POST', userBody, 201)
  assert.equal((await scim('Users?filter=' + encodeURIComponent(`externalId eq "${externalId}"`))).Resources[0].id, user.id)
  const group = await scim('Groups', 'POST', { schemas: [GROUP], externalId: externalGroup, displayName: 'Reviewed learners', members: [{ value: user.id }] }, 201)
  await owner('map', { group: group.id, roles: ['owner'], consent: true, reason: 'Injection' }, 400)
  await owner('map', { group: group.id, roles: ['learner'], consent: true, reason: 'Only learner authority reviewed' })
  // Base's separate owner setting remains authoritative for the provider switch.
  const enable = await h.raw('/auth/settings/identity', { cookie: cookies.owner, body: { idpSignIn: true } })
  assert.equal(enable.status, 200, 'Base owner provider enable')
  // Email and oid cannot substitute for the explicitly reviewed OIDC sub.
  await signIn({ email: user.userName, email_verified: true, oid: externalId }, { status: 403 })
  await owner('associate', { externalId, subject: 'synthetic-beam-10', consent: true, evidence: 'Tenant app OIDC subject independently reviewed against SCIM object' })
  await signIn({ iss: `https://login.microsoftonline.com/${foreignTenant}/v2.0` }, { status: 400 })
  await signIn({ aud: 'synthetic-beam-11' }, { status: 400 })
  await signIn({}, { status: 400, invalidSignature: true })
  const first = await signIn({ email: 'owner@example.com', email_verified: true, oid: 'synthetic-beam-12', roles: ['owner'] })
  const me = await h.api('me', first.cookie)
  assert.equal(me.owner, false)
  assert.deepEqual(me.roles, ['learner'])
  assert.equal((await h.fetch(first.callback, { headers: { cookie: first.correlation } })).status, 400, 'OIDC callback consumed once')
  await h.api('business.configure', first.cookie, { name: 'Injected owner', timezone: 'UTC' }, 403)
  await scim(`Users/${user.id}`, 'PATCH', patch('active', 'false'), 400)
  await scim(`Groups/${group.id}`, 'PATCH', patch(`members[value eq "${user.id}"]`, undefined, 'remove'))
  await h.api('me', first.cookie, undefined, 401)
  await signIn({}, { status: 403 })
  await scim(`Groups/${group.id}`, 'PATCH', patch('members', [{ value: user.id }], 'add'))
  const second = await signIn()
  await scim(`Users/${user.id}`, 'PATCH', patch('active', false))
  await h.api('me', second.cookie, undefined, 401)
  await signIn({}, { status: 403 })
  await scim(`Users/${user.id}`, 'PATCH', patch('active', true))
  await h.api('me', second.cookie, undefined, 401)
  const third = await signIn()
  await owner('map', { group: group.id, roles: ['reviewer'], consent: true, reason: 'Explicitly change reviewed learning grant' })
  await h.api('me', third.cookie, undefined, 401)
  const fourth = await signIn(); assert.deepEqual((await h.api('me', fourth.cookie)).roles, ['reviewer'])
  await owner('associate', { externalId, revoke: true, consent: true, evidence: 'Withdraw subject association' })
  await h.api('me', fourth.cookie, undefined, 401)
  await signIn({}, { status: 403 })
  await owner('associate', { externalId, subject: 'synthetic-beam-10', consent: true, evidence: 'Reviewed again' })
  const fifth = await signIn()
  await scim(`Users/${user.id}`, 'DELETE', undefined, 204)
  await scim(`Users/${user.id}`, 'GET', undefined, 404)
  await h.api('me', fifth.cookie, undefined, 401)
  assert.equal((await scim('Users')).totalResults, 0)
  await scim(`Groups/${group.id}`, 'DELETE', undefined, 204)
  await scim(`Groups/${group.id}`, 'GET', undefined, 404)
  assert.equal((await api('owner', 'me')).owner, true, 'Owner recovery untouched')
  const events = (await api('owner', 'audit')).events
  assert.ok(events.some(e => e.action === 'entra.subject.associate') && events.some(e => e.action === 'entra.scim.patch'))
  const audit = JSON.stringify(events)
  assert.ok(!audit.includes(scimToken) && !audit.includes(bindings.ENTRA_CLIENT_SECRET), 'No provider secrets in audit')
 } finally { await h.close() }
}
