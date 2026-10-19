import assert from 'node:assert/strict'
import { file } from './harness.mjs'

// ORG-005 (instructor half): the owner gives a person time-limited instructor access on People; only then can they be
// named on a session. The instructor conducts it (takes attendance) and downloads the evidence they recorded, but every
// other write (the session itself, assessment rules, assignments, offline completions, practical decisions, people)
// is refused. When the access ends they lose the roster, its evidence, its calendar and can no longer be named; their
// records stay. The auditor half is asserted in regression-managers.mjs (ORG-005).
export async function instructorsCheck(f) {
  const { api, h, cookies, ids, course } = f
  const page = async (path, role) => (await h.raw(path, { cookie: cookies[role] })).text()
  const ladder = await course('Ladder safety')
  const slot = { course: ladder.id, title: 'Ladder yard', format: 'classroom', location: 'Yard D', instructor: ids.learner, date: '2030-12-12', time: '07:00', minutes: 45, timezone: 'America/Chicago' }
  assert.equal((await api('owner', 'session.schedule', slot, 409)).error, 'not_an_instructor')

  // Access: the owner gives instructor access with an end date on People.
  await api('learner', 'instructor.grant', { member: ids.learner }, 403)
  assert.ok((await page('/app/people', 'owner')).includes('Instructors'))
  assert.equal((await h.submit('instructor.grant', cookies.owner, { member: ids.learner, unit: '', expiresOn: '2030-12-31' }, '/app/people')).searchParams.get('error'), null)
  const grant = (await api('owner', 'instructors')).find(row => row.member === ids.learner && row.state === 'active')
  assert.ok(grant.expiresAt)
  const session = (await api('owner', 'session.schedule', slot)).id
  await api('owner', 'assignment.create', { course: ladder.id, learners: [ids.assessor], dueDate: '2030-10-01', dueTime: '17:00', timezone: 'UTC' })
  await api('assessor', 'session.register', { session })
  assert.ok((await page('/app/sessions', 'learner')).includes('Sessions you lead'))

  // Conduct the session: attendance with evidence, and the evidence downloads.
  await h.db.prepare('UPDATE beam_session_meetings SET starts_at = ?, ends_at = ? WHERE session_id = ?').bind(Date.now() - 3_600_000, Date.now() - 900_000, session).run()
  const recorded = await api('learner', 'attendance.record', { session, learner: ids.assessor, status: 'attended', decision: 'complete', file: file('ladder.txt', 'Ladder yard sign-in') })
  const evidence = (await api('learner', `sessions/${session}/roster`)).learners[0].current.attachment
  assert.equal((await h.raw(`/app/files/attachment/${evidence}`, { cookie: cookies.learner })).status, 200)
  assert.equal((await h.raw(`/app/sessions/${session}/calendar.ics`, { cookie: cookies.learner })).status, 200)

  // Prohibited writes: the session, assessment rules, assignments, completions, practical decisions and people.
  const draftVersion = (await api('author', `courses/${ladder.id}`)).draftVersion
  for (const [action, body] of [['session.update', { session, title: 'Mine now', format: 'classroom', location: 'Yard E' }], ['session.cancel', { session, reason: 'No' }], ['course.assessment', { course: ladder.id, draftVersion, passPercent: 50, maxAttempts: 9 }],
    ['assignment.create', { course: ladder.id, learners: [ids.author], dueDate: '2030-10-01' }], ['offline.record', f.offline(ladder)], ['practical.decide', { attempt: recorded.id, decision: 'accepted', note: 'x' }], ['person.invite', { email: 'new@example.test', name: 'New', roles: ['learner'] }]]) {
    const refused = await h.raw(`/api/beam/${action}`, { cookie: cookies.learner, body })
    assert.ok([403, 404].includes(refused.status), `${action} ${refused.status}`)
  }

  // After the access ends: no roster, evidence, calendar or new naming; the records stay for the schedulers.
  await h.db.prepare('UPDATE beam_instructor_grants SET expires_at = ? WHERE id = ?').bind(Date.now() - 1000, grant.id).run()
  await api('learner', `sessions/${session}/roster`, undefined, 404)
  await api('learner', 'attendance.amend', { attendance: recorded.id, status: 'absent', reason: 'x' }, 404)
  assert.equal((await h.raw(`/app/files/attachment/${evidence}`, { cookie: cookies.learner })).status, 404)
  assert.equal((await h.raw(`/app/sessions/${session}/calendar.ics`, { cookie: cookies.learner })).status, 404)
  assert.ok(!(await page('/app/sessions', 'learner')).includes('Sessions you lead'))
  assert.equal((await api('owner', 'session.schedule', { ...slot, date: '2030-12-19' }, 409)).error, 'not_an_instructor')
  assert.equal((await api('owner', 'instructors')).find(row => row.id === grant.id).state, 'expired')
  assert.equal((await api('owner', `sessions/${session}/roster`)).learners[0].current.recordedByName, 'learner')
}
