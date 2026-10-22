import assert from 'node:assert/strict'

// Imported into webhookCheck, keeping one public-flow registration. Persisted
// state is fault-injected only to represent a Worker dying after receiver ACK
// and before the delivery transaction; all recovery uses the real HTTP doors.
export async function webhookRecoveryCheck(f) {
  const { api, h, course, nextRevision, publish } = f
  h.edge.webhookStatus = 204
  const c = await course('Interrupted webhook recovery')
  const sub = await api('owner', 'webhook.subscribe', {
    name: 'Recovery receiver', endpoint: 'https://synthetic-beam-1.example.test/hooks',
    consent: true, teams: [], courses: [c.id], events: ['publication'],
  })
  await api('owner', 'webhook.state', { subscription: sub.id, enabled: true, consent: true })
  await publish(await nextRevision(c))
  const view = () => api('owner', 'webhooks')
  const row = async () => (await view()).deliveries.find(d => d.subscription_id === sub.id)
  const run = () => api('owner', 'webhook.run', {})
  const replay = fields => api('owner', 'webhook.replay', { delivery: delivery.id, ...fields })
  await run()
  let delivery = await row()
  assert.equal(delivery.state, 'delivered')
  const original = h.edge.webhooks.find(m => m.headers['x-beam-event-id'] === delivery.event_id)
  assert.ok(original)
  const count = () => h.edge.webhooks.filter(m => m.headers['x-beam-event-id'] === delivery.event_id).length
  const execution = (await api('owner', 'automation-controls')).executions.find(e => e.input.delivery === delivery.id)
  assert.ok(execution)
  await h.db.prepare("UPDATE beam_automation_executions SET state='running',outcome='reserved',failure=NULL WHERE id=?").bind(execution.id).run()
  await h.db.prepare('DELETE FROM beam_webhook_attempts WHERE delivery_id=?').bind(delivery.id).run()
  await h.db.prepare("UPDATE beam_webhook_deliveries SET state='sending',tries=0,outcome=NULL,send_token='synthetic-beam-1',send_started_at=?,send_expires_at=? WHERE id=?")
    .bind(Date.now(), Date.now() + 60_000, delivery.id).run()
  assert.equal((await row()).state, 'sending', 'an active sender keeps its lease')
  await replay({ confirm: true })
  assert.equal(count(), 1, 'concurrent human requests cannot resend a live attempt')
  await h.db.prepare('UPDATE beam_webhook_deliveries SET send_expires_at=? WHERE id=?').bind(Date.now() - 1, delivery.id).run()
  delivery = await row()
  assert.deepEqual([delivery.state, delivery.outcome], ['held', 'outcome_unknown'])
  assert.ok((await view()).attempts.some(a => a.delivery_id === delivery.id && a.outcome === 'outcome_unknown' && a.status === null))
  const retained = (await api('owner', 'automation-controls')).executions.find(e => e.id === execution.id)
  assert.equal(retained.outcome, 'outcome_unknown', 'the charged old reservation stays visible')
  await run(); await run()
  assert.equal(count(), 1, 'stale sends never automatically retry')
  await api('owner', 'webhook.replay', { delivery: delivery.id }, 409)
  const { policy } = await api('owner', 'automation-controls')
  const configure = paused => api('owner', 'automation.policy', {
    version: policy.version, paused, quietStart: 0, quietEnd: 0, dailyLimit: 1000,
  })
  await configure(true)
  await replay({ confirm: true })
  assert.equal((await row()).outcome, 'paused', 'confirmed recovery still checks current policy')
  assert.equal(count(), 1)
  const current = (await api('owner', 'automation-controls')).policy
  await api('owner', 'automation.policy', { version: current.version, paused: false, quietStart: 0, quietEnd: 0, dailyLimit: 1000 })
  await Promise.all([replay({}), replay({})])
  assert.equal(count(), 2, 'concurrent replays reserve exactly one sender')
  assert.equal((await row()).state, 'delivered')
  const resent = h.edge.webhooks.findLast(m => m.headers['x-beam-event-id'] === delivery.event_id)
  assert.equal(resent.body, original.body, 'human-confirmed recovery preserves the event id and body')
  assert.ok(JSON.stringify(await api('owner', 'audit?q=webhook')).includes('webhook.interrupted'))
}
