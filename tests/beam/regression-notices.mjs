import assert from 'node:assert/strict'

// NOTICE-006 (in-app): a manager announces to their team and to a course's learners; each recipient sees it with the
// sender and never the other recipients, replies privately, and only the sender reads the reply; a team outside the
// manager's authority is refused, and the delivery is labelled in-app only.
export async function announcementCheck(f) {
  const { api, h, cookies, ids, course } = f
  const page = async (path, role) => await (await h.raw(path, { cookie: cookies[role] })).text()
  const team = await f.team('Announce team', [ids.learner, ids.assessor])
  assert.equal((await h.submit('announcement.send', cookies.manager, { audience: `team:${team}`, title: 'Room change', body: 'Thursday training moves to the back office.' }, '/app/announcements')).searchParams.get('error'), null)
  const sent = (await api('manager', 'announcements')).sent.find(row => row.title === 'Room change')
  assert.equal(sent.recipients, 2)

  // Each recipient sees it with its sender and no recipient list.
  const home = await page('/app/learning', 'learner')
  assert.ok(home.includes('Room change') && home.includes('From manager') && !home.includes('assessor'))
  const received = (await api('learner', 'announcements')).received.find(row => row.id === sent.id)
  assert.ok(received && !('recipients' in received))

  // A private reply: the sender reads it; the other recipient and the owner's audit do not.
  assert.equal((await h.submit('announcement.reply', cookies.learner, { announcement: sent.id, body: 'I will be ten minutes late.' }, '/app/learning')).searchParams.get('error'), null)
  assert.deepEqual((await api('manager', 'announcements')).sent.find(row => row.id === sent.id).replies.map(reply => [reply.learnerName, reply.body]), [['learner', 'I will be ten minutes late.']])
  assert.ok((await page('/app/announcements', 'manager')).includes('I will be ten minutes late.'))
  assert.deepEqual((await api('assessor', 'announcements')).received.find(row => row.id === sent.id).replies, [])
  const audit = await api('owner', `audit?q=${sent.id}`)
  assert.ok(audit.events.some(event => event.action === 'announcement.reply' && JSON.stringify(event.detail) === '{}') && !JSON.stringify(audit).includes('ten minutes late'))
  await api('other', 'announcement.reply', { announcement: sent.id, body: 'Not mine' }, 404)

  // To a course's learners in the manager's reach; outside their authority, or as a learner, it is refused.
  const c = await course('Announced course')
  await api('manager', 'assignment.create', { course: c.id, learners: [ids.learner], dueDate: '2030-10-01' })
  const toCourse = await api('manager', 'announcement.send', { audience: `course:${c.id}`, title: 'New lesson', body: 'Lesson 2 is live.' })
  assert.deepEqual([toCourse.recipients, toCourse.delivered, toCourse.notSent], [1, ['in_app'], ['email', 'slack', 'teams']])
  const elsewhere = (await api('owner', 'team.create', { name: 'Not managed' })).id
  await api('owner', 'team.members', { team: elsewhere, members: [ids.other] })
  assert.equal((await api('manager', 'announcement.send', { audience: `team:${elsewhere}`, title: 'x', body: 'y' }, 403)).error, 'learner_outside_your_team')
  await api('learner', 'announcement.send', { audience: `team:${team}`, title: 'x', body: 'y' }, 403)
}

