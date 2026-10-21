import assert from 'node:assert/strict'

// NOTICE-006 / ORG-005: the settled instructor door, through HTTP and HTML forms.
// Only time is advanced in storage; registrations, grants and naming use their doors.
export async function sessionAnnouncementCheck(f) {
  const { api, h, cookies, ids, course } = f
  const instructor = (await api('owner', 'person.invite', { email: 'session-instructor@example.test', name: 'Session instructor', roles: ['learner'] })).id
  const cookie = await h.signIn('session-instructor@example.test', { requested: true })
  const send = (audience, status = 200) => h.api('announcement.send', cookie, { audience, title: 'Yard moved', body: 'Meet at Yard D during paid training time.' }, status)
  const inbox = () => h.api('announcements', cookie)
  const ladder = await course('Session announcement safety')
  const grant = await api('owner', 'instructor.grant', { member: instructor, expiresOn: '2030-12-31' })
  const slot = { course: ladder.id, title: 'Morning yard', format: 'classroom', location: 'Yard C', instructor, date: '2030-12-12', time: '07:00', minutes: 45, timezone: 'America/Chicago', capacity: 3, policy: 'offer' }
  const session = (await api('owner', 'session.schedule', slot)).id
  await api('owner', 'assignment.create', { course: ladder.id, learners: [instructor, ids.learner, ids.assessor, ids.author, ids.reviewer, ids.other], dueDate: '2030-12-30' })
  await h.api('session.register', cookie, { session })
  for (const role of ['learner', 'assessor', 'author', 'reviewer']) await api(role, 'session.register', { session })
  await api('learner', 'session.leave', { session }) // canceled learner; author now holds an offer, reviewer still waits.
  const elsewhere = (await api('owner', 'session.schedule', { ...slot, title: 'Other session', instructor: '', capacity: 5 })).id
  await api('other', 'session.register', { session: elsewhere })
  await send(`team:${ids.team}`, 403)
  await send(`course:${ladder.id}`, 403)
  await send(`session:${elsewhere}`, 403)
  await api('manager', 'announcement.send', { audience: `session:${session}`, title: 'No grant', body: 'No' }, 403)

  const page = await (await h.raw('/app/announcements', { cookie })).text()
  assert.ok(page.includes(`session:${session}`) && !page.includes(`session:${elsewhere}`))
  assert.ok(!page.includes(`team:${ids.team}`) && !page.includes(`course:${ladder.id}`))
  assert.equal((await h.submit('announcement.send', cookie, { audience: `session:${session}`, title: 'Yard moved', body: 'Meet at Yard D during paid training time.' }, '/app/announcements')).searchParams.get('error'), null)
  const sent = (await inbox()).sent.find(row => row.title === 'Yard moved')
  assert.deepEqual([sent.audienceKind, sent.audience, sent.recipients], ['session', session, 1])
  for (const role of ['learner', 'author', 'reviewer', 'other']) assert.ok(!(await api(role, 'announcements')).received.some(row => row.id === sent.id), `${role} is not registered in this session`)
  assert.ok(!(await inbox()).received.some(row => row.id === sent.id), 'the sender is excluded')
  const received = (await api('assessor', 'announcements')).received.find(row => row.id === sent.id)
  assert.ok(received.repliesOpen && !('recipients' in received) && !('audience' in received))
  await api('assessor', 'announcement.reply', { announcement: sent.id, body: 'I will bring the ladder.' })
  assert.deepEqual((await inbox()).sent.find(row => row.id === sent.id).replies.map(row => row.body), ['I will bring the ladder.'])
  assert.ok(!JSON.stringify(await api('owner', 'announcements')).includes('bring the ladder'), 'admins never read instructor replies')
  const audit = await api('owner', `audit?q=${sent.id}`)
  const event = audit.events.find(row => row.action === 'announcement.send')
  assert.deepEqual([event.detail.audience, event.detail.recipients, event.detail.channels, event.detail.basis, event.detail.grant], [`session:${session}`, 1, ['in_app'], 'instructor', grant.id])
  assert.ok(audit.events.some(row => row.action === 'announcement.reply') && !JSON.stringify(audit).includes('bring the ladder'))
  const view = await h.raw('/app/view/start', { cookie: cookies.owner, form: new URLSearchParams({ learner: ids.assessor, returnTo: '/app/learning' }) })
  assert.equal(view.status, 303)
  const viewing = `${cookies.owner}; ${view.headers.getSetCookie().find(line => line.startsWith('beam_view=')).split(';')[0]}`
  assert.deepEqual((await h.api('announcements', viewing)).received.find(row => row.id === sent.id).replies, [])
  const viewed = await h.raw('/app/learning', { cookie: viewing })
  assert.equal(viewed.status, 200)
  assert.ok(!(await viewed.text()).includes('bring the ladder'))

  // Recipient snapshot never expands when an offered learner accepts later.
  await api('author', 'session.accept', { session })
  assert.ok(!(await api('author', 'announcements')).received.some(row => row.id === sent.id))
  assert.equal((await inbox()).sent.find(row => row.id === sent.id).recipients, 1)

  // Expiry closes new sends/replies and hides the sender's old replies.
  await h.db.prepare('UPDATE beam_instructor_grants SET expires_at = ? WHERE id = ?').bind(Date.now() - 1000, grant.id).run()
  await send(`session:${session}`, 403)
  assert.equal((await api('assessor', 'announcement.reply', { announcement: sent.id, body: 'After expiry' }, 403)).error, 'announcement_replies_closed')
  assert.deepEqual((await inbox()).sent.find(row => row.id === sent.id).replies, [])
  assert.equal((await api('assessor', 'announcements')).received.find(row => row.id === sent.id).repliesOpen, false)
  assert.ok((await (await h.raw('/app/learning', { cookie: cookies.assessor })).text()).includes('Replies are closed'))
  const renewed = await api('owner', 'instructor.grant', { member: instructor, expiresOn: '2030-12-31' })
  assert.equal((await inbox()).sent.find(row => row.id === sent.id).replies.length, 1)
  await api('assessor', 'announcement.reply', { announcement: sent.id, body: 'Access renewed.' })
  await api('owner', 'instructor.revoke', { grant: renewed.id })
  assert.deepEqual((await inbox()).sent.find(row => row.id === sent.id).replies, [])
  await api('assessor', 'announcement.reply', { announcement: sent.id, body: 'After revoke' }, 403)
  await api('owner', 'instructor.grant', { member: instructor, expiresOn: '2030-12-31' })

  // Un-naming closes the original instructor's replies without rerouting them.
  await api('owner', 'session.update', { ...slot, session, instructor: '' })
  await send(`session:${session}`, 403)
  await api('assessor', 'announcement.reply', { announcement: sent.id, body: 'After removal' }, 403)
  assert.deepEqual((await inbox()).sent.find(row => row.id === sent.id).replies, [])
  await api('owner', 'session.update', { ...slot, session })
  assert.equal((await inbox()).sent.find(row => row.id === sent.id).replies.length, 2)

  // Scoped learning admins use the same registered audience, never another unit.
  const unit = await api('owner', 'unit.create', { name: 'Announcement unit', teams: [] })
  await api('owner', 'course.unit', { course: ladder.id, unit: unit.id })
  const adminGrant = await api('owner', 'admin.grant', { member: ids.other, unit: unit.id, expiresOn: '2030-12-31' })
  const admin = await api('other', 'announcement.send', { audience: `session:${session}`, title: 'Admin room notice', body: 'Same session audience.' })
  assert.equal(admin.recipients, 3)
  assert.deepEqual([admin.delivered, admin.notSent], [['in_app'], ['email', 'slack', 'teams']])
  const outside = await course('Outside administrator unit')
  const outsideSession = (await api('owner', 'session.schedule', { ...slot, course: outside.id, title: 'Outside unit' })).id
  await api('other', 'announcement.send', { audience: `session:${outsideSession}`, title: 'No', body: 'No' }, 403)
  await api('owner', 'session.cancel', { session, reason: 'Weather closure' })
  await send(`session:${session}`, 403)
  await api('other', 'announcement.send', { audience: `session:${session}`, title: 'Canceled', body: 'No' }, 403)
  await api('assessor', 'announcement.reply', { announcement: sent.id, body: 'After cancellation' }, 403)
  await api('owner', 'admin.revoke', { grant: adminGrant.id })
}
