import assert from 'node:assert/strict'

// AUTO-005: through Automation the owner saves completion, exhausted-attempt and enrollment (signup) branches; a draft
// runs nothing until its write-free dry run; then a failure assigns remedial work without becoming a pass, a completion
// assigns the next course and its enrollment chains on, conditions hold, replays and repeated events create no
// repeated work, a cycle is refused and a paused rule stops.
export async function automationCheck(f) {
  const { api, h, cookies, ids, course, publish } = f
  // The fixture's assessor is also a learner; Gus never signs in (sign-ins are rate limited).
  ids.gus = (await api('owner', 'person.invite', { email: 'gus@example.test', name: 'Gus Example', roles: ['learner'] })).id
  const c = await api('author', 'course.create', { title: 'Forklift induction', reviewer: ids.reviewer })
  let draftVersion = c.draftVersion
  const edit = async (action, fields) => { draftVersion = (await api('author', action, { course: c.id, draftVersion, ...fields })).draftVersion }
  await edit('course.lesson', { title: 'Checks', body: 'Check the forks.', sources: [] })
  await edit('course.question', { prompt: 'First check?', choices: 'Forks\nRadio', correct: '1' })
  await edit('course.assessment', { passPercent: 100, maxAttempts: 1 })
  const induction = { id: c.id, revision: (await api('author', 'course.submit', { course: c.id, draftVersion })).id }
  await publish(induction.revision)
  const next = await course('Forklift on the dock'), remedial = await course('Forklift checks again'), handbook = await course('Dock handbook')
  const assignments = async (learner, courseId) => (await api('owner', `records/${learner}`)).assignments.filter(row => row.course === courseId)
  const take = async (role, answer) => {
    const [assignment] = (await api('owner', 'assignment.create', { course: induction.id, learners: [ids[role]], dueDate: '2030-10-01' })).created
    const view = await api(role, `assignments/${assignment}`)
    for (const lesson of view.lessons) await api(role, 'lesson.complete', { assignment, lesson: lesson.id })
    return { assignment, result: await api(role, 'quiz.submit', { assignment, [`q_${view.quiz.questions[0].id}`]: [answer] }) }
  }
  const save = async fields => (await h.submit('automation.save', cookies.owner, fields, '/app/automation')).searchParams.get('error')

  // Only an administrator saves rules; a draft runs nothing and cannot be enabled before its dry run.
  await api('manager', 'automation.save', { name: 'Mine', trigger: 'completion', sourceCourse: induction.id, targetCourse: next.id, dueDays: 7 }, 403)
  assert.equal(await save({ name: 'Dock after induction', trigger: 'completion', sourceCourse: induction.id, targetCourse: next.id, dueDays: '7', minPercent: '100' }), null)
  assert.equal(await save({ name: 'Checks again after a fail', trigger: 'failure', sourceCourse: induction.id, targetCourse: remedial.id, dueDays: '3' }), null)
  assert.equal(await save({ name: 'Handbook with the dock', trigger: 'enrollment', sourceCourse: next.id, targetCourse: handbook.id, dueDays: '14' }), null)
  assert.equal((await api('owner', 'automation.save', { name: 'Fail on a pass', trigger: 'failure', sourceCourse: induction.id, targetCourse: remedial.id, dueDays: 3, minPercent: 50 }, 400)).error, 'score_condition_needs_completion')
  // A cycle is refused: handbook back to induction would close induction -> dock -> handbook -> induction.
  assert.equal((await api('owner', 'automation.save', { name: 'Loop', trigger: 'completion', sourceCourse: handbook.id, targetCourse: induction.id, dueDays: 7 }, 409)).error, 'rule_cycle')
  assert.equal((await api('owner', 'automation.save', { name: 'Self', trigger: 'completion', sourceCourse: next.id, targetCourse: next.id, dueDays: 7 }, 409)).error, 'rule_cycle')
  const rules = Object.fromEntries((await api('owner', 'automation')).rules.map(rule => [rule.trigger, rule]))
  assert.equal((await api('owner', 'automation.state', { rule: rules.failure.id, state: 'active' }, 409)).error, 'dry_run_required')

  // The learner fails while the rule is a draft: nothing is assigned. The dry run shows what it would do and writes nothing.
  const failed = await take('learner', '1')
  assert.equal(failed.result.passed, false)
  assert.equal((await assignments(ids.learner, remedial.id)).length, 0)
  const dry = await api('owner', 'automation.preview', { rule: rules.failure.id })
  assert.deepEqual([dry.counts.would_assign, dry.items[0].learner, dry.items[0].assignment], [1, ids.learner, failed.assignment])
  assert.equal((await assignments(ids.learner, remedial.id)).length, 0)
  for (const trigger of ['completion', 'enrollment']) assert.equal((await h.submit('automation.preview', cookies.owner, { rule: rules[trigger].id }, '/app/automation')).searchParams.get('error'), null)
  for (const trigger of ['failure', 'completion', 'enrollment']) assert.equal((await h.submit('automation.state', cookies.owner, { rule: rules[trigger].id, state: 'active' }, '/app/automation')).searchParams.get('error'), null)

  // Replaying the failure branch assigns the remedial course once; a second replay does nothing; the failure stays one.
  assert.deepEqual((await api('owner', 'automation.replay', { rule: rules.failure.id })).results, { assigned: 1 })
  assert.deepEqual((await api('owner', 'automation.replay', { rule: rules.failure.id })).results, { already_ran: 1 })
  const [remedialRow] = await assignments(ids.learner, remedial.id)
  assert.equal((await assignments(ids.learner, remedial.id)).length, 1)
  assert.ok(remedialRow.status === 'open' && remedialRow.reason === `rule ${rules.failure.id}`)
  const source = await api('learner', `assignments/${failed.assignment}`)
  assert.deepEqual([source.assignment.status, source.completion, source.quiz.passed, source.quiz.attemptsLeft], ['open', null, false, 0])

  // A live completion at 100% assigns the dock course due in 7 days, whose enrollment chains on to the handbook.
  const passed = await take('assessor', '0')
  assert.ok(passed.result.passed && passed.result.completion)
  const [dock] = await assignments(ids.assessor, next.id)
  const [book] = await assignments(ids.assessor, handbook.id)
  assert.ok(dock?.status === 'open' && book?.status === 'open' && dock.reason === `rule ${rules.completion.id}`)
  assert.equal(dock.dueDate, new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10))
  assert.equal((await assignments(ids.assessor, remedial.id)).length, 0)
  // Repeated events: replaying completion and enrollment rules adds nothing.
  assert.deepEqual((await api('owner', 'automation.replay', { rule: rules.completion.id })).results, { already_ran: 1 })
  await api('owner', 'automation.replay', { rule: rules.enrollment.id })
  assert.equal((await assignments(ids.assessor, handbook.id)).length, 1)

  // The score condition: attested offline attendance has no quiz score, so the completion branch does not run.
  await api('owner', 'offline.record', { course: induction.id, revision: induction.revision, learners: [ids.gus], heldOn: new Date().toISOString().slice(0, 10), instructor: 'Trainer', location: 'Dock', attestation: 'Observed.' })
  assert.equal((await assignments(ids.gus, next.id)).length, 0)
  // A paused rule stops: enrolling Gus in the dock course by hand assigns no handbook.
  await api('owner', 'automation.state', { rule: rules.enrollment.id, state: 'paused' })
  await api('owner', 'assignment.create', { course: next.id, learners: [ids.gus], dueDate: '2030-10-01' })
  assert.equal((await assignments(ids.gus, handbook.id)).length, 0)

  // Automation shows the rules and their runs to the owner only; every run is audited.
  const page = await h.raw('/app/automation', { cookie: cookies.owner })
  const text = await page.text()
  assert.ok(page.status === 200 && ['Dock after induction', 'Checks again after a fail', 'Latest runs', 'Paused'].every(item => text.includes(item)))
  assert.equal((await h.raw('/app/automation', { cookie: cookies.manager })).status, 403)
  const runs = (await api('owner', 'automation')).runs
  assert.deepEqual(runs.map(run => run.outcome).sort(), ['assigned', 'assigned', 'assigned'])
  assert.equal((await api('owner', 'audit?q=automation.run')).events.length, 3)
}

