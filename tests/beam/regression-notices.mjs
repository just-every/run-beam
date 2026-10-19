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
  assert.ok((await inbox('owner')).some(n => n.test === 1 && n.subject === 'Owner completed Safe loading' && n.body.includes('/app/learning')))
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

  // Resolve the new team manager on the next event. Access to the old notice ends.
  await api('owner', 'person.directory', { member: ids.other, language: 'es-MX' })
  await api('owner', 'team.managers', { team: ids.team, members: [ids.other] })
  await complete(second)
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
