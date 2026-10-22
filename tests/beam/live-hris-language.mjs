// Future opt-in qualification, not evidence until executed on the built candidate.
// BEAM_LIVE_PROOF=1 BEAM_EVIDENCE_DIR=<private-path> _od08-env.py \
// GUSTO_ACCESS_TOKEN=GUSTO_ACCESS_TOKEN GUSTO_COMPANY_UUID=GUSTO_COMPANY_UUID \
// GUSTO_EMPLOYEE_UUID=GUSTO_EMPLOYEE_UUID GUSTO_LANGUAGE_FIELD_ID=GUSTO_LANGUAGE_FIELD_ID \
// -- node tests/beam/live-hris-language.mjs
// Company OAuth authorization plus an already configured employee language field are required.
// App client credentials/system tokens alone cannot read employees:
// https://docs.gusto.com/app-integrations/docs/system-access-tokens
// Custom-field reads expose company_custom_field_id and value; no field write API is assumed:
// https://docs.gusto.com/embedded-payroll/reference/get-v1-employees-employee_id-custom_fields
// Header version: same endpoint explicitly supports 2026-06-15. Demo only; never production.
import assert from 'node:assert/strict'
import { fixture } from './regression-fixture.mjs'
import { optIn, required, evidence } from './live-provider-runtime.mjs'

optIn()
const accessToken = required('GUSTO_ACCESS_TOKEN')
const identifiers = Object.fromEntries(['GUSTO_COMPANY_UUID', 'GUSTO_EMPLOYEE_UUID', 'GUSTO_LANGUAGE_FIELD_ID'].map(name => {
  const value = required(name)
  assert.match(value, /^[a-zA-Z0-9_-]{1,100}$/, `Invalid ${name}`)
  return [name, value]
}))
const origin = 'https://api.gusto-demo.com', employeePath = `/v1/employees/${encodeURIComponent(identifiers.GUSTO_EMPLOYEE_UUID)}`
const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'X-Gusto-API-Version': '2026-06-15' }
// Read only the existing field to establish its real expected value. Never create or alter provider records.
const actual = await fetch(origin + employeePath + '/custom_fields', { headers, redirect: 'manual', signal: AbortSignal.timeout(20_000) })
assert.equal(actual.status, 200, 'Gusto demo custom-field read requires authorized company access')
const body = await actual.json()
assert.ok(Array.isArray(body.custom_fields), 'Gusto returns its documented custom-field collection')
const matches = body.custom_fields.filter(field => field.company_custom_field_id === identifiers.GUSTO_LANGUAGE_FIELD_ID)
assert.equal(matches.length, 1, 'A unique configured company language field is required')
const field = matches[0]
assert.ok(['text', 'radio'].includes(field.type), 'Configured language field is text or radio')
assert.ok(typeof field.value === 'string' && /^(en|es)(-US)?$/i.test(field.value), 'Live qualification needs an existing supported English or Spanish preference')
const expected = /^es/i.test(field.value) ? 'es-US' : 'en-US'
const canonicalStored = Intl.getCanonicalLocales(field.value)[0]
const calls = []
const f = await fixture({ bindings: { GUSTO_ACCESS_TOKEN: accessToken }, outboundService: async request => {
  const url = new URL(request.url)
  if (url.origin !== origin) return null
  assert.equal(request.method, 'GET', 'Application performs read-only Gusto requests')
  assert.ok([employeePath, employeePath + '/custom_fields'].includes(url.pathname) && !url.search, 'Only the consented employee endpoints are requested')
  calls.push(url.pathname === employeePath ? 'employee' : 'custom_fields')
  return fetch(request.url, { method: 'GET', headers: Object.fromEntries(request.headers), redirect: 'manual', signal: AbortSignal.timeout(20_000) })
} })
try {
  const { api, ids } = f
  const course = await f.course('synthetic-beam-1'), assignment = await f.assign(course)
  await f.lessons(assignment)
  const prior = (await api('learner', 'records/me')).completions
  assert.ok(prior.length, 'A real prior completion exists before HRIS preference ingestion')
  await api('owner', 'person.directory', { member: ids.learner, employeeId: 'synthetic-beam-2' })
  const mapping = await api('owner', 'gusto.language.configure', {
    member: ids.learner, employeeId: 'synthetic-beam-2', companyUuid: identifiers.GUSTO_COMPANY_UUID,
    employeeUuid: identifiers.GUSTO_EMPLOYEE_UUID, fieldId: identifiers.GUSTO_LANGUAGE_FIELD_ID,
    environment: 'demo', version: 0, consent: true,
  })
  assert.equal(calls.length, 0, 'Read consent does not initiate an implicit provider request')
  const pulled = await api('owner', 'gusto.language.pull', { mapping: mapping.id, version: mapping.version })
  assert.equal(pulled.outcome, 'updated', 'The actual provider employee/company identity and field are accepted')
  assert.deepEqual(calls, ['employee', 'custom_fields'], 'Real application requests reached both documented provider endpoints')
  const directory = await api('owner', `directory/${ids.learner}`)
  assert.equal(directory.person.language, canonicalStored, 'Actual HRIS preference is stored')
  assert.equal((await api('learner', 'language')).language, expected, 'HRIS preference selects the learner locale')
  assert.equal((await api('learner', 'me')).id, ids.learner, 'Stable learner identity survives preference ingestion')
  assert.deepEqual((await api('learner', 'records/me')).completions, prior, 'HRIS preference preserves prior learning')
  const status = (await api('owner', 'gusto-language')).mappings.find(row => row.id === mapping.id)
  assert.ok(status.last_synced_at && status.last_outcome === 'updated' && !status.last_failure)
  await api('owner', 'gusto.language.revoke', { mapping: mapping.id, version: mapping.version })
  await api('owner', 'gusto.language.pull', { mapping: mapping.id, version: mapping.version + 1 }, 409)
  assert.equal(calls.length, 2, 'Revoked read consent prevents further provider access')
  await evidence('live-hris-language', { provider: 'gusto', environment: 'demo', actualPreference: expected, priorCompletionIds: prior.map(row => row.id), priorLearningPreserved: true, identityPreserved: true, providerReads: calls, consentRevoked: true, remoteWrites: 0, remoteResourcesCreated: 0 })
  console.log('PASS actual Gusto demo language ingestion, retained learning and revoked consent; no remote writes')
} finally { await f.h.close() }
