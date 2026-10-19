import assert from 'node:assert/strict'

// AUTO-006: a learner reports leave against an overdue course; the manager defers it within the owner's policy and the
// record reads deferred with its original deadline until the deferral ends, then overdue again; exemptions follow the
// policy; unauthorized exceptions and a backdated attendance are refused; every report and exception stays on record.
export async function exceptionsCheck(f) {
  const { api, h, cookies, ids, course } = f
  const page = async (path, role) => { const response = await h.raw(path, { cookie: cookies[role] }); return { status: response.status, text: await response.text() } }
  const day = offset => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
  const error = async (action, role, fields, returnTo) => (await h.submit(action, cookies[role], fields, returnTo)).searchParams.get('error')
  ids.outsider = (await api('owner', 'person.invite', { email: 'outsider@example.test', name: 'Outside Manager', roles: ['manager'] })).id
  cookies.outsider = await h.signIn('outsider@example.test', { requested: true })
  const other = (await api('owner', 'team.create', { name: 'Other floor' })).id
  await api('owner', 'team.managers', { team: other, members: [ids.outsider] })

  const lockout = await course('Lockout refresher'), ladders = await course('Ladder safety')
  const overdue = c => api('manager', 'assignment.create', { course: c.id, learners: [ids.learner], dueDate: '2026-01-05', dueTime: '17:00', timezone: 'UTC' }).then(result => result.created[0])
  const a = await overdue(lockout), b = await overdue(ladders)
  const row = async id => (await api('manager', 'report')).rows.find(item => item.assignment === id)
  const original = (await row(a)).dueAt
  assert.equal((await row(a)).status, 'overdue')

  // The learner reports leave on their own overdue assignment through the form; a second open report and someone
  // else's report on it are refused.
  assert.ok((await page(`/app/learn/${a}`, 'learner')).text.includes('Report a blocker'))
  assert.equal(await error('blocker.report', 'learner', { assignment: a, kind: 'leave', note: 'Medical leave until next week' }, `/app/learn/${a}`), null)
  assert.equal((await api('learner', 'blocker.report', { assignment: a, kind: 'other', note: 'Again' }, 409)).error, 'blocker_already_reported')
  await api('manager', 'blocker.report', { assignment: a, kind: 'leave', note: 'Not theirs' }, 404)
  const blocker = (await api('manager', 'queues')).blockers.find(item => item.assignment === a)
  assert.deepEqual([blocker.kind, blocker.note, blocker.learner], ['leave', 'Medical leave until next week', ids.learner])
  assert.ok((await page('/app/manage', 'manager')).text.includes('Blocker: Leave or time off'))
  assert.ok(!(await api('outsider', 'queues')).blockers.length)

  // Only within policy: the learner, a manager of another team, an end past the policy's limit or already passed, and a
  // manager's exemption once the owner's policy says managers may not exempt, are each refused.
  assert.equal((await api('learner', 'exception.grant', { assignment: a, kind: 'deferral', endsOn: day(7), reason: 'Self' }, 403)).error, 'forbidden')
  assert.equal((await api('outsider', 'exception.grant', { assignment: a, kind: 'exemption', endsOn: day(7), reason: 'Not mine' }, 403)).error, 'learner_outside_your_team')
  assert.equal(await error('exception.policy', 'manager', { maxDeferralDays: '30', maxExemptionDays: '365' }, '/app/business'), 'owner_required')
  assert.ok((await page('/app/business', 'owner')).text.includes('Deferrals and exemptions'))
  assert.equal(await error('exception.policy', 'owner', { maxDeferralDays: '30', maxExemptionDays: '365' }, '/app/business'), null)
  assert.equal((await api('manager', 'exception.grant', { assignment: a, kind: 'exemption', endsOn: day(7), reason: 'Waive it' }, 403)).error, 'exemption_not_allowed')
  assert.equal((await api('manager', 'exception.grant', { assignment: a, kind: 'deferral', endsOn: day(31), reason: 'Too long' }, 400)).error, 'exception_too_long')
  assert.equal((await api('manager', 'exception.grant', { assignment: a, kind: 'deferral', endsOn: day(-1), reason: 'Past' }, 400)).error, 'exception_ends_in_past')

  // The manager approves a temporary deferral against the blocker from the assignment page.
  assert.ok((await page(`/app/learn/${a}`, 'manager')).text.includes('Grant the exception'))
  assert.equal(await error('exception.grant', 'manager', { assignment: a, blocker: blocker.id, kind: 'deferral', endsOn: day(7), reason: 'Approved medical leave' }, `/app/learn/${a}`), null)
  assert.equal((await api('manager', 'exception.grant', { assignment: a, kind: 'deferral', endsOn: day(9), reason: 'Again' }, 409)).error, 'exception_active')
  const deferred = await row(a)
  assert.deepEqual([deferred.status, deferred.dueAt, deferred.originalDueAt, deferred.exception.kind, deferred.exception.endsOn, deferred.exception.active], ['deferred', original, original, 'deferral', day(7), true])
  assert.ok((await api('manager', 'report?status=deferred')).rows.some(item => item.assignment === a))
  assert.ok(!(await api('manager', 'queues')).overdue.some(item => item.id === a))
  assert.ok(!(await api('learner', 'reminders')).some(item => item.id === a))
  const view = await api('learner', `assignments/${a}`)
  assert.deepEqual([view.assignment.dueAt, view.blockers[0].state, view.exceptions[0].reason], [original, 'granted', 'Approved medical leave'])
  assert.match((await page(`/app/learn/${a}`, 'learner')).text, /Deferred through .*Approved medical leave/)
  assert.ok((await page('/app/manage', 'manager')).text.includes('Deferred through'))
  const csv = (await page('/app/reports.csv', 'manager')).text
  assert.ok(csv.includes('Original due (UTC)') && csv.split('\r\n').some(line => line.includes('Lockout refresher') && line.includes(',deferred,') && line.includes('Approved medical leave')))

  // The deferral ends: the queue and reminders take it back with the original deadline, and the deferral stays listed.
  await h.db.prepare('UPDATE beam_exceptions SET ends_at = ? WHERE assignment_id = ?').bind(Date.now() - 1000, a).run()
  const restored = await row(a)
  assert.deepEqual([restored.status, restored.dueAt, restored.exception.kind, restored.exception.active], ['overdue', original, 'deferral', false])
  assert.ok((await api('manager', 'queues')).overdue.some(item => item.id === a))
  assert.ok((await api('learner', 'reminders')).some(item => item.id === a && item.kind === 'overdue'))
  assert.ok((await page('/app/reports.csv', 'manager')).text.includes('deferral (ended)'))
  assert.ok((await page(`/app/learn/${a}`, 'learner')).text.includes('(ended)'))

  // The owner (acting as administrator) exempts the other course despite the managers' policy; a reported content
  // blocker on it is declined with a reason and nothing else changes.
  await api('learner', 'blocker.report', { assignment: b, kind: 'content', note: 'Step 3 shows the wrong ladder' })
  const contentBlocker = (await api('learner', `assignments/${b}`)).blockers[0]
  await api('outsider', 'blocker.decline', { blocker: contentBlocker.id, reason: 'Not mine' }, 403)
  await api('manager', 'blocker.decline', { blocker: contentBlocker.id, reason: 'The reviewer checked step 3: it is right' })
  await api('owner', 'exception.grant', { assignment: b, kind: 'exemption', endsOn: day(200), reason: 'Works at ground level only this season' })
  const exempt = await row(b)
  assert.deepEqual([exempt.status, exempt.assignmentStatus, exempt.exception.by], ['exempt', 'open', 'Owner'])
  assert.deepEqual((await api('learner', `assignments/${b}`)).blockers.map(item => [item.state, item.decisionReason]), [['declined', 'The reviewer checked step 3: it is right']])

  // No backdating: attendance dated before the due date of an assignment already overdue is refused and closes nothing;
  // attendance dated today closes it, completed late against the deadline it kept.
  const attendance = { course: lockout.id, revision: lockout.revision, learners: [ids.learner], instructor: 'Trainer', location: 'Shop floor', attestation: 'Observed the lockout.' }
  assert.equal((await api('manager', 'offline.record', { ...attendance, heldOn: '2026-01-02' }, 409)).error, 'backdated_completion')
  assert.equal((await row(a)).status, 'overdue')
  await api('manager', 'offline.record', { ...attendance, heldOn: day(0) })
  const done = await row(a)
  assert.ok(done.status === 'completed' && done.completedAt > done.dueAt && done.dueAt === original)

  // Reassigning is a reasoned cancellation, kept as cancelled, plus a new assignment with its own due date.
  await api('manager', 'assignment.cancel', { assignment: b, reason: 'Moved to the ground crew course' })
  const [again] = (await api('manager', 'assignment.create', { course: ladders.id, learners: [ids.learner], dueDate: day(30), timezone: 'UTC' })).created
  assert.deepEqual([(await row(b)).status, (await row(again)).status], ['cancelled', 'open'])

  const audit = (await h.db.prepare("SELECT action FROM beam_audit WHERE (action LIKE 'blocker.%' OR action LIKE 'exception.%') ORDER BY id").all()).results.map(item => item.action)
  assert.deepEqual(audit, ['blocker.report', 'exception.policy', 'exception.deferral', 'blocker.report', 'blocker.decline', 'exception.exemption'])
}
