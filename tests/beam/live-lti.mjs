// Genuine anonymous saLTIre interoperability, outside push Verify. Run the built candidate:
// BEAM_LIVE_PROOF=1 BEAM_EVIDENCE_DIR=<private-path> _od08-env.py \
// CLOUDFLARE_API_TOKEN=CLOUDFLARE_RER_STAGE_TOKEN -- node tests/beam/live-lti.mjs
// A temporary HTTPS relay transports real requests/responses; all learning/auth state stays in isolated Beam.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { optIn, evidence, pause } from './live-provider-runtime.mjs'
import { publicRelay } from './live-lti-relay.mjs'
import { ltiFixture } from './live-lti-runtime.mjs'
import { saltire, toolOrigin } from './live-lti-tool.mjs'
const LTI = 'https://purl.imsglobal.org/spec/lti/claim/'
const AGS = 'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint'
optIn()
const relay = await publicRelay()
let fixture, proof
try {
  await relay.deploy()
  fixture = await ltiFixture(relay.origin)
  relay.start(fixture.raw)
  const tool = await saltire(), { api, raw, ids, cookies } = fixture
  const clientId = `synthetic-beam-${randomUUID()}`, deployment = `synthetic-beam-${randomUUID()}`
  await tool.configure(relay.origin, clientId, deployment)
  const registered = await api('owner', 'lti.register', { name: 'synthetic-beam-1', issuer: relay.origin, clientId, deployment, loginUrl: toolOrigin + '/tool', redirectUri: toolOrigin + '/tool', consent: true, jwks: { keys: [tool.jwk] } })
  const course = await api('author', 'course.create', { title: 'synthetic-beam-1', reviewer: ids.reviewer })
  const lesson = await api('author', 'course.lesson', { course: course.id, draftVersion: course.draftVersion, title: 'synthetic-beam-1', body: 'Synthetic native learning remains required.', sources: [] })
  const prepared = await api('owner', 'lti.deep-link', { tool: registered.id, course: course.id })
  const deepClaims = await tool.authorize(prepared, raw, cookies.owner)
  assert.equal(deepClaims[LTI + 'message_type'], 'LtiDeepLinkingRequest')
  const selected = await tool.deepLink(raw)
  assert.equal(selected.result.state, 'selected_not_published')
  assert.equal((await selected.replay()).status, 409, 'Real tool deep-link replay is refused')
  const draft = await api('author', `courses/${course.id}`)
  const attached = await api('owner', 'lti.attach', { resource: selected.result.id, course: course.id, draftVersion: draft.draftVersion, lesson: draft.draft.lessons[0].id, passPercent: 80 })
  const revision = (await api('author', 'course.submit', { course: course.id, draftVersion: attached.draftVersion })).id
  const published = await raw('/app/do/revision.decide', { cookie: cookies.reviewer, form: new URLSearchParams({ revision, decision: 'publish', returnTo: '/app' }) })
  assert.equal(published.status, 303)
  assert.equal(new URL(published.headers.get('location'), relay.origin).searchParams.get('error'), null)
  assert.equal((await api('reviewer', `revisions/${revision}`)).revision.state, 'published')
  const assign = async () => (await api('owner', 'assignment.create', { course: course.id, learners: [ids.learner], dueDate: '2030-10-01', dueTime: '17:00', timezone: 'UTC' })).created[0]
  const assignment = await assign()
  const claims = await tool.authorize(await api('learner', 'lti.launch', { assignment, resource: selected.result.id }), raw, cookies.learner)
  assert.equal(claims[LTI + 'message_type'], 'LtiResourceLinkRequest')
  assert.notEqual(claims.sub, ids.learner)
  for (const field of ['email', 'name', 'given_name', 'family_name', 'picture']) assert.ok(!(field in claims), 'Launch omits personal identity')
  const lineitem = claims[AGS].lineitem
  const token = await tool.token()
  assert.equal((await tool.score(token, lineitem, claims.sub, 10)).ok, true, 'Independent tool sends failing AGS grade')
  assert.equal((await api('learner', `assignments/${assignment}`)).externalTools[0].passed, false)
  await pause(1100) // The external tool timestamps scores at second resolution.
  assert.equal((await tool.score(token, lineitem, claims.sub, 100)).ok, true, 'Independent tool sends passing AGS grade')
  let view = await api('learner', `assignments/${assignment}`)
  assert.equal(view.externalTools[0].passed, true)
  assert.ok(!(await api('learner', 'records/me')).completions.some(row => row.assignment === assignment), 'Passing external grade does not substitute for native lesson')
  await api('learner', 'lesson.complete', { assignment, lesson: view.lessons[0].id })
  assert.ok((await api('learner', 'records/me')).completions.some(row => row.course === course.id), 'Native evidence finishes the reviewed revision')

  const platformKey = await api('owner', 'lti.platform.rotate', {})
  // Open a distinct assignment so the final callback is refused for revocation, rather than course completion.
  const pending = await assign()
  const pendingClaims = await tool.authorize(await api('learner', 'lti.launch', { assignment: pending, resource: selected.result.id }), raw, cookies.learner)
  const pendingToken = await tool.token()
  await api('owner', 'lti.revoke', { tool: registered.id })
  await pause(1100)
  const denied = await tool.score(pendingToken, pendingClaims[AGS].lineitem, pendingClaims.sub, 100)
  assert.equal(denied.ok, false, 'Independent tool AGS callback denied after deployment revocation')
  await api('learner', 'lti.launch', { assignment: pending, resource: selected.result.id }, 403)
  proof = { independentTool: toolOrigin, anonymous: true, deepLink: true, replayRefused: true, reviewedRevision: revision, failedThenPassed: true, nativeGate: true, platformRotated: Boolean(platformKey.kid), revocationDenied: true }
} finally {
  try { await relay.close() } finally { if (fixture) await fixture.close() }
}
await evidence('live-lti', { ...proof, relayDeleted: true })
console.log('PASS real anonymous saLTIre deep link, launch, AGS, native gate and revocation; relay deleted')
