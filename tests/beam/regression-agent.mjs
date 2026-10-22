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

// The external tool's JWTs are generated at its protocol boundary, using real RS256 keys.
export async function ltiCheck() {
  const { fixture } = await import('./regression-fixture.mjs')
  const { generateKeyPairSync, sign, verify, createPublicKey } = await import('node:crypto')
  const f = await fixture({ bindings: { BEAM_LTI_HOSTS: 'synthetic-beam-2.example.test', BEAM_WEBHOOK_HOSTS: 'synthetic-beam-1.example.test' } })
  const { h, api, ids, cookies, course, assign, publish, nextRevision, request } = f
  const LTI = 'https://purl.imsglobal.org/spec/lti/claim/', DL = 'https://purl.imsglobal.org/spec/lti-dl/claim/', AGS = 'https://purl.imsglobal.org/spec/lti-ags/'
  const pair = kid => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
    return { ...keys, kid, jwk: { ...keys.publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' } }
  }
  const toolKeys = pair('synthetic-beam-1'), rotatedKeys = pair('synthetic-beam-2')
  const jwt = (key, claims) => {
    const prefix = [Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: key.kid })).toString('base64url'), Buffer.from(JSON.stringify(claims)).toString('base64url')].join('.')
    return prefix + '.' + sign('RSA-SHA256', Buffer.from(prefix), key.privateKey).toString('base64url')
  }
  const parse = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url'))
  async function protocol(path, { body, token, status = 200, cookie } = {}) {
    const response = await h.fetch('/api/beam/lti/' + path, { method: body ? 'POST' : 'GET', headers: { ...(body instanceof URLSearchParams ? { 'content-type': 'application/x-www-form-urlencoded' } : body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cookie ? { cookie } : {}) }, body: body instanceof URLSearchParams ? body : body ? JSON.stringify(body) : undefined })
    const text = await response.text()
    assert.equal(response.status, status, `lti/${path}: ${response.status} ${response.status >= 400 ? text.slice(0, 300) : ''}`)
    return text ? JSON.parse(text) : null
  }
  const configure = { name: 'Reviewed external safety', issuer: h.origin, clientId: 'synthetic-beam-1', deployment: 'synthetic-beam-1', loginUrl: 'https://synthetic-beam-2.example.test/login', redirectUri: 'https://synthetic-beam-2.example.test/launch', jwks: { keys: [toolKeys.jwk] }, consent: true }
  async function authorize(role, prepared, overrides = {}, status = 200) {
    const login = new URL(prepared.loginUrl), q = new URLSearchParams({ client_id: login.searchParams.get('client_id'), redirect_uri: configure.redirectUri, login_hint: login.searchParams.get('login_hint'), lti_message_hint: login.searchParams.get('lti_message_hint'), nonce: 'synthetic-beam-1', state: 'synthetic-beam-1', scope: 'openid', prompt: 'none', response_type: 'id_token', response_mode: 'form_post', ...overrides })
    const response = await h.raw('/api/beam/lti/authorize?' + q, { cookie: cookies[role] }), html = await response.text()
    assert.equal(response.status, status, html.slice(0, status === 200 ? 0 : 300))
    if (status !== 200) return null
    assert.match(response.headers.get('content-security-policy'), /form-action https:\/\/synthetic-beam-2.example.test/)
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
    const token = html.match(/name="id_token" value="([^"]+)"/)[1], claims = parse(token), keys = (await protocol('jwks')).keys
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url')), key = keys.find(k => k.kid === header.kid)
    assert.ok(verify('RSA-SHA256', Buffer.from(token.split('.').slice(0, 2).join('.')), createPublicKey({ key, format: 'jwk' }), Buffer.from(token.split('.')[2], 'base64url')))
    assert.ok(!['email','name','given_name','family_name','picture'].some(field => field in claims))
    assert.notEqual(claims.sub, ids[role]); assert.equal(claims.nonce, 'synthetic-beam-1')
    return { token, claims, path: '/api/beam/lti/authorize?' + q, html }
  }
  async function grant(key = toolKeys, extra = {}, status = 200, client = configure.clientId) {
    const seconds = Math.floor(Date.now() / 1000), claims = { iss: client, sub: client, aud: h.origin + '/api/beam/lti/token', iat: seconds, exp: seconds + 120, jti: crypto.randomUUID(), ...extra }
    const body = new URLSearchParams({ client_id: client, grant_type: 'client_credentials', scope: AGS + 'scope/score', client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: jwt(key, claims) })
    const result = await protocol('token', { body, status })
    return { ...result, body }
  }
  try {
    await api('manager', 'lti.register', configure, 403)
    await api('owner', 'lti.register', { ...configure, issuer: 'https://foreign.example.test' }, 400)
    await api('owner', 'lti.register', { ...configure, consent: false }, 400)
    await api('owner', 'lti.register', { ...configure, loginUrl: 'https://127.0.0.1/login' }, 403)
    await api('owner', 'lti.register', { ...configure, jwks: { keys: [{ ...toolKeys.jwk, d: 'synthetic-beam-1' }] } }, 400)
    const tool = await api('owner', 'lti.register', configure)
    assert.equal(tool.authorizationEndpoint, h.origin + '/api/beam/lti/authorize')
    assert.equal((await protocol('jwks')).keys.length, 1)
    const c = await course('LTI safety requirement'), draft = await api('author', `courses/${c.id}`)
    const prepared = await api('owner', 'lti.deep-link', { tool: tool.id, course: c.id })
    await authorize('learner', prepared, {}, 403)
    await authorize('owner', prepared, { redirect_uri: 'https://foreign.example.test/launch' }, 403)
    const selection = await authorize('owner', prepared)
    assert.equal(selection.claims[LTI + 'message_type'], 'LtiDeepLinkingRequest')
    assert.equal(selection.claims[LTI + 'deployment_id'], configure.deployment)
    assert.equal(selection.claims[DL + 'deep_linking_settings'].auto_create, false)
    await authorize('owner', prepared, {}, 403)
    const sec = Math.floor(Date.now() / 1000), responseClaims = { iss: configure.clientId, aud: h.origin, iat: sec, exp: sec + 120, [LTI + 'version']: '1.3.0', [LTI + 'deployment_id']: configure.deployment, [LTI + 'message_type']: 'LtiDeepLinkingResponse', [DL + 'data']: selection.claims[DL + 'deep_linking_settings'].data, [DL + 'content_items']: [{ type: 'ltiResourceLink', title: 'External safety exercise', url: 'https://synthetic-beam-2.example.test/activity' }] }
    await protocol('deep-link', { body: new URLSearchParams({ JWT: jwt(toolKeys, { ...responseClaims, [LTI + 'deployment_id']: 'foreign' }) }), status: 403 })
    const responseBody = new URLSearchParams({ JWT: jwt(toolKeys, responseClaims) })
    await protocol('deep-link', { body: responseBody, cookie: cookies.owner, status: 403 })
    const resource = await protocol('deep-link', { body: responseBody })
    assert.equal(resource.state, 'selected_not_published')
    await protocol('deep-link', { body: responseBody, status: 409 })
    await api('author', 'lti.attach', { resource: resource.id, course: c.id, draftVersion: draft.draftVersion, lesson: draft.draft.lessons[0].id, passPercent: 80 }, 403)
    const attached = await api('owner', 'lti.attach', { resource: resource.id, course: c.id, draftVersion: draft.draftVersion, lesson: draft.draft.lessons[0].id, passPercent: 80 })
    // Only the owner's lti.attach brings an external-tool block into a draft, for a resource selected for that course.
    const lesson = draft.draft.lessons[0].id, block = attached.draft.lessons[0].blocks.find(item => item.kind === 'lti')
    const other = await course('LTI fence target'), otherDraft = await api('author', `courses/${other.id}`)
    const prep = (await request('/api/beam/agent.issue', { role: 'author', body: { expiresInSeconds: 600 } })).data.token
    for (const [target, draftVersion, into] of [[c.id, attached.draftVersion, lesson], [other.id, otherDraft.draftVersion, otherDraft.draft.lessons[0].id]]) {
      for (const [path, fields] of [['course.block', { content: { kind: 'lti', text: 'External safety exercise', resource: resource.id, passPercent: 80 } }], ['course.block.reuse', { from: `${c.id}:${lesson}:${block.id}` }]]) {
        const body = { course: target, draftVersion, lesson: into, ...fields }
        await api('author', path, body, 403)
        assert.equal((await request('/api/beam/' + path, { token: prep, body })).status, 403, `preparation credential ${path}`)
      }
    }
    const borrowed = { ...otherDraft.draft, lessons: [{ ...otherDraft.draft.lessons[0], blocks: [block] }] }
    assert.equal((await request('/api/beam/proposal.create', { token: prep, body: { course: other.id, draftVersion: otherDraft.draftVersion, summary: 'Borrow a tool', inputs: [], draft: borrowed } })).status, 404)
    const copy = await api('owner', 'course.clone', { course: c.id })
    assert.equal(copy.externalToolsLeftOut, 1)
    assert.ok(!(await api('owner', `courses/${copy.id}`)).draft.lessons.some(item => item.blocks?.some(b => b.kind === 'lti')), 'a course copy waits for the owner to attach its own tool')
    // Duplicating, reordering and removing within the course stay open.
    let edited = await api('author', 'course.block.change', { course: c.id, draftVersion: attached.draftVersion, lesson, block: block.id, operation: 'duplicate' })
    const duplicate = edited.draft.lessons[0].blocks.find(item => item.kind === 'lti' && item.id !== block.id)
    edited = await api('author', 'course.block.change', { course: c.id, draftVersion: edited.draftVersion, lesson, block: duplicate.id, operation: 'up' })
    edited = await api('author', 'course.block.change', { course: c.id, draftVersion: edited.draftVersion, lesson, block: duplicate.id, operation: 'remove' })
    const revision = (await api('author', 'course.submit', { course: c.id, draftVersion: edited.draftVersion })).id
    await publish(revision)
    const assignment = await assign(c), view = await api('learner', `assignments/${assignment}`)
    assert.equal(view.externalTools[0].passed, false)
    await api('manager', 'lti.launch', { assignment, resource: resource.id }, 403)
    const launch = await api('learner', 'lti.launch', { assignment, resource: resource.id })
    const opened = await authorize('learner', launch), payload = opened.claims
    assert.equal(payload[LTI + 'message_type'], 'LtiResourceLinkRequest')
    assert.equal(payload[LTI + 'resource_link'].id, resource.id)
    const endpoint = payload[AGS + 'claim/endpoint'].lineitem.replace(h.origin + '/api/beam/lti/', '') + '/scores'
    assert.deepEqual(payload[AGS + 'claim/endpoint'].scope, [AGS + 'scope/score'])
    let token = await grant()
    await protocol('token', { body: token.body, status: 401 })
    await grant(toolKeys, { aud: 'https://foreign.example.test/token' }, 401)
    await grant(toolKeys, { exp: sec - 1 }, 401)
    const foreign = await api('owner', 'lti.register', { ...configure, clientId: 'synthetic-beam-2', deployment: 'synthetic-beam-2' })
    const foreignToken = await grant(toolKeys, {}, 200, 'synthetic-beam-2')
    let stamp = Date.now()
    const score = (extra = {}) => ({ userId: payload.sub, scoreGiven: 100, scoreMaximum: 100, activityProgress: 'Completed', gradingProgress: 'FullyGraded', timestamp: new Date(stamp++).toISOString(), ...extra })
    await protocol(endpoint, { body: score(), token: foreignToken.access_token, status: 404 })
    await protocol(endpoint, { body: score({ userId: 'foreign' }), token: token.access_token, status: 400 })
    await protocol(endpoint, { body: score({ scoreMaximum: 0 }), token: token.access_token, status: 400 })
    await protocol(endpoint, { body: score({ scoreGiven: 0 }), token: token.access_token })
    assert.equal((await api('learner', `assignments/${assignment}`)).externalTools[0].passed, false)
    await protocol(endpoint, { body: score({ activityProgress: 'InProgress' }), token: token.access_token })
    assert.equal((await api('learner', `assignments/${assignment}`)).externalTools[0].passed, false)
    const passed = score(), received = await protocol(endpoint, { body: passed, token: token.access_token })
    assert.equal(received.completion, null, 'an external grade never substitutes native lesson evidence')
    await protocol(endpoint, { body: passed, token: token.access_token, status: 409 })
    const link2 = (await api('owner', 'lti.platform.rotate', {})).kid
    const again = await authorize('learner', await api('learner', 'lti.launch', { assignment, resource: resource.id }))
    assert.equal(JSON.parse(Buffer.from(again.token.split('.')[0], 'base64url')).kid, link2)
    assert.ok((await protocol('jwks')).keys.length >= 2, 'old public key remains during token expiry overlap')
    await api('owner', 'lti.keys', { tool: tool.id, version: 1, jwks: { keys: [rotatedKeys.jwk] } })
    await grant(toolKeys, {}, 401)
    await protocol(endpoint, { body: score(), token: token.access_token, status: 401 })
    token = await grant(rotatedKeys)
    await api('manager', 'assignment.reset', { assignment, reason: 'Fresh external exercise required' })
    assert.equal((await api('learner', `assignments/${assignment}`)).externalTools[0].passed, false)
    await protocol(endpoint, { body: score(), token: token.access_token, status: 409 })
    await authorize('learner', await api('learner', 'lti.launch', { assignment, resource: resource.id }))
    await protocol(endpoint, { body: score(), token: token.access_token })
    await f.lessons(assignment)
    const completed = (await api('learner', 'records/me')).completions.find(row => row.course === c.id)
    assert.ok(completed && completed.revision === revision)
    const row = await h.db.prepare('SELECT course_revision_id,evidence_json FROM beam_completions WHERE id=?').bind(completed.id).first()
    assert.equal(row.course_revision_id, revision)
    const evidence = JSON.parse(row.evidence_json)
    assert.ok(evidence.externalTools[0].result && evidence.externalTools[0].resource === resource.id && evidence.externalTools[0].revision === revision)
    await protocol(endpoint, { body: score(), token: token.access_token, status: 409 })
    const openExport = await (await h.raw('/app/data-export.json', { cookie: cookies.owner })).json()
    assert.ok(openExport.records.beam_lti_results.rows.some(result => result.id === evidence.externalTools[0].result))
    assert.ok(openExport.records.beam_lti_lineitems.rows.some(item => item.revision_id === revision && item.assignment_id === assignment))
    for (const excluded of ['beam_lti_tools', 'beam_lti_platform_keys', 'beam_lti_tokens', 'beam_lti_launches']) assert.equal(openExport.records[excluded], undefined)
    const subscription = await api('owner', 'webhook.subscribe', { name: 'Archive receiver', endpoint: 'https://synthetic-beam-1.example.test/hooks', consent: true, courses: [c.id], teams: [ids.team], events: ['completion', 'publication'] })
    await api('owner', 'webhook.state', { subscription: subscription.id, enabled: true, consent: true })
    await publish(await nextRevision(c))
    const { integrationArchiveCheck } = await import('./regression-archive.mjs')
    await integrationArchiveCheck(f, { tool: tool.id, subscription: subscription.id, completion: completed.id, token: token.access_token, key: subscription.key })
    if (process.env.BEAM_LTI_BROWSER === '1') await ltiBrowserCheck(f, { course: c.id, revision, assignment, resource: resource.id, configure })
    const pendingAssignment = await assign(c)
    const pending = await authorize('learner', await api('learner', 'lti.launch', { assignment: pendingAssignment, resource: resource.id }))
    const pendingEndpoint = pending.claims[AGS + 'claim/endpoint'].lineitem.replace(h.origin + '/api/beam/lti/', '') + '/scores'
    await api('owner', 'lti.revoke', { tool: tool.id })
    await protocol(pendingEndpoint, { body: score(), token: token.access_token, status: 401 })
    await grant(rotatedKeys, {}, 403)
    await api('learner', 'lti.launch', { assignment: pendingAssignment, resource: resource.id }, 403)
    await api('learner', 'lti', undefined, 403)
    assert.ok((await api('owner', 'lti')).results.every(result => result.revision_id === revision))
    const old = await h.db.prepare('SELECT evidence_json FROM beam_completions WHERE id=?').bind(completed.id).first()
    assert.deepEqual(JSON.parse(old.evidence_json), evidence, 'revocation/rotation never rewrite completion lineage')
  } finally { await h.close() }
}

