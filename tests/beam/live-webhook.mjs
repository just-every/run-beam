// Opt in outside push Verify via _od08-env.py; creates and removes one dedicated receiver:
// BEAM_LIVE_PROOF=1 BEAM_EVIDENCE_DIR=<private-evidence> _od08-env.py \
// CLOUDFLARE_API_TOKEN=CLOUDFLARE_RER_STAGE_TOKEN \
// -- node tests/beam/live-webhook.mjs
import assert from 'node:assert/strict'
import { optIn, liveFixture, receiverAccount, evidence, pause } from './live-provider-runtime.mjs'

optIn()
const receiver = await receiverAccount()
let f, proof
try {
  f = await liveFixture({ bindings: { BEAM_WEBHOOK_HOSTS: new URL(receiver.origin).hostname }, receiverOrigin: receiver.origin })
  const { api, ids } = f
  const controls = await api('owner', 'automation-controls')
  await api('owner', 'automation.policy', { version: controls.policy.version, paused: false, quietStart: 0, quietEnd: 0, dailyLimit: 100 })
  const course = await f.course('synthetic-beam-1')
  const subscription = await api('owner', 'webhook.subscribe', { name: 'synthetic-beam-1', endpoint: receiver.origin + '/hooks', courses: [course.id], teams: [ids.team], events: ['publication', 'enrollment', 'progress', 'completion', 'renewal'], consent: true })
  await receiver.deploy(subscription.key)
  // First request may encounter a freshly provisioned workers.dev hostname. Only readiness is polled.
  let ready = false
  for (let attempt = 0; attempt < 12; attempt++) {
    try { await receiver.request('/receipts'); ready = true; break } catch { await pause(5000) }
  }
  assert.ok(ready, 'Disposable receiver becomes reachable')
  const badSignature = await fetch(receiver.origin + '/hooks', { method: 'POST', headers: { 'content-type': 'application/json', 'x-beam-event-id': 'synthetic-beam-1', 'x-beam-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` }, body: JSON.stringify({ id: 'synthetic-beam-1', type: 'qualification' }), signal: AbortSignal.timeout(20_000) })
  assert.equal(badSignature.status, 401, 'Real receiver rejects invalid HMAC')
  const enable = () => api('owner', 'webhook.state', { subscription: subscription.id, enabled: true, consent: true })
  const publish = async () => f.publish(await f.nextRevision(course))
  const view = () => api('owner', 'webhooks')
  const receipts = async () => (await receiver.request('/receipts')).receipts
  await enable()
  await publish()
  const path = (await api('manager', 'path.create', { name: 'synthetic-beam-2', team: ids.team })).id
  await api('manager', 'path.revise', { path, courses: [course.id], dueDays: ['30'], renewalDays: ['1'] })
  const assigned = (await api('manager', 'path.assign', { path })).created[0]
  await f.lessons(assigned)
  await api('owner', 'webhook.run', {})
  const lifecycle = await receipts()
  for (const type of ['publication', 'enrollment', 'progress', 'completion']) assert.ok(lifecycle.some(row => row.type === type && row.valid && row.accepted), `Actual signed ${type} reaches the sandbox`)
  const completion = (await api('learner', 'records/me')).completions.find(row => row.course === course.id)
  // The public renewal door admits expiry inside its existing 30-day lead window.
  const renewed = await api('manager', 'assignment.renewals', { completions: [completion.id] })
  assert.ok(renewed.created.length)
  await api('owner', 'webhook.run', {})
  const renewal = (await receipts()).find(row => row.type === 'renewal' && row.valid && row.accepted)
  assert.ok(renewal, 'A real renewal event reaches the same signed receiver')
  const first = lifecycle.find(row => row.type === 'completion' && row.accepted)
  assert.ok(first?.valid && first.accepted && !first.duplicate, 'Receiver verifies real HTTPS HMAC delivery')
  assert.equal(first.keyVersion, '1')
  assert.equal((await view()).deliveries.find(row => row.event_id === first.id)?.state, 'delivered')

  await receiver.request('/control', { reject: true })
  await publish(); await api('owner', 'webhook.run', {})
  const denied = (await receipts()).at(-1)
  assert.ok(denied.valid && !denied.accepted, 'Receiver deliberately refuses an authenticated request')
  let delivery = (await view()).deliveries.find(row => row.event_id === denied.id)
  assert.equal(delivery.state, 'retry'); assert.equal(delivery.outcome, 'http_401')
  const count = (await receipts()).length
  await api('owner', 'webhook.run', {})
  assert.equal((await receipts()).length, count, 'No hidden provider retry')
  await api('owner', 'webhook.replay', { delivery: delivery.id })
  assert.equal((await receipts()).length, count, 'Early explicit replay respects backoff')
  // Honor both actual recorded backoffs, retaining the real provider's refusals.
  for (let attempt = 2; attempt <= 3; attempt++) {
    while (Date.now() <= delivery.due_at) await pause(Math.min(5000, delivery.due_at - Date.now() + 100))
    await api('owner', 'webhook.replay', { delivery: delivery.id })
    delivery = (await view()).deliveries.find(row => row.id === delivery.id)
    assert.equal(delivery.tries, attempt)
    assert.equal(delivery.state, attempt === 3 ? 'dead_letter' : 'retry')
    console.log(`LIVE_BACKOFF attempt=${attempt} state=${delivery.state}`)
  }
  await api('owner', 'webhook.replay', { delivery: delivery.id }, 409)
  const deadLetter = { tries: delivery.tries, state: delivery.state, attempts: (await view()).attempts.filter(row => row.delivery_id === delivery.id).map(row => ({ status: row.status, outcome: row.outcome })) }
  assert.ok(deadLetter.attempts.every(row => row.status === 401))
  await receiver.request('/control', { reject: false })
  await api('owner', 'webhook.replay', { delivery: delivery.id, confirm: true })
  const replayed = (await receipts()).at(-1)
  assert.ok(replayed.valid && replayed.accepted)
  assert.equal(replayed.id, denied.id); assert.equal(replayed.digest, denied.digest)
  assert.equal((await view()).deliveries.find(row => row.id === delivery.id).state, 'delivered')

  const rotated = await api('owner', 'webhook.rotate', { subscription: subscription.id })
  await receiver.rotate(rotated.key)
  await enable(); await publish(); await api('owner', 'webhook.run', {})
  const afterRotation = (await receipts()).at(-1)
  assert.ok(afterRotation.valid && afterRotation.accepted)
  assert.equal(afterRotation.keyVersion, '2')
  await publish()
  await api('owner', 'webhook.state', { subscription: subscription.id, revoke: true })
  const beforeRevoke = (await receipts()).length
  await api('owner', 'webhook.run', {})
  assert.equal((await receipts()).length, beforeRevoke, 'Revocation prevents pending outbound delivery')
  assert.ok((await view()).deliveries.some(row => row.state === 'suppressed'))
  await api('owner', 'webhook.state', { subscription: subscription.id, enabled: true, consent: true }, 404)
  proof = { receiver: receiver.name, lifecycle: [...new Set(lifecycle.filter(row => row.accepted).map(row => row.type)), 'renewal'], verified: first, renewal, refused: denied, deadLetter, replayed, rotated: afterRotation, revokedPending: true }
} finally {
  try { if (f) await f.h.close() } finally { await receiver.close() }
}
await evidence('live-webhook', { ...proof, receiverDeleted: true })
console.log('PASS live signed webhook delivery, denial, replay, rotation and revocation; receiver deleted')
