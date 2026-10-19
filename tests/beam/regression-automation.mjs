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