async function ltiBrowserCheck(f, item) {
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const { mkdir } = await import('node:fs/promises'), { join } = await import('node:path')
  const evidence = process.env.BEAM_EVIDENCE_DIR || 'test-results'
  await mkdir(evidence, { recursive: true })
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true })
      const page = await context.newPage()
      async function as(role) { await context.clearCookies(); await context.addCookies(f.cookies[role].split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: f.h.origin }))) }
      async function shot(name) { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} overflow ${width}`); await page.screenshot({ path: join(evidence, `${width}-lti-${name}.png`), fullPage: true }) }
      await as('learner'); await page.goto(`${f.h.origin}/app/learn/${item.assignment}`); await page.getByRole('heading', { name: 'External learning tools', exact: true }).waitFor(); await shot('course')
      const pending = await f.assign({ id: item.course })
      const prepared = await f.api('learner', 'lti.launch', { assignment: pending, resource: item.resource }), q = new URL(prepared.loginUrl).searchParams
      const query = new URLSearchParams({ client_id: q.get('client_id'), login_hint: q.get('login_hint'), lti_message_hint: q.get('lti_message_hint'), redirect_uri: item.configure.redirectUri, nonce: 'synthetic-beam-1', state: 'synthetic-beam-1', scope: 'openid', prompt: 'none', response_type: 'id_token', response_mode: 'form_post' })
      await page.goto(`${f.h.origin}/api/beam/lti/authorize?${query}`); await page.getByRole('button', { name: 'Continue to external tool', exact: true }).waitFor(); await shot('handoff')
      const view = await f.api('learner', `assignments/${pending}`)
      await page.goto(`${f.h.origin}/app/learn/${pending}/lessons/${view.lessons[0].id}`); await page.getByText(/external learning tool\. Open the tool/).waitFor(); await shot('lesson')
      await f.api('manager', 'assignment.cancel', { assignment: pending, reason: 'Browser proof completed' })
      await as('author'); await page.goto(`${f.h.origin}/app/courses/${item.course}`); await shot('author')
      await as('reviewer'); await page.goto(`${f.h.origin}/app/revisions/${item.revision}`); await shot('review')
      await context.close(); console.log(`PASS LTI course/lesson/handoff/author/review ${width}`)
    }
  } finally { await browser.close() }
}