// NOTICE-005's explicitly partial in-app slice: configured completion events,
// real relationship recipients, language templates and private inboxes. Delivered
// email and the remaining event/channel acceptance stay owed in the contract.
export async function notificationRulesCheck(f) {
  const { api, h, cookies, ids, course, lessons } = f
  const first = await course('Safe loading'), second = await course('Safe unloading')
  await api('owner', 'person.directory', { member: ids.learner, location: 'Austin', manager: ids.other })
  const fields = { name: 'Completion to current managers', recipient: 'manager', team: ids.team, location: 'Austin', subject: '{learner_name} completed {course_name}', body: 'Reviewed <em>result</em>. {assignment_link} · due {due_date}', variantLanguage: 'es', variantSubject: '{learner_name} completó {course_name}', variantBody: 'Consulta {assignment_link}.' }
  assert.equal((await h.submit('notification.save', cookies.owner, fields, '/app/notifications')).searchParams.get('error'), null)
  const rules = () => api('owner', 'notification-rules')
  const rule = (await rules()).rules.find(r => r.name === fields.name)
  const inbox = role => api(role, 'notifications')
  const complete = async c => {
    const assignment = (await api('owner', 'assignment.create', { course: c.id, learners: [ids.learner], dueDate: '2030-10-01' })).created[0]
    await lessons(assignment)
    return assignment
  }
  await api('manager', 'notification.save', fields, 403)
  await api('learner', 'notification-rules', undefined, 403)
  await api('owner', 'notification.state', { rule: rule.id, enabled: true }, 409)
  assert.equal((await h.submit('notification.test', cookies.owner, { rule: rule.id }, '/app/notifications')).searchParams.get('error'), null)
  const actualCourses = await api('owner', 'courses')
  assert.ok((await inbox('owner')).some(n => n.test === 1 && actualCourses.some(c => n.subject === `Owner completed ${c.title}`) && n.body.includes('/app/learning')))
  assert.deepEqual(await inbox('manager'), [])
  assert.equal((await h.submit('notification.state', cookies.owner, { rule: rule.id, enabled: 'true' }, '/app/notifications')).searchParams.get('error'), null)
  const initialMails = h.mails.length
  const firstAssignment = await complete(first)
  const initial = await inbox('manager')
  assert.equal(initial.length, 1)
  assert.equal(initial[0].subject, 'learner completed Safe loading')
  assert.equal(initial[0].assignmentId, firstAssignment)
  assert.deepEqual(await inbox('other'), []) // Directory manager_id alone grants no result.
  assert.deepEqual(await inbox('learner'), [])
  let page = await h.raw('/app/learning', { cookie: cookies.manager }).then(r => r.text())
  assert.ok(page.includes('&lt;em&gt;result&lt;/em&gt;') && !page.includes('<em>result</em>'))

  // A manager retains authority through any current team. It ends only when every
  // applicable management grant ends; prior unrelated journeys must not define it.
  const sharedTeam = await f.team('Shared loading crew', [ids.learner])
  await api('owner', 'person.directory', { member: ids.other, language: 'es-MX' })
  await api('owner', 'team.managers', { team: ids.team, members: [ids.other] })
  await complete(second)
  assert.equal((await inbox('manager')).length, 2)
  await api('owner', 'team.managers', { team: sharedTeam, members: [] })
  assert.deepEqual(await inbox('manager'), [])
  let other = await inbox('other')
  assert.equal(other.length, 1)
  assert.equal(other[0].subject, 'learner completó Safe unloading')
  await api('owner', 'notification.replay', { rule: rule.id })
  assert.equal((await inbox('other')).length, 1) // No duplicate and no earlier event reassigned to this manager.
  assert.equal((await h.raw(`/api/beam/notifications/${ids.other}`, { cookie: cookies.learner })).status, 404)
  assert.equal((await h.raw('/app/notifications', { cookie: cookies.manager })).status, 403)

  // Unknown fields fail before any new version is saved.
  const invalid = await api('owner', 'notification.save', { rule: rule.id, version: rule.version, ...fields, variants: { default: { subject: 'Hello', body: '{secret_score}' } } }, 400)
  assert.equal(invalid.error, 'unknown_merge_field')
  assert.equal((await rules()).rules.find(r => r.id === rule.id).version, rule.version)
  // Both location and team filters apply at the event; suppressed events stay suppressed on replay.
  await api('owner', 'person.directory', { member: ids.learner, location: 'Denver' })
  await complete(first)
  assert.equal((await inbox('other')).length, 1)
  await api('owner', 'person.directory', { member: ids.learner, location: 'Austin' })
  await api('owner', 'team.members', { team: ids.team, members: [] })
  await complete(first)
  assert.equal((await inbox('other')).length, 0) // The earlier result is hidden while authority is absent.
  await api('owner', 'team.members', { team: ids.team, members: [ids.learner] })
  await api('owner', 'notification.replay', { rule: rule.id })
  assert.equal((await inbox('other')).length, 1)

  // Editing a message creates a version and switches it off. Course filters apply.
  const edited = await api('owner', 'notification.save', { rule: rule.id, version: rule.version, ...fields, course: second.id })
  assert.equal((await rules()).rules.find(r => r.id === rule.id).enabled, 0)
  await complete(second)
  assert.equal((await inbox('other')).length, 1)
  await api('owner', 'notification.state', { rule: rule.id, enabled: true }, 409)
  await api('owner', 'notification.test', { rule: rule.id })
  await api('owner', 'notification.state', { rule: rule.id, enabled: true })
  await complete(first)
  assert.equal((await inbox('other')).length, 1)

  // An in-app event also obeys AUTO-008's global pause and explicitly replays.
  const policy = (await api('owner', 'automation-controls')).policy
  const savePolicy = fields => api('owner', 'automation.policy', { version: policy.version, paused: !!policy.paused, quietStart: policy.quietStart, quietEnd: policy.quietEnd, dailyLimit: policy.dailyLimit, ...fields })
  const stopped = await savePolicy({ paused: true })
  await complete(second)
  assert.equal((await inbox('other')).length, 1)
  assert.ok((await api('owner', 'automation-controls')).executions.some(e => e.kind === 'notification' && e.outcome === 'paused'))
  await savePolicy({ version: stopped.version, paused: false })
  await api('owner', 'notification.replay', { rule: rule.id })
  const after = await inbox('other')
  assert.ok(after.length >= 2)
  await api('owner', 'notification.replay', { rule: rule.id })
  assert.equal((await inbox('other')).length, after.length)
  assert.equal(h.mails.length, initialMails)
  assert.ok((await api('owner', 'audit?q=notification.in_app')).events.some(e => e.detail.ruleVersion === edited.version && e.detail.channel === 'in_app'))
  assert.ok((await rules()).messages.some(m => m.recipient === ids.other && !m.test))
  // No inactive recipient is added; removing access also ends its live session.
  await api('owner', 'person.access', { member: ids.other, status: 'inactive' })
  const delivered = (await rules()).messages.filter(m => !m.test).length
  await complete(second)
  assert.equal((await rules()).messages.filter(m => !m.test).length, delivered)
  await api('owner', 'person.access', { member: ids.other, status: 'active' })
  cookies.other = await h.signIn('other@example.test')
  await api('owner', 'person.directory', { member: ids.other, language: '' })
  // Restore the fixture's original manager and leave this tested rule off.
  await api('owner', 'notification.state', { rule: rule.id, enabled: false })
  await api('owner', 'team.managers', { team: ids.team, members: [ids.manager] })
  await api('owner', 'person.directory', { member: ids.learner, manager: '', location: '' })
}

