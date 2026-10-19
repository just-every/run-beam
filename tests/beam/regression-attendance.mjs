import assert from 'node:assert/strict'
import { file } from './harness.mjs'

// LIVE-003: a reviewed course revision requires 80% session attendance. The session's instructor takes attendance on
// its roster once it has begun: one learner attends with evidence, one is absent, one partly attends (below the
// policy); a mistake is amended with a reason and the timeline keeps both records. Attendance and lessons stay separate
// requirements: the classroom course completes only when both are met, on its exact revision, and the blended path's
// self-paced course stays outstanding. Only the instructor and schedulers keep the roster.
export async function attendanceCheck(f) {
  const { api, h, cookies, ids, course, publish } = f
  const page = async (path, role) => (await h.raw(path, { cookie: cookies[role] })).text()
  const theory = await course('Scaffold theory')

  // The attendance rule is part of the revision the reviewer reviews and publishes.
  const c = await api('author', 'course.create', { title: 'Scaffold practical', reviewer: ids.reviewer })
  let draftVersion = (await api('author', 'course.lesson', { course: c.id, draftVersion: c.draftVersion, title: 'Before the session', body: 'Read the scaffold checklist.', sources: [] })).draftVersion
  draftVersion = (await api('author', 'course.attendance', { course: c.id, draftVersion, attendancePercent: 80 })).draftVersion
  const revision = (await api('author', 'course.submit', { course: c.id, draftVersion })).id
  assert.ok((await page(`/app/revisions/${revision}`, 'reviewer')).includes('at least 80% of its scheduled minutes'))
  await publish(revision)

  // A blended path: the self-paced course and the classroom course; two more people are assigned the classroom course.
  const path = (await api('manager', 'path.create', { name: 'Scaffold crew', team: ids.team })).id
  await api('manager', 'path.revise', { path, courses: [theory.id, c.id], prerequisites: ['', ''], dueDays: ['14', '30'], renewalDays: ['', ''] })
  await api('manager', 'path.assign', { path })
  await api('owner', 'assignment.create', { course: c.id, learners: [ids.assessor, ids.author], dueDate: '2030-10-01', dueTime: '17:00', timezone: 'UTC' })
  const session = (await api('owner', 'session.schedule', { course: c.id, title: 'Scaffold yard', format: 'classroom', location: 'Yard C', instructor: ids.other, date: '2030-12-10', time: '08:00', minutes: 60, timezone: 'America/Phoenix' })).id
  for (const person of ['learner', 'assessor', 'author']) await api(person, 'session.register', { session })
  const practical = (await api('learner', 'records/me')).assignments.find(row => row.course === c.id && row.status === 'open').id

  // Attendance opens when the session begins; only its instructor and schedulers keep the roster.
  assert.equal((await api('other', 'attendance.record', { session, learner: ids.learner, status: 'attended', decision: 'complete' }, 409)).error, 'session_not_started')
  assert.ok((await page(`/app/sessions/${session}/roster`, 'other')).includes('Attendance opens when the session begins'))
  await h.db.prepare('UPDATE beam_session_meetings SET starts_at = ?, ends_at = ? WHERE session_id = ?').bind(Date.now() - 2 * 3_600_000, Date.now() - 3_600_000, session).run()
  for (const role of ['learner', 'manager']) await api(role, `sessions/${session}/roster`, undefined, 404)
  await api('learner', 'attendance.record', { session, learner: ids.assessor, status: 'absent' }, 404)

  // Take attendance: attended with evidence, absent, and a partial 30 of 60 minutes.
  const attended = await api('other', 'attendance.record', { session, learner: ids.learner, status: 'attended', decision: 'complete', note: 'Signed the sheet', file: file('sheet.txt', 'Sign-in sheet, Yard C') })
  assert.equal(attended.completion, null)
  assert.equal((await h.submit('attendance.record', cookies.other, { session, learner: ids.assessor, status: 'absent', decision: 'complete' }, `/app/sessions/${session}/roster`)).searchParams.get('error'), null)
  await api('other', 'attendance.record', { session, learner: ids.author, status: 'partial', minutes: 30, decision: 'complete' })
  await api('other', 'attendance.record', { session, learner: ids.author, status: 'attended', decision: 'complete' }, 409)
  let roster = await api('other', `sessions/${session}/roster`)
  const person = name => roster.learners.find(row => row.learnerName === name)
  assert.deepEqual([person('assessor').current.status, person('assessor').current.minutes, person('assessor').current.decision], ['absent', 0, 'incomplete'])
  assert.deepEqual([person('author').current.minutes, person('author').attendance.met], [30, false])

  // Attendance met, lessons not: the classroom course stays open and the roster names what is outstanding.
  assert.deepEqual([person('learner').attendance.met, person('learner').completion], [true, null])
  assert.ok((await page(`/app/sessions/${session}/roster`, 'other')).includes('Still outstanding: lessons 0 of 1'))
  assert.equal((await api('learner', `assignments/${practical}`)).attendance.met, true)
  await f.lessons(practical)
  const record = await api('learner', 'records/me')
  const completion = record.completions.find(row => row.course === c.id)
  assert.deepEqual([completion.revision, completion.evidence.attendance], [revision, attended.id])
  assert.equal(record.assignments.find(row => row.course === theory.id).status, 'open')
  const evidence = person('learner').current.attachment
  assert.equal((await h.raw(`/app/files/attachment/${evidence}`, { cookie: cookies.learner })).status, 200)
  assert.equal((await h.raw(`/app/files/attachment/${evidence}`, { cookie: cookies.assessor })).status, 404)

  // Amend a mistake with a reason: the partial record is superseded and stays in the timeline.
  await api('other', 'attendance.amend', { attendance: person('author').current.id, status: 'attended', decision: 'complete' }, 400)
  assert.equal((await h.submit('attendance.amend', cookies.other, { attendance: person('author').current.id, status: 'attended', decision: 'complete', reason: 'Late sign-in; the sheet shows the full hour' }, `/app/sessions/${session}/roster`)).searchParams.get('error'), null)
  roster = await api('other', `sessions/${session}/roster`)
  assert.deepEqual(person('author').timeline.map(item => [item.minutes, item.reason, item.supersededAt === null]), [[30, null, false], [60, 'Late sign-in; the sheet shows the full hour', true]])
  assert.equal(person('author').attendance.met, true)
  assert.ok((await page(`/app/sessions/${session}/roster`, 'owner')).includes('Amendment: Late sign-in'))
  assert.ok((await api('owner', 'audit?q=attendance')).events.some(event => event.action === 'attendance.amend' && event.detail.reason.startsWith('Late sign-in')))
}