// AUTO-008: today's automatic doors inherit one owner policy. Every assertion
// below uses a real form/API and native assignment effect; no provider is simulated.
export async function automationControlsCheck(f) {
  const { api, h, cookies, ids, course, assign, lessons } = f
  const source = await course('Paid safety induction'), target = await course('Supervised dock practice')
  const rule = (await api('owner', 'automation.save', { name: 'Dock practice for the floor', trigger: 'completion', sourceCourse: source.id, targetCourse: target.id, team: ids.team, dueDays: 7 })).id
  const control = () => api('owner', 'automation-controls')
  const initialPolicy = (await control()).policy
  const policy = async fields => { const p = (await control()).policy; return api('owner', 'automation.policy', { version: p.version, paused: !!p.paused, quietStart: p.quietStart, quietEnd: p.quietEnd, dailyLimit: p.dailyLimit, ...fields }) }
  const mode = async (kind, id, value) => api('owner', 'automation.policy', { version: (await control()).policy.version, kind, rule: id, mode: value })
  const targets = learner => api('owner', `records/${learner}`).then(record => record.assignments.filter(a => a.course === target.id))
  await api('manager', 'automation-controls', undefined, 403)
  await api('manager', 'automation.policy', { version: 0, paused: true, quietStart: 0, quietEnd: 0, dailyLimit: 0 }, 403)
  await api('owner', 'automation.preview', { rule })
  await mode('follow_on', rule, 'approval')
  await api('owner', 'automation.state', { rule, state: 'active' })
  const assignment = await assign(source)
  await lessons(assignment)
  assert.equal((await targets(ids.learner)).length, 0)
  let view = await control(), execution = view.executions.find(e => e.rule_id === rule)
  assert.equal(execution.outcome, 'approval_required')
  assert.equal(execution.input.learner, ids.learner)
  assert.ok(execution.event_key.startsWith('completion:'))
  assert.equal(execution.policy_version, view.policy.version)
  assert.equal((await h.submit('automation.approve', cookies.owner, { execution: execution.id, version: view.policy.version }, '/app/automation')).searchParams.get('error'), null)
  // A new policy invalidates the reviewed version. The event needs a fresh approval.
  await policy({ dailyLimit: 100 })
  assert.equal((await api('owner', 'automation.replay', { rule })).results.approval_required, 1)
  await api('owner', 'automation.approve', { execution: execution.id, version: (await control()).policy.version - 1 }, 409)
  await api('owner', 'automation.approve', { execution: execution.id, version: (await control()).policy.version })
  await api('owner', 'automation.replay', { rule })
  assert.equal((await targets(ids.learner)).length, 1)
  await Promise.all([api('owner', 'automation.replay', { rule }), api('owner', 'automation.replay', { rule })])
  assert.equal((await targets(ids.learner)).length, 1)

  // The team condition excludes an out-of-scope completion.
  await api('owner', 'offline.record', { ...f.offline(source), learners: [ids.assessor] })
  assert.equal((await targets(ids.assessor)).length, 0)
  // A separate native event fails while its target is retired, then replays safely.
  const failureSource = await course('Warehouse induction'), recovery = await course('Warehouse follow-up')
  const recoverRule = (await api('owner', 'automation.save', { name: 'Warehouse follow-up', trigger: 'completion', sourceCourse: failureSource.id, targetCourse: recovery.id, dueDays: 3 })).id
  await api('owner', 'automation.preview', { rule: recoverRule })
  await api('owner', 'automation.state', { rule: recoverRule, state: 'active' })
  await api('owner', 'course.retire', { course: recovery.id, reason: 'Trainer unavailable' })
  await api('owner', 'offline.record', f.offline(failureSource))
  view = await control(); const failed = view.executions.find(e => e.rule_id === recoverRule)
  assert.equal(failed.state, 'failed')
  assert.match(failed.failure, /target_unavailable/)
  assert.equal(view.attempts.filter(a => a.execution_id === failed.id).length, 1)
  await api('owner', 'course.reinstate', { course: recovery.id })
  const replay = await api('owner', 'automation.replay', { rule: recoverRule })
  assert.equal(replay.results.assigned, 1)
  assert.equal((await api('owner', 'automation.replay', { rule: recoverRule })).results.already_ran, 1)
  assert.equal((await api('owner', `records/${ids.learner}`)).assignments.filter(a => a.course === recovery.id).length, 1)

  // Quiet hours and zero daily limit hold audience membership as well as enrollment.
  const audienceCourse = await course('First aid orientation')
  const audience = (await api('owner', 'audience.save', { name: 'Floor first aid', teams: [ids.team], course: audienceCourse.id, dueDays: 14 })).id
  await api('owner', 'audience.preview', { audience })
  await api('owner', 'business.configure', { name: 'Regression training', timezone: 'America/Los_Angeles' })
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' }).format(Date.now()))
  await policy({ quietStart: hour, quietEnd: (hour + 1) % 24 })
  let sync = (await api('owner', 'audience.state', { audience, state: 'active' })).sync
  assert.deepEqual([sync.joined.length, sync.held[0].outcome], [0, 'quiet_hours'])
  await policy({ quietStart: 0, quietEnd: 0, dailyLimit: 0 })
  sync = await api('owner', 'audience.sync', { audience })
  assert.equal(sync.held[0].outcome, 'rate_limited')
  await policy({ dailyLimit: 100 })
  await mode('audience', audience, 'approval')
  await api('owner', 'audience.sync', { audience })
  view = await control(); execution = view.executions.find(e => e.rule_id === audience)
  assert.equal(execution.outcome, 'approval_required')
  await api('owner', 'automation.approve', { execution: execution.id, version: view.policy.version })
  assert.equal((await api('owner', 'audience.sync', { audience })).joined.length, 1)
  await api('owner', 'audience.sync', { audience })
  assert.equal((await api('owner', `records/${ids.learner}`)).assignments.filter(a => a.course === audienceCourse.id).length, 1)

  // Removing the administrator who enabled a rule holds its next matching event.
  const unit = (await api('owner', 'unit.create', { name: 'Warehouse learning', teams: [ids.team] })).id
  const grant = (await api('owner', 'admin.grant', { unit, member: ids.reviewer })).id
  const scopedSource = await course('Unit orientation'), scopedTarget = await course('Unit follow-up')
  for (const c of [scopedSource, scopedTarget]) await api('owner', 'course.unit', { course: c.id, unit })
  const scopedRule = (await api('reviewer', 'automation.save', { name: 'Unit follow-up', trigger: 'completion', sourceCourse: scopedSource.id, targetCourse: scopedTarget.id, dueDays: 7 })).id
  await api('reviewer', 'automation.preview', { rule: scopedRule })
  await api('reviewer', 'automation.state', { rule: scopedRule, state: 'active' })
  await api('owner', 'admin.revoke', { grant })
  await api('owner', 'offline.record', f.offline(scopedSource))
  assert.equal((await control()).executions.find(e => e.rule_id === scopedRule).outcome, 'scope_revoked')
  assert.equal((await api('owner', `records/${ids.learner}`)).assignments.filter(a => a.course === scopedTarget.id).length, 0)
  await api('owner', 'automation.replay', { rule: scopedRule })
  assert.equal((await control()).executions.find(e => e.rule_id === scopedRule).outcome, 'scope_revoked')
  await api('owner', 'automation.state', { rule: scopedRule, state: 'paused' })
  await api('owner', 'unit.teams', { unit, teams: [] })

  // Global pause holds departures and follow-ons. Explicit human work still records.
  const mails = h.mails.length
  await policy({ paused: true })
  await api('owner', 'person.directory', { member: ids.learner, employment: 'leave' })
  const current = (await api('owner', 'audiences')).audiences.find(a => a.id === audience)
  assert.ok(current.members.some(m => m.member === ids.learner))
  assert.equal((await api('owner', `records/${ids.learner}`)).assignments.find(a => a.course === audienceCourse.id).status, 'open')
  await api('owner', 'offline.record', { ...f.offline(failureSource), learners: [ids.assessor] })
  assert.equal((await api('owner', `records/${ids.assessor}`)).assignments.filter(a => a.course === recovery.id).length, 0)
  assert.equal(h.mails.length, mails)
  view = await control()
  assert.equal(view.policy.externalSpendCents, 0)
  assert.ok(view.executions.some(e => e.outcome === 'paused'))
  assert.ok(view.versions.length > 1 && view.versions.some(v => v.settings.controls.some(c => c.rule === rule && c.mode === 'approval')))
  assert.ok((await api('owner', 'audit?q=automation.execution')).events.some(e => e.detail.policyVersion !== undefined))
  assert.equal((await h.raw('/app/automation', { cookie: cookies.owner })).status, 200)
  // Other clause journeys share this installation; restore the policy and pause only this journey's rules.
  await api('owner', 'audience.state', { audience, state: 'paused' })
  await policy({ paused: !!initialPolicy.paused, quietStart: initialPolicy.quietStart, quietEnd: initialPolicy.quietEnd, dailyLimit: initialPolicy.dailyLimit })
  await api('owner', 'person.directory', { member: ids.learner, employment: 'active' })
  await api('owner', 'business.configure', { name: 'Regression training', timezone: 'UTC' })
  await api('owner', 'automation.state', { rule, state: 'paused' })
  await api('owner', 'automation.state', { rule: recoverRule, state: 'paused' })
}
