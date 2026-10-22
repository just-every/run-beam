import assert from 'node:assert/strict'
import { fixture } from './regression-fixture.mjs'

// Folded into AUTO-004's existing registration. Only the mail network boundary
// is faked; consent, real completions, scheduler, approvals and replay use HTTP.
export async function renewalNoticeCheck() {
  let uncertain = false
  const f = await fixture({ outboundService: async (request, { edge }) => {
    if (uncertain && request.url === 'https://api.resend.com/emails') {
      edge.attempts.push(await request.json())
      return Response.json({ message: 'synthetic-beam-1' }, { status: 503 })
    }
  } })
  const { api, h, cookies, ids } = f
  try {
    const c = await f.course('Notice renewal')
    const path = (await api('owner', 'path.create', { name: 'Notice renewal path', team: ids.team })).id
    await api('owner', 'path.revise', { path, courses: [c.id], dueDays: ['14'], renewalDays: ['1'] })
    const initial = (await api('owner', 'path.assign', { path })).created[0]
    const complete = async id => { await f.lessons(id); return (await f.view(id)).completion }
    const original = await complete(initial)
    const certificate = await api('owner', `certificates/${original.certificate}`)
    const rule = (await api('owner', 'renewal.save', { course: c.id, basis: 'expiry', leadDays: 2, graceDays: 0 })).id
    await api('owner', 'renewal.preview', { rule })
    await api('owner', 'renewal.state', { rule, state: 'active' })
    const read = () => api('owner', 'renewals')
    const tick = async () => assert.equal((await h.scheduled()).outcome, 'ok')
    const count = () => h.edge.attempts.length
    const controls = () => api('owner', 'automation-controls')
    const policy = async changes => api('owner', 'automation.policy', {
      version: (await controls()).policy.version, paused: false, quietStart: 0, quietEnd: 0, dailyLimit: 1000, ...changes,
    })
    const replay = notice => api('owner', 'renewal.notice-replay', { notice: notice.id })
    const notice = async id => (await read()).notices.find(row => row.id === id)
    const cycleFor = async completion => (await read()).cycles.find(row => row.completion_id === completion.id)
    const noticesFor = async assignment => (await read()).notices.filter(row => row.assignment_id === assignment)
    const executionFor = async n => (await controls()).executions.find(row => row.event_key === `notice:${n.id}`)
    const approve = async n => api('owner', 'automation.approve', { execution: (await executionFor(n)).id, version: (await controls()).policy.version })

    await policy({ dailySpendLimitCents: 100 })
    const beforeLegacy = count()
    await tick()
    const legacy = await cycleFor(original)
    assert.ok(legacy?.assignment_id, 'legacy rules still create real assignments')
    assert.equal(count(), beforeLegacy, 'legacy rules do not gain email consent')
    assert.deepEqual((await read()).notices, [])
    const version = (await read()).rules.find(row => row.id === rule).notice_version
    const consent = { rule, version, enabled: true, consent: true, costCents: 1 }
    await api('manager', 'renewal.notice-consent', consent, 403)
    await api('owner', 'renewal.notice-consent', { ...consent, consent: false }, 409)
    const enabled = await h.submit('renewal.notice-consent', cookies.owner, { rule, version, enabled: 'true', consent: 'yes', costCents: 1 }, '/app/automation')
    assert.equal(enabled.searchParams.get('error'), null)
    await api('owner', 'renewal.notice-consent', consent, 409)
    await tick(); await api('owner', 'renewal.replay', { rule })
    assert.deepEqual((await read()).notices, [], 'consent never backfills an existing cycle')
    assert.equal(count(), beforeLegacy)

    const second = await complete(legacy.assignment_id)
    h.edge.refuse = true
    const beforeDenied = count()
    await tick()
    const cycle = await cycleFor(second), queued = await noticesFor(cycle.assignment_id)
    assert.deepEqual(queued.map(row => [row.recipient_id, row.route]).sort(), [[ids.learner, 'learner'], [ids.manager, 'manager']].sort())
    assert.ok(queued.every(row => row.state === 'failed' && row.outcome === 'mail_rejected' && row.failure))
    assert.equal(count() - beforeDenied, 2, 'one provider request per snapshotted recipient')
    const learner = queued.find(row => row.route === 'learner'), manager = queued.find(row => row.route === 'manager')
    const rejected = h.edge.attempts.slice(beforeDenied)
    assert.ok(rejected.every(mail => /paid work time/i.test(mail.text)))
    assert.ok(rejected.find(mail => mail.to.includes('learner@example.test')).text.includes(`${h.origin}/app/learn/${cycle.assignment_id}`))
    assert.ok(rejected.find(mail => mail.to.includes('manager@example.test')).text.includes(`${h.origin}/app/records/${ids.learner}`))
    assert.equal((await f.view(cycle.assignment_id)).assignment.status, 'open', 'mail denial leaves the real assignment intact')
    assert.ok((await controls()).executions.some(row => row.event_key === second.id && row.outcome === 'assigned'))
    assert.equal((await executionFor(learner)).input.externalSpendCents, 1)
    let afterDenied = count()
    await policy({ dailySpendLimitCents: 3 })
    await Promise.all([replay(learner), replay(manager)])
    assert.equal(count(), afterDenied + 1, 'different paid events share one atomic remaining USD reservation')
    assert.equal((await controls()).budget.estimatedReservedCents, 3)
    afterDenied = count()
    await policy({ dailySpendLimitCents: 100 })
    await tick(); await api('owner', 'renewal.replay', { rule })
    assert.equal(count(), afterDenied, 'failed notices have no automatic retry')
    await api('manager', 'renewal.notice-replay', { notice: learner.id }, 403)

    await policy({ paused: true })
    assert.equal((await replay(learner)).outcome, 'paused')
    const hour = new Date().getUTCHours()
    await policy({ quietStart: hour, quietEnd: (hour + 1) % 24 })
    assert.equal((await replay(learner)).outcome, 'quiet_hours')
    await policy({ dailyLimit: 0 })
    assert.equal((await replay(learner)).outcome, 'rate_limited')
    await policy({ dailySpendLimitCents: 0 })
    assert.equal((await replay(learner)).outcome, 'spend_limited')
    await policy({ dailySpendLimitCents: 100 })
    await policy({ kind: 'renewal', rule, mode: 'approval' })
    assert.equal((await replay(learner)).outcome, 'approval_required')
    await approve(learner)
    await policy({ dailyLimit: 999 })
    assert.equal((await replay(learner)).outcome, 'approval_required', 'a changed policy invalidates approval')
    await approve(learner)
    await api('learner', 'language.change', { language: 'es-US' })
    assert.equal((await replay(learner)).outcome, 'approval_required', 'the current language changes the approved mail input')
    assert.equal(count(), afterDenied, 'all control holds precede the provider call')
    await approve(learner)
    h.edge.refuse = false
    await Promise.all([replay(learner), replay(learner)])
    assert.equal(count(), afterDenied + 1, 'concurrent replays reserve one provider request')
    const accepted = await notice(learner.id)
    assert.deepEqual([accepted.state, accepted.outcome, accepted.language], ['accepted', 'mail_accepted', 'es-US'])
    assert.ok(accepted.provider_message_id && accepted.sent_at)
    const sent = h.edge.attempts.at(-1)
    assert.ok(/remunerad/i.test(sent.text), 'the mail uses the recipient’s current Spanish preference')
    assert.ok(sent.text.includes(`${h.origin}/app/learn/${cycle.assignment_id}`))
    await tick(); await replay(learner)
    assert.equal(count(), afterDenied + 1, 'accepted is terminal and never claimed as another delivery')

    await policy({ kind: 'renewal', rule, mode: 'automatic' })
    await api('owner', 'team.managers', { team: ids.team, members: [ids.other] })
    const beforeScope = count()
    await replay(manager)
    assert.deepEqual([(await notice(manager.id)).state, (await notice(manager.id)).outcome], ['suppressed', 'recipient_access_changed'])
    assert.equal(count(), beforeScope)
    assert.deepEqual((await noticesFor(cycle.assignment_id)).map(row => row.recipient_id).sort(), [ids.learner, ids.manager].sort(), 'new managers are never added to an old cycle')

    const third = await complete(cycle.assignment_id)
    uncertain = true
    const beforeUnknown = count(), beforeUnknownUsd = (await controls()).budget.estimatedReservedCents
    await tick()
    const unknownCycle = await cycleFor(third), unknown = await noticesFor(unknownCycle.assignment_id)
    assert.deepEqual(unknown.map(row => row.recipient_id).sort(), [ids.learner, ids.other].sort())
    assert.ok(unknown.every(row => row.state === 'held' && row.outcome === 'outcome_unknown' && row.failure))
    assert.equal(count() - beforeUnknown, 2, 'the new cycle attempts each 503-denied recipient once')
    const afterUnknown = count()
    assert.equal((await controls()).budget.estimatedReservedCents, beforeUnknownUsd + 2)
    await tick()
    for (const entry of unknown) assert.equal((await replay(entry)).outcome, 'outcome_unknown')
    assert.equal(count(), afterUnknown, 'uncertain provider outcomes refuse every ordinary retry')

    // Fault-inject exactly one persisted request as if its Worker died before
    // recording a provider response. These writes create no learning evidence.
    const interrupted = unknown.find(row => row.route === 'learner'), execution = await executionFor(interrupted)
    await h.db.batch([
      h.db.prepare("UPDATE beam_renewal_notices SET state='sending',outcome='reserved',send_token='synthetic-beam-1',send_started_at=?,send_expires_at=? WHERE id=?")
        .bind(Date.now(), Date.now() + 60_000, interrupted.id),
      h.db.prepare("UPDATE beam_automation_executions SET state='running',outcome='reserved',failure=NULL,updated_at=? WHERE id=?")
        .bind(Date.now(), execution.id),
    ])
    assert.equal((await notice(interrupted.id)).state, 'sending', 'a live lease stays reserved')
    await replay(interrupted)
    assert.equal(count(), afterUnknown)
    await h.db.prepare('UPDATE beam_renewal_notices SET send_expires_at=? WHERE id=?').bind(Date.now() - 1, interrupted.id).run()
    const recovered = await notice(interrupted.id)
    assert.deepEqual([recovered.state, recovered.outcome], ['held', 'outcome_unknown'])
    assert.ok(recovered.failure)
    assert.equal((await executionFor(interrupted)).outcome, 'outcome_unknown')
    await replay(interrupted); await tick()
    assert.equal(count(), afterUnknown, 'recovering an interrupted display cannot resend mail')

    assert.equal((await controls()).budget.estimatedReservedCents, beforeUnknownUsd + 2, 'unknown outcomes retain their cost reservation')
    uncertain = false
    const current = (await read()).rules.find(row => row.id === rule)
    const stopped = await h.submit('renewal.notice-consent', cookies.owner, { rule, version: current.notice_version, enabled: 'false' }, '/app/automation')
    assert.equal(stopped.searchParams.get('error'), null)
    const fourth = await complete(unknownCycle.assignment_id)
    await tick()
    const silent = await cycleFor(fourth)
    assert.equal((await f.view(silent.assignment_id)).assignment.status, 'open')
    assert.deepEqual(await noticesFor(silent.assignment_id), [])
    assert.equal(count(), afterUnknown, 'stopping email preserves renewal assignments without new provider requests')
    assert.deepEqual(await api('owner', `certificates/${original.certificate}`), certificate)
    const audit = JSON.stringify(await api('owner', 'audit?q=renewal'))
    assert.ok(audit.includes('renewal.notice-consent') && audit.includes('renewal.notice-mail') && audit.includes('renewal.notice-interrupted'))
    if (process.env.BEAM_RENEWAL_BROWSER === '1') {
      const { renewalBrowser } = await import('./regression-credit-renewals.mjs')
      await renewalBrowser(f, { course: 'Notice renewal', notices: true })
    }
    const lastRule = (await read()).rules.find(row => row.id === rule)
    await api('owner', 'renewal.notice-consent', { rule, version: lastRule.notice_version, enabled: true, consent: true, costCents: 1 })
    await complete(silent.assignment_id)
    h.edge.refuse = true; await tick()
    const { renewalNoticeArchiveCheck } = await import('./regression-archive.mjs')
    await renewalNoticeArchiveCheck(f, rule)
  } finally { await h.close() }
}
