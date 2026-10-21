import assert from 'node:assert/strict'
import { file } from './harness.mjs'
export async function agentCheck(f) {
  const { api, h, cookies, ids, course, nextRevision, request, publish } = f
  const c = await course('Human publication')
  const revision = await nextRevision(c)
  const result = { cookiePublication: await request('/api/beam/revision.decide', { role: 'reviewer', body: { revision, decision: 'publish' } }) }
  assert.equal(result.cookiePublication.status, 403)
  assert.equal((await request('/app/do/revision.decide', { role: 'reviewer', body: { revision, decision: 'publish' } })).status, 403)
  await api('owner', 'person.roles', { member: ids.other, roles: ['assessor', 'reviewer'] })
  const wrongReviewer = await h.submit('revision.decide', cookies.other, { revision, decision: 'publish' })
  assert.ok(wrongReviewer.searchParams.get('error'))
  assert.equal((await api('reviewer', `revisions/${revision}`)).revision.state, 'in_review')
  result.wrongNamedHumanReviewerRefused = true
  const issue = async (role, seconds = 300) => {
    const response = await request('/api/beam/agent.issue', { role, body: { expiresInSeconds: seconds } })
    assert.equal(response.status, 200)
    assert.ok(response.data.token); assert.ok(response.data.expiresAt > Date.now())
    const parent = await request('/auth/session', { role })
    assert.ok(response.data.expiresAt <= parent.data.expiresAt)
    return response.data.token
  }
  const token = await issue('reviewer')
  const agent = (path, body) => request('/api/beam/' + path, { token, body })
  assert.equal((await agent('me')).data.id, ids.reviewer)
  result.issuance = { authenticatedHuman: true, credentialReturned: true }
  result.refused = []
  // Both transport doors, all accepted body encodings, with and without a cookie.
  for (const role of [undefined, 'reviewer']) for (const encoding of ['json', 'urlencoded', 'multipart']) {
    for (const path of ['/api/beam/revision.decide', '/app/do/revision.decide', '/api/beam/agent.issue']) {
      const r = await request(path, { token, role, encoding, body: { revision, decision: 'publish' } })
      assert.equal(r.status, 403, `${path} ${encoding} cookie=${!!role}: ${r.data?.error ?? r.errorText ?? 'non-JSON'}`)
      result.refused.push({ path, encoding, coPresentCookie: !!role, status: r.status })
    }
  }
  for (const encoding of ['json', 'urlencoded', 'multipart']) {
    const r = await request('/api/beam/revision.decide', { role: 'reviewer', encoding, body: { revision, decision: 'publish' } })
    assert.equal(r.status, 403)
  }
  for (const path of ['/api/beam/person.roles', '/api/beam/assignment.create', '/api/beam/offline.record', '/api/beam/proposal.decide']) assert.equal((await request(path, { token, role: 'owner', body: {} })).status, 403)
  for (const path of ['/app', '/app/courses', '/auth/session', '/setup']) assert.equal((await request(path, { token, role: 'owner' })).status, 403)
  for (const path of ['/auth/signout', '/app/do/course.create', '/app/do/agent.issue']) assert.equal((await request(path, { token, role: 'owner', body: {} })).status, 403)
  const forgedCookie = `__Host-operator_session=${token}`
  assert.equal((await request('/api/beam/me', { cookie: forgedCookie })).status, 401)
  for (const invalid of ['invalid', token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')]) assert.equal((await request('/api/beam/me', { token: invalid, role: 'owner' })).status, 401)
  assert.equal((await api('reviewer', `revisions/${revision}`)).revision.state, 'in_review')
  // Preparation works with the restricted token and real stored source bytes.
  const source = await api('author', 'source.create', { title: 'Agent input', licence: 'owned', licenceEvidence: 'Owned procedure', provenance: 'Business author', reviewer: ids.reviewer, file: file('procedure.txt', 'Agent preparation source bytes') })
  const download = await h.fetch(`/api/beam/source-files/${source.versionId}`, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(download.status, 200); assert.equal(await download.text(), 'Agent preparation source bytes')
  const draft = (await agent(`courses/${c.id}`)).data
  const proposal = { course: c.id, draftVersion: draft.draftVersion, inputs: [source.versionId], summary: 'Prepared from owned procedure', agent: 'Scoped preparation agent', draft: draft.draft }
  const stale = await agent('proposal.create', proposal)
  assert.equal(stale.status, 200)
  const edited = await agent('course.details', { course: c.id, draftVersion: draft.draftVersion, title: draft.title, summary: 'Prepared edit' })
  assert.equal(edited.status, 200)
  await api('reviewer', 'proposal.decide', { proposal: stale.data.id, decision: 'accept' }, 409)
  const fresh = await agent('proposal.create', { ...proposal, draftVersion: edited.data.draftVersion })
  assert.equal(fresh.status, 200)
  await api('reviewer', 'proposal.decide', { proposal: fresh.data.id, decision: 'accept' })
  assert.equal((await api('reviewer', `courses/${c.id}`)).publishedRevision, c.revision)
  result.preparation = { sourceRead: true, draftEdit: edited.status, staleProposalDenied: true, freshProposalAccepted: true, publishedRevisionUnchanged: true }
  // Roles are read again for the same token; it never gains manager capabilities.
  await api('owner', 'person.roles', { member: ids.reviewer, roles: ['learner'] })
  assert.deepEqual((await agent('me')).data.roles, ['learner'])
  const revokedHuman = await h.submit('revision.decide', cookies.reviewer, { revision, decision: 'publish' })
  assert.ok(revokedHuman.searchParams.get('error'))
  assert.equal((await api('author', `revisions/${revision}`)).revision.state, 'in_review')
  result.revokedHumanReviewerRefused = true
  assert.equal((await agent(`courses/${c.id}`)).status, 403)
  assert.equal((await agent('proposal.create', proposal)).status, 403)
  await api('owner', 'person.roles', { member: ids.reviewer, roles: ['reviewer', 'author'] })
  assert.equal((await agent(`courses/${c.id}`)).status, 200)
  const short = await issue('author', 1)
  await new Promise(resolve => setTimeout(resolve, 1100))
  assert.equal((await request('/api/beam/me', { token: short, role: 'owner' })).status, 401)
  const signout = await issue('author')
  assert.equal((await request('/auth/signout', { role: 'author', body: {} })).status, 204)
  assert.equal((await request('/api/beam/me', { token: signout, role: 'owner' })).status, 401)
  cookies.author = await h.signIn('author@example.test')
  await api('owner', 'person.access', { member: ids.reviewer, status: 'inactive' })
  assert.equal((await agent('me')).status, 401)
  await api('owner', 'person.access', { member: ids.reviewer, status: 'active' })
  assert.equal((await agent('me')).status, 401)
  cookies.reviewer = await h.signIn('reviewer@example.test')
  await publish(revision)
  result.lifecycle = { liveRolesEnforced: true, tokenExpired: true, signoutRevoked: true, accessRemovalRevoked: true, reactivationDidNotRevive: true, humanNamedReviewerPublished: true }
  return result
}

// A receiver is faked only at the HTTPS network boundary; all producer events and controls use public doors.
export async function webhookCheck() {
  const { fixture } = await import('./regression-fixture.mjs')
  const { createHmac } = await import('node:crypto')
  const f = await fixture({ bindings: { BEAM_WEBHOOK_HOSTS: 'synthetic-beam-1.example.test' } })
  const { api, h, ids, course, assign, lessons, nextRevision, publish } = f
  try {
    const c = await course('Webhook lifecycle'), out = await course('Outside webhook scope')
    const config = { name: 'Payroll lifecycle', endpoint: 'https://synthetic-beam-1.example.test/hooks', consent: true, teams: [ids.team], courses: [c.id], events: ['enrollment', 'progress', 'completion', 'renewal', 'publication'] }
    const view = () => api('owner', 'webhooks')
    const state = (id, fields = {}) => api('owner', 'webhook.state', { subscription: id, enabled: true, consent: true, ...fields })
    const run = () => api('owner', 'webhook.run', {})
    const due = id => h.db.prepare('UPDATE beam_webhook_deliveries SET due_at=? WHERE id=?').bind(Date.now() - 1, id).run()
    const replay = (id, fields = {}) => api('owner', 'webhook.replay', { delivery: id, ...fields })
    await api('manager', 'webhook.subscribe', config, 403)
    await api('learner', 'webhooks', undefined, 403)
    await api('owner', 'webhook.subscribe', { ...config, consent: false }, 400)
    for (const endpoint of ['http://example.com/hooks', 'https://127.0.0.1/hooks', 'https://[::1]/hooks', 'https://2130706433/hooks', 'https://internal/hooks', 'https://foo.local/hooks', 'https://example.com:8443/hooks', 'https://u:p@example.com/hooks', config.endpoint + '?secret=synthetic-beam-1', config.endpoint + '#fragment']) await api('owner', 'webhook.subscribe', { ...config, endpoint }, 400)
    await api('owner', 'webhook.subscribe', { ...config, endpoint: 'https://unadmitted.example.test/hooks' }, 403)
    await api('owner', 'webhook.subscribe', { ...config, teams: [] }, 400)
    const s = await api('owner', 'webhook.subscribe', config)
    assert.deepEqual([s.state, s.keyVersion], ['disabled', 1])
    assert.ok(!JSON.stringify(await view()).includes(s.key))
    const assignment = await assign(c)
    assert.equal((await view()).deliveries.length, 0, 'disabled subscriptions never collect old learning')
    await state(s.id)
    const revision = await nextRevision(c); await publish(revision)
    await lessons(assignment)
    await lessons(await assign(out))
    let v = await view()
    assert.deepEqual(v.deliveries.map(d => d.type).sort(), ['completion', 'progress', 'publication'])
    assert.ok(v.deliveries.every(d => JSON.parse(d.data).course === c.id))
    await run()
    assert.equal(h.edge.webhooks.length, 3)
    for (const message of h.edge.webhooks) {
      const envelope = JSON.parse(message.body), { headers } = message
      assert.equal(envelope.schema, 'beam.lifecycle.v1'); assert.ok(envelope.id && envelope.time)
      assert.equal(headers['x-beam-event-id'], envelope.id)
      assert.deepEqual(Object.keys(envelope.data).sort(), (envelope.type === 'completion' ? ['assignment', 'completion', 'course', 'learner', 'revision'] : envelope.type === 'progress' ? ['assignment', 'course', 'learner', 'lessonsDone', 'revision'] : ['course', 'revision']).sort())
      const match = headers['x-beam-signature'].match(/^t=(\d+),v1=([a-f0-9]{64})$/)
      assert.equal(match[2], createHmac('sha256', Buffer.from(s.key, 'base64')).update(`${match[1]}.${message.body}`).digest('hex'))
      assert.ok(!message.body.includes('evidence') && !message.body.includes('@example.test'))
    }
    await run(); assert.equal(h.edge.webhooks.length, 3, 'completed sends are never repeated by cron')
    const configure = async changes => {
      const { policy } = await api('owner', 'automation-controls')
      return api('owner', 'automation.policy', { version: policy.version, paused: false, quietStart: 0, quietEnd: 0, dailyLimit: 1000, ...changes })
    }
    // Enrollment/renewal carry the same native assignment and exact revision as the learner sees.
    const path = (await api('manager', 'path.create', { name: 'Annual learning', team: ids.team })).id
    await api('manager', 'path.revise', { path, courses: [c.id], dueDays: ['30'], renewalDays: ['1'] })
    const enrollment = (await api('manager', 'path.assign', { path })).created[0]
    await configure({ paused: true }); await run()
    let d = (await view()).deliveries.find(d => d.type === 'enrollment' && JSON.parse(d.data).assignment === enrollment)
    assert.equal(d.outcome, 'paused'); assert.equal(h.edge.webhooks.length, 3)
    await configure({ dailyLimit: 0 }); await replay(d.id)
    assert.equal((await view()).deliveries.find(row => row.id === d.id).outcome, 'rate_limited')
    const hour = new Date().getUTCHours()
    await configure({ quietStart: hour, quietEnd: (hour + 1) % 24 }); await replay(d.id)
    assert.equal((await view()).deliveries.find(row => row.id === d.id).outcome, 'quiet_hours')
    await configure({}); await configure({ kind: 'webhook', rule: s.id, mode: 'approval' }); await replay(d.id)
    let controls = await api('owner', 'automation-controls'), execution = controls.executions.find(x => x.input.delivery === d.id)
    assert.equal(execution.outcome, 'approval_required')
    await api('owner', 'automation.approve', { execution: execution.id, version: controls.policy.version })
    // Changing the policy invalidates an old approval.
    await configure({}); await replay(d.id)
    assert.equal((await view()).deliveries.find(row => row.id === d.id).outcome, 'approval_required')
    controls = await api('owner', 'automation-controls')
    await api('owner', 'automation.approve', { execution: execution.id, version: controls.policy.version })
    await replay(d.id)
    assert.equal((await view()).deliveries.find(row => row.id === d.id).state, 'delivered')
    await configure({ kind: 'webhook', rule: s.id, mode: 'automatic' })
    await lessons(enrollment)
    const completionRow = await h.db.prepare('SELECT id FROM beam_completions WHERE assignment_id=?').bind(enrollment).first()
    // Only the passage of time is moved through the runtime DB, as in the renewal checks.
    await h.db.prepare('UPDATE beam_completions SET expires_at=? WHERE id=?').bind(Date.now() - 1000, completionRow.id).run()
    await api('manager', 'assignment.renewals', { completions: [completionRow.id] })
    v = await view()
    const renewal = v.deliveries.find(row => row.type === 'renewal')
    assert.ok(renewal && JSON.parse(renewal.data).revision === revision)
    // Receiver rejects a signature: record the exact denial, bounded delays and stable-id redelivery.
    h.edge.webhookStatus = 401
    await run()
    d = (await view()).deliveries.find(row => row.id === renewal.id)
    assert.deepEqual([d.state, d.tries, d.outcome], ['retry', 1, 'http_401'])
    const sent = h.edge.webhooks.length
    await run(); assert.equal(h.edge.webhooks.length, sent, 'no hidden automatic provider retry')
    await replay(d.id); assert.equal(h.edge.webhooks.length, sent, 'backoff refuses early replay')
    for (let i = 0; i < 2; i++) { await due(d.id); await replay(d.id) }
    d = (await view()).deliveries.find(row => row.id === d.id)
    assert.deepEqual([d.state, d.tries], ['dead_letter', 3])
    await api('owner', 'webhook.replay', { delivery: d.id }, 409)
    const attempts = (await view()).attempts.filter(row => row.delivery_id === d.id)
    assert.deepEqual(attempts.map(row => row.status), [401, 401, 401])
    assert.ok((await api('owner', 'automation-controls')).executions.some(x => x.input.delivery === d.id && x.outcome === 'failed' && x.failure.includes('webhook_provider_denied')))
    h.edge.webhookStatus = 204
    await due(d.id); await replay(d.id, { confirm: true })
    assert.equal((await view()).deliveries.find(row => row.id === d.id).state, 'delivered')
    const idsSent = h.edge.webhooks.filter(m => JSON.parse(m.body).type === 'renewal').map(m => m.headers['x-beam-event-id'])
    assert.equal(new Set(idsSent).size, 1, 'redelivery preserves the stable event id')
    // A revoked subscription and removed current team scope suppress old queued data.
    const rotated = await api('owner', 'webhook.rotate', { subscription: s.id })
    assert.notEqual(rotated.key, s.key); assert.equal(rotated.keyVersion, 2)
    await state(s.id)
    await publish(await nextRevision(c)); await run()
    const last = h.edge.webhooks.at(-1), match = last.headers['x-beam-signature'].match(/^t=(\d+),v1=(.+)$/)
    assert.equal(match[2], createHmac('sha256', Buffer.from(rotated.key, 'base64')).update(`${match[1]}.${last.body}`).digest('hex'))
    assert.notEqual(match[2], createHmac('sha256', Buffer.from(s.key, 'base64')).update(`${match[1]}.${last.body}`).digest('hex'))
    // 302 is a failure and the private Location is never followed or kept.
    await publish(await nextRevision(c)); h.edge.webhookStatus = 302; await run()
    assert.ok((await view()).deliveries.some(d => d.outcome === 'http_302'))
    await publish(await nextRevision(c)); await state(s.id, { enabled: false, revoke: true })
    const beforeRevoke = h.edge.webhooks.length; await run()
    for (const row of (await view()).deliveries.filter(d => d.state === 'retry')) { await due(row.id); await replay(row.id) }
    assert.equal(h.edge.webhooks.length, beforeRevoke)
    await api('owner', 'webhook.state', { subscription: s.id, enabled: true, consent: true }, 404)
    const scoped = await api('owner', 'webhook.subscribe', config); await state(scoped.id)
    const cancel = (await api('learner', 'records/me')).assignments.find(a => a.course === c.id && a.status === 'open')
    if (cancel) await api('manager', 'assignment.cancel', { assignment: cancel.id, reason: 'Scope test' })
    await assign(c)
    await api('owner', 'team.members', { team: ids.team, members: [] })
    await run(); assert.equal(h.edge.webhooks.length, beforeRevoke, 'current team membership is checked at send')
    assert.ok((await view()).deliveries.some(d => d.subscription_id === scoped.id && d.state === 'suppressed'))
    const audit = JSON.stringify(await api('owner', 'audit?q=webhook'))
    assert.ok(audit.includes('webhook.subscribe') && audit.includes('webhook.delivery') && audit.includes('webhook.revoke'))
    assert.ok(!audit.includes(s.key) && !audit.includes(rotated.key))
  } finally { await h.close() }
}
