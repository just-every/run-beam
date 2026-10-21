import assert from 'node:assert/strict'
import { fixture } from './regression-fixture.mjs'

// AUTO-004: native completion evidence drives scheduled recurrence. The isolated
// installation keeps its scheduler and AUTO-008 ledger separate from other clauses.
export async function renewalCheck() {
  const f = await fixture()
  try { await renewals(f) } finally { await f.h.close() }
}

async function renewals(f) {
  const { api, h, ids, course, publish, nextRevision, view } = f
  const DAY = 86_400_000
  const date = at => new Date(at).toISOString().slice(0, 10)
  const noon = offset => Date.parse(`${date(Date.now())}T12:00:00Z`) + offset * DAY
  const tick = async () => assert.equal((await h.scheduled()).outcome, 'ok')
  const records = () => api('owner', `records/${ids.learner}`)
  const assignments = async c => (await records()).assignments.filter(row => row.course === c.id)
  const renewalView = () => api('owner', 'renewals')
  const item = async rule => (await renewalView()).rules.find(row => row.id === rule).items[0]
  const cycles = async rule => (await renewalView()).cycles.filter(row => row.rule_id === rule)
  const control = () => api('owner', 'automation-controls')
  const policy = async fields => {
    const p = (await control()).policy
    return api('owner', 'automation.policy', { version: p.version, paused: !!p.paused, quietStart: p.quietStart, quietEnd: p.quietEnd, dailyLimit: p.dailyLimit, ...fields })
  }
  const replay = rule => api('owner', 'renewal.replay', { rule })
  const complete = async assignment => {
    await f.lessons(assignment)
    return (await view(assignment)).completion
  }
  const certificate = completion => api('owner', `certificates/${completion.certificate}`)
  // Move only the evidence's clock to emulate elapsed days, keeping the issued
  // certificate's expiry on the same clock. All enrollment and completion writes
  // and all assertions use HTTP; these updates never fabricate learning evidence.
  const moveClock = async (completion, completedAt, expiresAt) => {
    await h.db.batch([
      h.db.prepare('UPDATE beam_completions SET completed_at=?, expires_at=? WHERE id=?').bind(completedAt, expiresAt, completion.id),
      h.db.prepare('UPDATE beam_certificates SET expires_at=? WHERE completion_id=?').bind(expiresAt, completion.id),
    ])
  }

  const prerequisite = await course('Renewal entry procedure'), c = await course('Scheduled native renewal')
  await complete(await f.assign(prerequisite))
  const path = (await api('owner', 'path.create', { name: 'Native recurring path', team: ids.team })).id
  const requirements = { path, courses: [prerequisite.id, c.id], prerequisites: ['', prerequisite.id], dueDays: ['14', '14'], renewalDays: ['', '7'] }
  const origin = (await api('owner', 'path.revise', requirements)).id
  await api('owner', 'path.assign', { path })
  const initial = (await assignments(c)).find(row => row.status === 'open').id
  const first = await complete(initial)
  assert.equal((await certificate(first)).expiresAt - (await certificate(first)).completedAt, 7 * DAY)

  // Every renewal door is owner-only, including the read and explicit replay.
  const fields = { course: c.id, basis: 'expiry', leadDays: 2, graceDays: 3 }
  await api('manager', 'renewal.save', fields, 403)
  const rule = (await api('owner', 'renewal.save', fields)).id
  await api('manager', 'renewals', undefined, 403)
  for (const [action, body] of [['renewal.preview', { rule }], ['renewal.state', { rule, state: 'active' }], ['renewal.replay', { rule }]]) await api('manager', action, body, 403)
  assert.equal((await api('owner', 'renewal.state', { rule, state: 'active' }, 409)).error, 'dry_run_required')
  const preview = await api('owner', 'renewal.preview', { rule })
  assert.deepEqual(preview.items.map(row => [row.completion, row.outcome]), [[first.id, 'not_due']])
  await tick()
  assert.equal((await assignments(c)).length, 1)
  await api('owner', 'renewal.state', { rule, state: 'active' })
  await tick()
  assert.equal((await assignments(c)).length, 1, 'active rules never enroll before the lead window')

  // Publication and a path edit happen after the original completion. Renewal
  // uses the current course, while retaining that completion's path and interval.
  const currentRevision = await nextRevision(c)
  await publish(currentRevision, { reassignment: 'none' })
  await api('owner', 'path.revise', { ...requirements, prerequisites: ['', ''], renewalDays: ['', '90'] })
  const firstExpiry = noon(2)
  await moveClock(first, firstExpiry - 7 * DAY, firstExpiry)
  let firstCertificate = await certificate(first)
  const threshold = await item(rule)
  assert.deepEqual([threshold.opensOn, threshold.coverage, threshold.outcome], [date(Date.now()), 'current', 'would_assign'])
  assert.equal(threshold.dueDate, date(firstExpiry + 3 * DAY))
  await tick()
  let history = await cycles(rule)
  assert.equal(history.length, 1)
  const secondAssignment = history[0].assignment_id
  const secondView = await view(secondAssignment)
  assert.deepEqual([secondView.assignment.revision, secondView.assignment.pathRevision, secondView.prerequisite, secondView.assignment.dueDate], [currentRevision, origin, prerequisite.id, threshold.dueDate])
  assert.deepEqual([history[0].completion_id, history[0].expires_at, history[0].due_date, history[0].timezone], [first.id, firstExpiry, threshold.dueDate, 'UTC'])
  await tick()
  await replay(rule)
  await replay(rule)
  assert.equal((await assignments(c)).length, 2)
  assert.equal((await cycles(rule)).length, 1)
  assert.deepEqual(await certificate(first), firstCertificate)

  const second = await complete(secondAssignment)
  const issuedSecond = await certificate(second)
  assert.equal(issuedSecond.expiresAt - issuedSecond.completedAt, 7 * DAY, 'the edited path does not replace the original renewal interval')
  // Expiry has a separate grace state. A late scheduler keeps the expiry-based
  // deadline in the past rather than granting fresh days from its run date.
  const inGrace = noon(-1)
  // Advance earlier evidence by the same elapsed time so the newest completion
  // stays newest. Each clock movement precedes the HTTP snapshot being protected.
  let elapsed = second.completedAt - (inGrace - 7 * DAY)
  await moveClock(first, firstCertificate.completedAt - elapsed, firstCertificate.expiresAt - elapsed)
  await moveClock(second, inGrace - 7 * DAY, inGrace)
  assert.deepEqual([(await item(rule)).coverage, (await item(rule)).dueDate], ['expired_in_grace', date(inGrace + 3 * DAY)])
  const lateExpiry = noon(-5)
  firstCertificate = await certificate(first)
  elapsed = inGrace - lateExpiry
  await moveClock(first, firstCertificate.completedAt - elapsed, firstCertificate.expiresAt - elapsed)
  await moveClock(second, lateExpiry - 7 * DAY, lateExpiry)
  firstCertificate = await certificate(first)
  const secondCertificate = await certificate(second)
  const overdue = await item(rule)
  assert.deepEqual([overdue.coverage, overdue.dueDate], ['overdue', date(lateExpiry + 3 * DAY)])
  await tick()
  history = await cycles(rule)
  assert.equal(history.length, 2, 'two successive native completions each create one scheduled cycle')
  const late = history.find(row => row.completion_id === second.id)
  const lateView = await view(late.assignment_id)
  assert.deepEqual([lateView.assignment.revision, lateView.assignment.pathRevision, lateView.prerequisite, lateView.assignment.dueDate], [currentRevision, origin, prerequisite.id, overdue.dueDate])
  const lateRecord = (await assignments(c)).find(row => row.id === late.assignment_id)
  assert.equal(lateRecord.state, 'overdue')
  await tick()
  await replay(rule)
  assert.equal((await assignments(c)).length, 3)
  assert.equal((await cycles(rule)).length, 2)
  assert.deepEqual(await certificate(first), firstCertificate)
  assert.deepEqual(await certificate(second), secondCertificate)
  assert.equal((await view(initial)).completion.id, first.id)
  assert.equal((await view(secondAssignment)).completion.id, second.id)
  await api('owner', 'renewal.state', { rule, state: 'paused' })

  // Annual recurrence is 365 elapsed days, even when the native completion has
  // no expiry. The original certificate remains without an expiry throughout.
  const annual = await course('Annual native refresher')
  const annualCompletion = await complete(await f.assign(annual))
  assert.equal((await certificate(annualCompletion)).expiresAt, null)
  const annualRule = (await api('owner', 'renewal.save', { course: annual.id, basis: 'annual', leadDays: 2, graceDays: 3 })).id
  await moveClock(annualCompletion, noon(3) - 365 * DAY, null)
  assert.equal((await api('owner', 'renewal.preview', { rule: annualRule })).items[0].outcome, 'not_due')
  await api('owner', 'renewal.state', { rule: annualRule, state: 'active' })
  await tick()
  assert.equal((await assignments(annual)).length, 1)
  const annualCompletedAt = noon(2) - 365 * DAY
  await moveClock(annualCompletion, annualCompletedAt, null)
  const annualCertificate = await certificate(annualCompletion)
  const anniversary = await item(annualRule)
  assert.deepEqual([anniversary.expiresAt, anniversary.opensOn, anniversary.dueDate], [annualCompletedAt + 365 * DAY, date(Date.now()), date(annualCompletedAt + 368 * DAY)])
  await tick()
  assert.equal((await assignments(annual)).length, 2)
  const [annualCycle] = await cycles(annualRule)
  assert.equal(annualCycle.expires_at, annualCompletedAt + 365 * DAY)
  assert.deepEqual(await certificate(annualCompletion), annualCertificate)

  // One more real completion exercises rule pause, global pause, quiet hours,
  // the rate limit and current-policy approval on the same held event.
  const controlledCompletion = await complete(annualCycle.assignment_id)
  // The older annual evidence advances by the same amount as the new source.
  const annualElapsed = controlledCompletion.completedAt - (noon(2) - 365 * DAY)
  await moveClock(annualCompletion, annualCompletedAt - annualElapsed, null)
  await moveClock(controlledCompletion, noon(2) - 365 * DAY, null)
  const priorAnnualCertificate = await certificate(annualCompletion)
  await api('owner', 'renewal.state', { rule: annualRule, state: 'paused' })
  await tick()
  assert.equal((await assignments(annual)).length, 2)
  await api('owner', 'renewal.replay', { rule: annualRule }, 409)
  await api('owner', 'renewal.state', { rule: annualRule, state: 'active' })
  await policy({ paused: true })
  await tick()
  const executionFor = async () => (await control()).executions.find(row => row.kind === 'renewal' && row.rule_id === annualRule && row.event_key === controlledCompletion.id)
  let execution = await executionFor()
  assert.equal(execution.outcome, 'paused')
  await policy({ paused: false })
  await tick()
  assert.equal((await executionFor()).outcome, 'paused', 'scheduled ticks never retry a held event')
  assert.equal((await assignments(annual)).length, 2)
  const hour = new Date().getUTCHours()
  await policy({ quietStart: hour, quietEnd: (hour + 1) % 24 })
  assert.equal((await replay(annualRule)).results[0].outcome, 'quiet_hours')
  await policy({ quietStart: 0, quietEnd: 0, dailyLimit: 0 })
  assert.equal((await replay(annualRule)).results[0].outcome, 'rate_limited')
  await policy({ dailyLimit: 100 })
  await api('owner', 'automation.policy', { version: (await control()).policy.version, kind: 'renewal', rule: annualRule, mode: 'approval' })
  assert.equal((await replay(annualRule)).results[0].outcome, 'approval_required')
  execution = await executionFor()
  await api('owner', 'automation.approve', { execution: execution.id, version: (await control()).policy.version })
  await policy({ dailyLimit: 101 })
  assert.equal((await replay(annualRule)).results[0].outcome, 'approval_required', 'policy changes invalidate the previous approval')
  assert.equal((await assignments(annual)).length, 2)
  await api('owner', 'automation.approve', { execution: execution.id, version: (await control()).policy.version })
  assert.equal((await replay(annualRule)).results[0].outcome, 'assigned')
  await tick()
  await replay(annualRule)
  assert.equal((await assignments(annual)).length, 3)
  assert.equal((await cycles(annualRule)).length, 2)
  const finalControl = await control()
  assert.equal(finalControl.executions.filter(row => row.kind === 'renewal' && row.event_key === controlledCompletion.id).length, 1)
  const attempts = finalControl.attempts.filter(row => row.execution_id === execution.id)
  assert.ok(['paused', 'quiet_hours', 'rate_limited', 'approval_required', 'assigned'].every(outcome => attempts.some(row => row.outcome === outcome)))
  assert.equal(attempts.filter(row => row.charged).length, 1)
  assert.deepEqual(await certificate(annualCompletion), priorAnnualCertificate)
}
