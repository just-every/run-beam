import assert from 'node:assert/strict'

// Delegation is exercised through ordinary human JSON/form doors, in the existing integration flows.
export async function ltiScopeCheck(f, { configure, toolKeys, jwt, authorize, protocol, LTI, DL }) {
  const { api, h, ids, cookies, course } = f
  const unit = (await api('owner', 'unit.create', { name: 'LTI region', teams: [ids.team] })).id
  const c = await course('Delegated external exercise')
  await api('owner', 'course.unit', { course: c.id, unit })
  const fields = { ...configure, unit, clientId: 'synthetic-beam-3', deployment: 'synthetic-beam-3' }
  const grant = await api('owner', 'admin.grant', { member: ids.other, unit })
  const tool = await api('other', 'lti.register', fields)
  async function selectAndAttach(role, tool, client) {
    const prepared = await api(role, 'lti.deep-link', { tool, course: c.id })
    const opened = await authorize(role, prepared)
    const sec = Math.floor(Date.now() / 1000)
    const claims = { iss: client, aud: h.origin, iat: sec, exp: sec + 120,
      [LTI + 'version']: '1.3.0', [LTI + 'deployment_id']: fields.deployment,
      [LTI + 'message_type']: 'LtiDeepLinkingResponse',
      [DL + 'data']: opened.claims[DL + 'deep_linking_settings'].data,
      [DL + 'content_items']: [{ type: 'ltiResourceLink', title: 'Regional exercise', url: 'https://synthetic-beam-2.example.test/activity' }] }
    const resource = await protocol('deep-link', { body: new URLSearchParams({ JWT: jwt(toolKeys, claims) }) })
    const draft = await api(role, `courses/${c.id}`)
    await api(role, 'lti.attach', { course: c.id, resource: resource.id, draftVersion: draft.draftVersion, lesson: draft.draft.lessons[0].id, passPercent: 80 })
  }
  await selectAndAttach('other', tool.id, fields.clientId)
  await api('other', 'lti.register', { ...fields, unit: '', clientId: 'synthetic-beam-4' }, 403)
  await api('other', 'lti.deep-link', { tool: tool.id, course: c.id })
  const outside = await course('Another unit external exercise')
  await api('other', 'lti.deep-link', { tool: tool.id, course: outside.id }, 403)
  await api('other', 'lti.platform.rotate', {}, 403)
  assert.deepEqual((await api('other', 'lti')).tools.map(t => t.id), [tool.id])
  const form = await h.submit('lti.deep-link', cookies.other, { tool: tool.id, course: c.id })
  assert.equal(form.searchParams.get('error'), null)
  await api('owner', 'admin.revoke', { grant: grant.id })
  await api('other', 'lti.deep-link', { tool: tool.id, course: c.id }, 403)
  const role = await api('owner', 'role.save', { name: 'External tools coordinator', permissions: ['integrations'], units: [unit] })
  await api('owner', 'role.grant', { role: role.id, member: ids.assessor })
  await api('assessor', 'lti.register', { ...fields, clientId: 'synthetic-beam-5' }, 403)
  await api('owner', 'role.save', { role: role.id, name: 'External tools coordinator', permissions: ['integrations', 'courses'], units: [unit] })
  const custom = await api('assessor', 'lti.register', { ...fields, clientId: 'synthetic-beam-5' })
  const prepared = await api('assessor', 'lti.deep-link', { tool: custom.id, course: c.id })
  await selectAndAttach('assessor', custom.id, 'synthetic-beam-5')
  await api('assessor', 'lti.keys', { tool: custom.id, version: 1, jwks: fields.jwks })
  await api('assessor', 'lti.deep-link', { tool: custom.id, course: outside.id }, 403)
  await api('owner', 'role.save', { role: role.id, name: 'External tools coordinator', permissions: ['courses'], units: [unit] })
  await api('assessor', 'lti.deep-link', { tool: custom.id, course: c.id }, 403)
  const hint = new URL(prepared.loginUrl).searchParams
  const q = new URLSearchParams({ client_id: 'synthetic-beam-5', redirect_uri: fields.redirectUri, login_hint: hint.get('login_hint'), lti_message_hint: hint.get('lti_message_hint'), nonce: 'synthetic-beam-1', state: 'synthetic-beam-1', scope: 'openid', prompt: 'none', response_type: 'id_token', response_mode: 'form_post' })
  assert.equal((await h.raw('/api/beam/lti/authorize?' + q, { cookie: cookies.assessor })).status, 403)
}

export async function webhookScopeCheck(f) {
  const { api, h, ids, course, nextRevision, publish } = f
  const unit = (await api('owner', 'unit.create', { name: 'Webhook region', teams: [ids.team] })).id
  const c = await course('Delegated lifecycle')
  await api('owner', 'course.unit', { course: c.id, unit })
  const config = { name: 'Regional receiver', endpoint: 'https://synthetic-beam-1.example.test/hooks', consent: true, courses: [c.id], teams: [ids.team], events: ['publication'] }
  const grant = await api('owner', 'admin.grant', { member: ids.other, unit })
  const sub = await api('other', 'webhook.subscribe', config)
  const outside = await course('Outside regional lifecycle')
  await api('other', 'webhook.subscribe', { ...config, courses: [outside.id] }, 403)
  const outsider = await api('owner', 'webhook.subscribe', { ...config, courses: [outside.id] })
  await api('other', 'webhook.rotate', { subscription: outsider.id }, 403)
  assert.deepEqual((await api('other', 'webhooks')).subscriptions.map(s => s.id), [sub.id])
  await api('other', 'webhook.state', { subscription: sub.id, enabled: true, consent: true })
  await publish(await nextRevision(c))
  await api('owner', 'admin.revoke', { grant: grant.id })
  const sent = h.edge.webhooks.length
  await api('owner', 'webhook.run', {})
  assert.equal(h.edge.webhooks.length, sent, 'ending enabling authority withholds queued data')
  await api('other', 'webhook.state', { subscription: sub.id, enabled: true, consent: true }, 403)
  const role = await api('owner', 'role.save', { name: 'Webhook coordinator', permissions: ['integrations'], units: [unit] })
  const held = await api('owner', 'role.grant', { role: role.id, member: ids.assessor })
  await api('assessor', 'webhook.rotate', { subscription: sub.id })
  await api('assessor', 'webhook.state', { subscription: sub.id, enabled: true, consent: true })
  await publish(await nextRevision(c))
  await api('assessor', 'webhook.run', {})
  assert.equal(h.edge.webhooks.length, sent + 1)
  const own = await api('assessor', 'webhooks')
  assert.ok(own.deliveries.every(d => d.subscription_id === sub.id))
  await api('assessor', 'webhook.rotate', { subscription: outsider.id }, 403)
  await api('owner', 'role.revoke', { grant: held.id })
  await api('assessor', 'webhooks', undefined, 403)
}
