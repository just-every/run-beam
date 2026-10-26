import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { fixture } from './regression-fixture.mjs'
import { file } from './harness.mjs'
import { modelEdge } from './model-edge.mjs'
import { tutorBrowser } from './tutor-browser.mjs'

// Move only the synthetic approval's expiry, with the fixture's ephemeral key.
// Every reservation and permission decision still goes through the HTTP doors.
async function expiredApproval(approval, secret) {
  const enc = new TextEncoder(), key = await webcrypto.subtle.importKey('raw',
    await webcrypto.subtle.digest('SHA-256', enc.encode(`beam.integration.v1:${secret}`)), 'AES-GCM', false, ['encrypt', 'decrypt'])
  const [iv, cipher] = approval.split('.').map(part => Buffer.from(part, 'base64'))
  const additionalData = enc.encode('model:approval')
  const payload = JSON.parse(new TextDecoder().decode(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData }, key, cipher)))
  payload.expiresAt = Date.now() - 1
  const nextIv = webcrypto.getRandomValues(new Uint8Array(12))
  const sealed = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv: nextIv, additionalData }, key, enc.encode(JSON.stringify(payload)))
  return `${Buffer.from(nextIv).toString('base64')}.${Buffer.from(sealed).toString('base64')}`
}

// One flow: all paid preparation and automation contend for one retained daily
// reservation. The only substituted service is the paid provider network edge.
export async function modelBudgetCheck() {
  const edge = modelEdge(data => ({ outline: ['Prepare tools'], objectives: ['Use clean tools'],
    lessons: [{ title: 'Clean tools', body: 'Use clean tools.', passages: [data.passages[0].id] }],
    questions: [{ prompt: 'Which tools?', choices: ['Clean', 'Dirty'], correct: 0, passages: [data.passages[0].id] }], missing: [], refusedInstructions: [] }))
  let mode = 'success', attempts = 0, release, entered
  const f = await fixture({ businessName:'Sierra Lakes Produce',ownerName:'Morgan Hayes',names:{learner:'Riley Morgan',reviewer:'Sam Taylor'},outboundService: async request => {
    if (request.url !== 'https://api.openai.com/v1/responses') return null
    attempts++
    if (mode === 'deny') return Response.json({ error: 'synthetic-beam-2' }, { status: 403 })
    if (mode === 'hold') {
      entered()
      await new Promise(resolve => { release = resolve })
      throw new Error('synthetic-beam-3: provider outcome unavailable')
    }
    return edge.outboundService(request)
  } })
  const { api, h, ids, request, cookies } = f
  const screens = async label => { if(process.env.BEAM_TUTOR_BROWSER==='1') await tutorBrowser(f,[[`${label}-account`,'owner','/app/model-account','AI preparation account'],[`${label}-costs`,'owner','/app/business','Business settings'],[`${label}-policy`,'owner','/app/automation','Automation']]) }
  try {
    const source = await api('author', 'source.create', { title: 'Owned tool procedure', reviewer: ids.reviewer,
      licence: 'owned', licenceEvidence: 'Employer authored', provenance: 'Synthetic qualification',
      file: file('synthetic-beam-1.txt', 'Use clean tools. Set dirty tools aside.') })
    const estimate = (await api('owner', 'model-account')).estimateCents
    await api('owner', 'model.configure', { operation: 'enable', apiKey: 'synthetic-beam-1', maxCostCents: estimate, consent: true })
    const policy = async ceiling => api('owner', 'automation.policy', {
      ...(await api('owner', 'automation-controls')).policy, dailySpendLimitCents: ceiling,
    })
    const preview = async name => {
      const course = await api('author', 'course.create', { title: name, reviewer: ids.reviewer })
      return { ...(await api('owner', `courses/${course.id}/model-preview?inputs=${source.versionId}`)), course: course.id, consent: true }
    }
    const run = body => request('/api/beam/course.model.run', { role: 'owner', body })
    const held = await preview('Zero ceiling qualification')
    const initial = await api('owner', 'costs')
    assert.equal(initial.ceilingCents, 0)
    assert.equal(held.budget.estimatedReservedCents, 0)
    assert.equal((await run(held)).data.error, 'model_daily_budget_exceeded')
    assert.equal(attempts, 0, 'an enabled account never overrides the zero installation ceiling')
    assert.equal((await api('owner', 'model-account')).requests, 0)
    await screens('zero-budget')

    const competing = await preview('Concurrent qualification')
    await policy(estimate * 2 - 1)
    const raced = await Promise.all([run(held), run(competing)])
    assert.deepEqual(raced.map(row => row.status).sort(), [200, 409])
    assert.equal(attempts, 1, 'different approvals cannot both spend the same remaining reservation')
    const used = raced[0].status === 200 ? held : competing, unused = used === held ? competing : held
    assert.equal((await run(used)).status, 409, 'a consumed approval cannot be reused')
    assert.equal((await run(unused)).data.error, 'model_daily_budget_exceeded')
    assert.equal(attempts, 1)
    assert.equal((await api('owner', 'costs')).estimatedReservedCents, estimate)

    await policy(estimate * 2)
    mode = 'deny'
    assert.equal((await run(unused)).status, 502, 'a blocked approval can reserve after the owner raises the ceiling')
    assert.equal((await run(unused)).status, 409)
    let costs = await api('owner', 'costs')
    assert.equal(costs.estimatedReservedCents, estimate * 2, 'provider rejection retains its full reservation')
    assert.equal(costs.model.unknownBillingRequests, 1)
    assert.equal(costs.model.unknownBillingReservedCents, estimate)
    assert.equal(attempts, 2, 'provider refusal has no automatic or approval-reuse retry')

    await policy(estimate * 3)
    const uncertain = await preview('Unknown outcome qualification'), excess = await preview('Exhausted qualification')
    const arrived = new Promise(resolve => { entered = resolve })
    mode = 'hold'
    const pending = run(uncertain)
    await arrived
    costs = await api('owner', 'costs')
    assert.equal(costs.estimatedReservedCents, estimate * 3, 'an outstanding provider call is already reserved')
    assert.equal(costs.model.unknownBillingRequests, 2)
    assert.equal(costs.model.unknownBillingReservedCents, estimate * 2)
    assert.ok((await api('owner', 'model-account')).runs.some(row => row.state === 'running'))
    assert.equal((await run(uncertain)).status, 409)
    assert.equal((await run(excess)).data.error, 'model_daily_budget_exceeded')
    release(); release = null
    assert.equal((await pending).status, 502)
    assert.equal((await run(uncertain)).status, 409)
    assert.equal(attempts, 3, 'unknown provider outcomes cannot automatically resend')
    assert.equal((await api('owner', 'costs')).estimatedReservedCents, estimate * 3)
    const expired = { ...excess, approval: await expiredApproval(excess.approval, h.vars.SESSION_SECRET) }
    assert.equal((await run(expired)).data.error, 'model_approval_expired')
    assert.equal(attempts, 3, 'expiry is checked before the paid door')

    // A real renewal creates consented paid mail, which must share the model cap.
    const c = await f.course('Renewal budget qualification')
    const path = (await api('owner', 'path.create', { name: 'Renewal qualification', team: ids.team })).id
    await api('owner', 'path.revise', { path, courses: [c.id], dueDays: ['14'], renewalDays: ['1'] })
    const assignment = (await api('owner', 'path.assign', { path })).created[0]
    await f.lessons(assignment)
    const rule = (await api('owner', 'renewal.save', { course: c.id, basis: 'expiry', leadDays: 2, graceDays: 0 })).id
    await api('owner', 'renewal.preview', { rule })
    await api('owner', 'renewal.state', { rule, state: 'active' })
    const renewal = (await api('owner', 'renewals')).rules.find(row => row.id === rule)
    await api('owner', 'renewal.notice-consent', { rule, version: renewal.notice_version, enabled: true, consent: true, costCents: estimate })
    const mailBefore = h.edge.attempts.length
    assert.equal((await h.scheduled()).outcome, 'ok')
    const notices = (await api('owner', 'renewals')).notices.filter(row => row.rule_id === rule)
    assert.ok(notices.length > 0)
    assert.ok(notices.every(row => row.outcome === 'spend_limited'), 'retained model reservations also block paid automation')
    assert.equal(h.edge.attempts.length, mailBefore)
    const notice = notices.find(row => row.route === 'learner')
    await policy(estimate * 4)
    mode = 'success'
    const contenders = await Promise.all([run(excess), api('owner', 'renewal.notice-replay', { notice: notice.id })])
    assert.equal((attempts - 3) + (h.edge.attempts.length - mailBefore), 1, 'model and automation writes atomically share the last reservation')
    assert.ok(contenders[0].status === 200 || contenders[1].outcome === 'mail_accepted')
    costs = await api('owner', 'costs')
    assert.equal(costs.estimatedReservedCents, estimate * 4)
    assert.equal((await api('owner', 'automation-controls')).budget.estimatedReservedCents, costs.estimatedReservedCents)
    assert.equal(costs.estimatedRemainingCents, 0)
    assert.equal(costs.model.invoice, false)
    await screens('exhausted-budget')
    const beforeReads = attempts
    for (const page of ['/app/model-account', '/app/business']) {
      const response = await h.raw(page, { cookie: cookies.owner })
      assert.equal(response.status, 200)
      await response.body?.cancel()
    }
    assert.equal(attempts, beforeReads, 'opening account settings never makes a paid request')
    const paidAudit = (await api('owner', 'audit?q=model.approve')).events.filter(row => row.action === 'model.approve')
    assert.ok(paidAudit.length > 0 && paidAudit.every(row => row.detail.run && row.detail.digest && Number.isInteger(row.detail.policyVersion) && row.detail.reservationDay))
  } finally { release?.(); await h.close() }
}
