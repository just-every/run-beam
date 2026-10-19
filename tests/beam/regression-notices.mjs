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