// NOTICE-004: every policy/routing/delivery/resolution assertion uses the Worker
// doors. Only the stored due instant moves to advance the scenario's clock.
export async function escalationCheck(f) {
  const { api, h, ids, course, assign, lessons } = f
  const hour = 3_600_000
  const tick = async () => assert.equal((await h.scheduled()).outcome, 'ok')
  const due = async (id, hours) => h.db.prepare('UPDATE beam_assignments SET due_at=? WHERE id=?').bind(Date.now() - hours * hour, id).run()
  const mails = () => h.mails.filter(mail => mail.subject === 'Overdue learning needs attention')
  const queue = async role => (await api(role, 'queues')).escalations
  const item = async (role, id) => (await queue(role)).find(row => row.assignment === id)
  const policy = { version: 0, enabled: true, reminderHours: 1, managerHours: 3, fallbackHours: 6 }
  await api('manager', 'escalation.policy', policy, 403)
  await api('owner', 'escalation.policy', { ...policy, managerHours: 0 }, 400)
  assert.equal((await api('owner', 'escalation.policy', policy)).version, 1)
  await api('owner', 'escalation.policy', policy, 409)
  await api('learner', 'escalation-policy', undefined, 403)
  await api('manager', 'escalation.run', {}, 403)
  const c = await course('Escalated training'), a = await assign(c)
  const original = (await api('learner', `assignments/${a}`)).assignment
  await due(a, 0.5)
  await tick()
  assert.equal(mails().length, 0, 'no reminder before its delay')
  await due(a, 2)
  await api('owner', 'person.directory', { member: ids.learner, employment: 'leave' })
  await tick()
  assert.equal(mails().length, 0, 'learner reminders pause on leave')
  assert.equal((await item('manager', a)).onLeave, true)
  await api('owner', 'person.directory', { member: ids.learner, employment: 'active' })
  h.edge.refuse = true
  await tick()
  h.edge.refuse = false
  let row = await item('manager', a)
  assert.match(row.failures[0].failure, /^mail_rejected:/)
  assert.equal(row.messages.length, 0, 'rejected mail is never labelled accepted')
  await tick()
  assert.equal(mails().length, 0, 'no hidden automatic retry')
  await api('owner', 'person.directory', { member: ids.learner, employment: 'leave' })
  const blocker = await api('learner', 'blocker.report', { assignment: a, kind: 'leave', note: 'Return date not yet confirmed.' })
  await api('owner', 'team.managers', { team: ids.team, members: [ids.other] })
  await due(a, 4)
  await tick()
  row = await item('other', a)
  assert.deepEqual(row.reachesNow, [{ id: ids.other, route: 'direct' }])
  assert.equal(row.onLeave, true)
  assert.ok(row.failures.some(failure => failure.route === 'learner'))
  assert.ok((await api('other', 'queues')).blockers.some(row => row.id === blocker.id))
  assert.deepEqual(await queue('manager'), [], 'former manager loses the private queue immediately')
  assert.equal(mails().length, 1)
  assert.ok(mails()[0].to.includes('other@example.test') && mails()[0].text.includes('paid work time'))
  assert.ok(!mails()[0].text.includes('Return date'), 'blocker text stays behind current sign-in authority')
  await tick()
  assert.equal(mails().length, 1, 'manager delivery is deduplicated')
  // A temporary cover supersedes the direct manager; revoking it rechecks the route.
  const cover = await api('owner', 'team.coverage', { team: ids.team, member: ids.manager, expiresOn: '2030-12-01', reason: 'Cover the shift' })
  await tick()
  assert.deepEqual((await item('manager', a)).reachesNow, [{ id: ids.manager, route: 'coverage' }])
  assert.equal(mails().length, 2)
  await api('owner', 'team.coverage.end', { grant: cover.id })
  assert.deepEqual(await queue('manager'), [])
  await due(a, 7)
  await tick()
  row = await item('other', a)
  assert.deepEqual(row.reachesNow, [{ id: ids.owner, route: 'owner' }])
  assert.equal(mails().length, 3)
  assert.ok(mails()[2].to.includes('owner@example.test'))
  // Resolve the reported blocker under the existing exception policy, then the
  // escalation with a reason; neither operation rewrites the original due date.
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  await api('other', 'exception.grant', { assignment: a, blocker: blocker.id, kind: 'deferral', endsOn: tomorrow, reason: 'Leave approved; manager arranged a return session.' })
  assert.deepEqual(await queue('other'), [])
  await api('learner', 'escalation.resolve', { assignment: a, reason: 'Self approval' }, 404)
  await api('manager', 'escalation.resolve', { assignment: a, reason: 'Former manager' }, 404)
  await api('other', 'escalation.resolve', { assignment: a, reason: 'Replacement session arranged on return.' })
  await h.db.prepare('UPDATE beam_exceptions SET ends_at=? WHERE assignment_id=?').bind(Date.now() - 1000, a).run()
  await tick()
  assert.deepEqual(await queue('other'), [])
  assert.equal(mails().length, 3)
  assert.equal((await api('learner', `assignments/${a}`)).assignment.dueDate, original.dueDate)
  // No email has no SMS delivery capability today: expose no contact route, not a
  // fictitious send. Attempt exhaustion and full assessor sessions are actionable.
  const practical = await course('Full practical calendar', true)
  const pa = await assign(practical)
  await api('owner', 'assignment.create', { course: practical.id, learners: [ids.assessor], dueDate: '2030-10-01' })
  await api('owner', 'instructor.grant', { member: ids.assessor, expiresOn: '2030-12-31' })
  const session = await api('owner', 'session.schedule', { course: practical.id, title: 'Assessor fully booked', instructor: ids.assessor, date: '2030-12-03', time: '09:00', minutes: 60, timezone: 'UTC', format: 'classroom', location: 'Yard', capacity: 1 })
  await api('assessor', 'session.register', { session: session.id })
  await due(pa, 2)
  assert.equal((await item('other', pa)).missingAssessorCapacity, true)
  await api('owner', 'session.seats', { session: session.id, capacity: 2 })
  assert.equal((await item('other', pa)).missingAssessorCapacity, false)
  await api('owner', 'person.directory', { member: ids.learner, email: '' })
  assert.equal((await item('other', pa)).noContactRoute, true)
  await api('owner', 'person.directory', { member: ids.learner, email: 'learner@example.test', employment: 'active' })
  const quiz = await api('author', 'course.create', { title: 'Exhausted retry', reviewer: ids.reviewer })
  let version = (await api('author', 'course.lesson', { course: quiz.id, draftVersion: quiz.draftVersion, title: 'Stop safely', body: 'Stop first.', sources: [] })).draftVersion
  version = (await api('author', 'course.question', { course: quiz.id, draftVersion: version, prompt: 'First action?', choices: 'Stop\nContinue', correct: '1' })).draftVersion
  version = (await api('author', 'course.assessment', { course: quiz.id, draftVersion: version, passPercent: 100, maxAttempts: 1 })).draftVersion
  await f.publish((await api('author', 'course.submit', { course: quiz.id, draftVersion: version })).id)
  const qa = await assign(quiz)
  await lessons(qa)
  const question = (await api('learner', `assignments/${qa}`)).quiz.questions[0]
  await api('learner', 'quiz.submit', { assignment: qa, [`q_${question.id}`]: ['1'] })
  await due(qa, 4)
  assert.equal((await item('other', qa)).attemptsExhausted, true)
  await api('other', 'escalation.resolve', { assignment: qa, reason: 'Manager is arranging a supported retry.' })
  // Completion before replay suppresses the formerly failed queued reminder.
  const done = await course('Complete before queued mail'), da = await assign(done)
  await due(da, 2)
  h.edge.refuse = true
  await tick()
  h.edge.refuse = false
  const before = mails().length
  await lessons(da)
  await api('owner', 'escalation.run', {})
  assert.equal(mails().length, before + 1, 'only the other open practical reminder replays')
  assert.ok(!(await queue('other')).some(row => row.assignment === da))
  assert.ok((await api('owner', 'audit?q=escalation')).events.some(event => event.action === 'escalation.resolve'))
  const p = await api('owner', 'escalation-policy')
  await api('owner', 'escalation.policy', { ...policy, version: p.version, enabled: false })
  await tick()
  assert.deepEqual(await queue('owner'), [])
}
