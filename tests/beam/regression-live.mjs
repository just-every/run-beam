import assert from 'node:assert/strict'

// LIVE-001: a blended role path (a self-paced course, then a classroom course) with two session options; the learner is
// held at the prerequisite gate, chooses a slot, switches, and sees a weekly series keep its 9:00 a.m. wall-clock time
// across the November daylight-saving change in the calendar file and agenda; a reschedule into another zone, a change
// and a cancellation each reach the calendar file (same UIDs, higher SEQUENCE) and the agenda. Only the owner (as admin)
// schedules; people without the course cannot choose a session or read its calendar.
export async function liveCheck(f) {
  const { api, h, cookies, ids, course } = f
  const page = async (path, role) => (await h.raw(path, { cookie: cookies[role] })).text()
  const calendar = async (id, role) => { const res = await h.raw(`/app/sessions/${id}/calendar.ics`, { cookie: cookies[role] }); const folded = await res.text(); return { status: res.status, type: res.headers.get('content-type'), folded, text: folded.replace(/\r\n /g, '') } }
  const basics = await course('Food safety basics'), practice = await course('Knife room practice')

  // Programs: the manager's role path combines the self-paced course with the classroom course behind it.
  const path = (await api('manager', 'path.create', { name: 'Blended line cook', team: ids.team })).id
  await api('manager', 'path.revise', { path, courses: [basics.id, practice.id], prerequisites: ['', basics.id], dueDays: ['14', '30'], renewalDays: ['', ''] })

  // The instructor holds instructor access (ORG-005).
  await api('owner', 'instructor.grant', { member: ids.other })
  // Two session options: a weekly classroom series in New York crossing the 3 Nov 2030 change, and one virtual meeting.
  const weekly = { course: practice.id, title: 'Knife room, Tuesdays', format: 'classroom', location: 'Kitchen 2, 18 Pine St', instructor: ids.other, materials: 'Bring a chef knife; read lesson 1', date: '2030-10-29', time: '09:00', minutes: 90, timezone: 'America/New_York', repeat: 'weekly', count: 2 }
  await api('manager', 'session.schedule', weekly, 403)
  await api('learner', 'session.schedule', weekly, 403)
  assert.equal((await api('owner', 'session.schedule', { ...weekly, date: '2020-01-07' }, 400)).error, 'session_in_past')
  assert.equal((await h.submit('session.schedule', cookies.owner, weekly, '/app/sessions')).searchParams.get('error'), null)
  const virtual = (await api('owner', 'session.schedule', { course: practice.id, title: 'Knife room online', format: 'virtual', joinUrl: 'https://meet.example.test/knife', date: '2030-11-07', time: '10:00', minutes: 60, timezone: 'America/Chicago' })).id
  const tuesdays = (await api('owner', 'sessions')).managed.find(row => row.title === 'Knife room, Tuesdays').id
  assert.ok((await page('/app/paths', 'manager')).includes('2 scheduled sessions'))

  // The learner sees both options but cannot choose until the prerequisite is complete.
  await api('manager', 'path.assign', { path })
  const assignments = (await api('learner', 'records/me')).assignments
  const first = assignments.find(row => row.course === basics.id && row.status === 'open').id
  let mine = await api('learner', 'sessions')
  const options = mine.options.find(row => row.course === practice.id)
  assert.deepEqual([options.sessions.map(row => row.id).sort(), options.blocked.prerequisite], [[tuesdays, virtual].sort(), basics.id])
  assert.ok((await page('/app/sessions', 'learner')).includes('Complete Food safety basics first'))
  assert.equal((await api('learner', 'session.register', { session: tuesdays }, 409)).error, 'prerequisite_incomplete')
  await f.lessons(first)

  // Choose the virtual slot, then switch to the Tuesday series: one registration per course, the first kept as cancelled.
  assert.equal((await h.submit('session.register', cookies.learner, { session: virtual }, '/app/sessions')).searchParams.get('error'), null)
  await api('learner', 'session.register', { session: tuesdays })
  await api('learner', 'session.register', { session: tuesdays }, 409)
  mine = await api('learner', 'sessions')
  assert.deepEqual(mine.agenda.map(row => row.id), [tuesdays])
  assert.match((await calendar(virtual, 'learner')).text, /STATUS:CANCELLED/)
  for (const role of ['assessor', 'manager']) assert.equal((await calendar(tuesdays, role)).status, 404)
  await api('assessor', 'session.register', { session: tuesdays }, 404)

  // The same 9:00 a.m. New York wall clock is 13:00 UTC before the change and 14:00 UTC after it.
  let ics = await calendar(tuesdays, 'learner')
  assert.match(ics.type, /^text\/calendar/)
  // Lines are folded at 75 octets with CRLF, as calendar programs expect.
  assert.ok(ics.folded.split('\r\n').every(line => Buffer.byteLength(line) <= 75) && ics.folded.includes('\r\n '))
  assert.deepEqual(ics.text.match(/^DTSTART:.*$/gm), ['DTSTART:20301029T130000Z', 'DTSTART:20301105T140000Z'])
  assert.ok(ics.text.includes('SEQUENCE:0') && ics.text.includes('LOCATION:Kitchen 2\\, 18 Pine St') && ics.text.includes('Materials: Bring a chef knife\\; read lesson 1') && ics.text.includes('Instructor: other'))
  const uids = ics.text.match(/^UID:.*$/gm)
  let agenda = await page('/app/sessions', 'learner')
  assert.ok(agenda.includes('Oct 29, 2030, 9:00 a.m. (New York time)') && agenda.includes('Nov 5, 2030, 9:00 a.m. (New York time)') && agenda.includes('Bring a chef knife'))

  // Reschedule into Chicago across the same change: the calendar keeps its events (same UIDs) at a higher sequence.
  await api('learner', 'session.reschedule', { session: tuesdays, date: '2030-11-01', time: '09:00', minutes: 90, timezone: 'America/Chicago' }, 403)
  assert.equal((await h.submit('session.reschedule', cookies.owner, { session: tuesdays, date: '2030-11-01', time: '09:00', minutes: '90', timezone: 'America/Chicago' }, '/app/sessions')).searchParams.get('error'), null)
  ics = await calendar(tuesdays, 'learner')
  assert.deepEqual([ics.text.match(/^DTSTART:.*$/gm), ics.text.match(/^UID:.*$/gm), /SEQUENCE:1\r\n/.test(ics.text)], [['DTSTART:20301101T140000Z', 'DTSTART:20301108T150000Z'], uids, true])
  agenda = await page('/app/sessions', 'learner')
  assert.ok(agenda.includes('Rescheduled on') && agenda.includes('was Oct 29, 2030 09:00 New York time, now Nov 1, 2030 09:00 Chicago time') && agenda.includes('Nov 8, 2030, 9:00 a.m. (Chicago time)'))

  // A change of room reaches the calendar; the instructor sees the session they lead.
  await api('owner', 'session.update', { session: tuesdays, title: 'Knife room, Fridays', format: 'classroom', location: 'Kitchen 3', instructor: ids.other, materials: 'Bring a chef knife; read lesson 1' })
  ics = await calendar(tuesdays, 'other')
  assert.ok(ics.status === 200 && ics.text.includes('SEQUENCE:2') && ics.text.includes('LOCATION:Kitchen 3'))
  assert.ok((await page('/app/sessions', 'other')).includes('Sessions you lead'))
  assert.match((await api('learner', 'sessions')).agenda[0].changes.map(row => row.kind).join(), /rescheduled,updated/)

  // Cancellation: the learner's calendar file cancels the same events and the agenda says why; no new registrations.
  await api('owner', 'session.cancel', { session: tuesdays, reason: 'Kitchen closed for repairs' })
  ics = await calendar(tuesdays, 'learner')
  assert.ok(ics.text.match(/STATUS:CANCELLED/g).length === 2 && ics.text.includes('SEQUENCE:3') && ics.text.includes('Cancelled: Kitchen closed for repairs'))
  assert.ok((await page('/app/sessions', 'learner')).includes('Cancelled: Kitchen closed for repairs'))
  assert.equal((await api('learner', 'session.register', { session: tuesdays }, 409)).error, 'session_cancelled')
  assert.ok((await api('owner', 'audit?q=session')).events.some(row => row.action === 'session.cancel'))
}
