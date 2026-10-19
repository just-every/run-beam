import assert from 'node:assert/strict'

// LIVE-002: a two-seat session fills, two people wait in order, a cancelled seat is offered to the first, the offer
// expires and passes to the second, who accepts; the registration deadline closes the session to new people; five
// simultaneous registrations for a two-seat session take exactly two seats, and a freed or added seat goes straight to
// the waiting learner whose assignment is due soonest. Offers show on My learning, and every step stays in each
// learner's history and the scheduler's roster.
export async function seatsCheck(f) {
  const { api, h, cookies, ids, course } = f
  const page = async (path, role) => (await h.raw(path, { cookie: cookies[role] })).text()
  const people = ['learner', 'assessor', 'author', 'reviewer', 'other']
  const forklift = await course('Forklift class'), ladder = await course('Ladder class')
  await api('owner', 'assignment.create', { course: forklift.id, learners: people.map(person => ids[person]), dueDate: '2030-10-01', dueTime: '17:00', timezone: 'UTC' })
  // Ladder assignments fall due one day apart: learner last (Oct 10), other first (Oct 6).
  for (const [index, person] of people.entries()) await api('owner', 'assignment.create', { course: ladder.id, learners: [ids[person]], dueDate: `2030-10-${String(10 - index).padStart(2, '0')}`, dueTime: '17:00', timezone: 'UTC' })
  const when = { date: '2030-12-03', time: '09:00', minutes: 120, timezone: 'America/Denver', format: 'classroom', location: 'Yard B' }
  assert.equal((await api('owner', 'session.schedule', { ...when, course: forklift.id, title: 'Forklift', capacity: 2, closesDate: '2030-12-05' }, 400)).error, 'deadline_after_start')
  const forkliftSession = (await api('owner', 'session.schedule', { ...when, course: forklift.id, title: 'Forklift', capacity: 2, policy: 'offer', offerHours: 24, closesDate: '2030-11-30', closesTime: '17:00' })).id
  const session = async (id, role = 'owner') => (await api(role, 'sessions')).managed.find(row => row.id === id)
  const waits = async role => (await api(role, 'sessions')).waits

  // Fill the two seats; the next two wait in joining order.
  const outcomes = []
  for (const person of ['learner', 'assessor', 'author', 'reviewer']) outcomes.push((await api(person, 'session.register', { session: forkliftSession })).outcome)
  assert.deepEqual(outcomes, ['registered', 'registered', 'waitlisted', 'waitlisted'])
  assert.deepEqual([(await waits('author'))[0].position, (await waits('reviewer'))[0].position], [1, 2])
  let state = await session(forkliftSession)
  assert.deepEqual([state.registered, state.offered, state.waiting, state.full], [2, 0, 2, true])
  const offered = await page('/app/sessions', 'other')
  assert.ok(offered.includes('2 of 2 seats taken · 2 waiting') && offered.includes('Join the waitlist') && offered.includes('registration closes Nov 30, 2030, 5:00 p.m. (Denver time)'))

  // A cancelled seat is offered to the first in line; the offer holds the seat, so the session stays full.
  assert.equal((await h.submit('session.leave', cookies.learner, { session: forkliftSession }, '/app/sessions')).searchParams.get('error'), null)
  assert.equal((await waits('author'))[0].state, 'offered')
  state = await session(forkliftSession)
  assert.deepEqual([state.registered, state.offered, state.waiting, state.full], [1, 1, 1, true])
  assert.ok((await page('/app/learning', 'author')).includes('Session seat offered to you'))
  assert.ok((await page('/app/sessions', 'author')).includes('A seat is offered to you until'))

  // The offer expires: the seat passes to the next person, who accepts it; the expired offer cannot be accepted.
  await h.db.prepare("UPDATE beam_session_waitlist SET offer_expires_at = ? WHERE learner_id = ? AND state = 'offered'").bind(Date.now() - 1000, ids.author).run()
  assert.equal((await waits('reviewer'))[0].state, 'offered')
  assert.equal((await api('author', 'session.accept', { session: forkliftSession }, 409)).error, 'no_open_offer')
  assert.equal((await h.submit('session.accept', cookies.reviewer, { session: forkliftSession }, '/app/sessions')).searchParams.get('error'), null)
  state = await session(forkliftSession)
  assert.deepEqual([state.registered, state.offered, state.waiting], [2, 0, 0])
  const kinds = async role => (await api(role, 'sessions')).history.filter(row => row.session === forkliftSession).map(row => row.kind)
  assert.deepEqual([await kinds('learner'), await kinds('author'), await kinds('reviewer')], [['registered', 'left'], ['waitlisted', 'offered', 'offer_expired'], ['waitlisted', 'offered', 'accepted']])
  assert.deepEqual(state.history.map(row => [row.learnerName, row.kind]), [['learner', 'registered'], ['assessor', 'registered'], ['author', 'waitlisted'], ['reviewer', 'waitlisted'], ['learner', 'left'], ['author', 'offered'], ['author', 'offer_expired'], ['reviewer', 'offered'], ['reviewer', 'accepted']])
  assert.ok((await page('/app/sessions', 'owner')).includes('Roster history'))

  // After the registration deadline nobody new registers or joins the waitlist.
  await h.db.prepare('UPDATE beam_sessions SET registration_closes_at = ? WHERE id = ?').bind(Date.now() - 1000, forkliftSession).run()
  assert.equal((await api('other', 'session.register', { session: forkliftSession }, 409)).error, 'registration_closed')

  // Five simultaneous registrations for two seats: exactly two seats are taken and three people wait.
  const ladderSession = (await api('owner', 'session.schedule', { ...when, course: ladder.id, title: 'Ladder', capacity: 2, policy: 'assign', order: 'due' })).id
  const results = await Promise.all(people.map(person => api(person, 'session.register', { session: ladderSession })))
  const seated = people.filter((_, index) => results[index].outcome === 'registered'), waiting = people.filter((_, index) => results[index].outcome === 'waitlisted')
  assert.deepEqual([seated.length, waiting.length], [2, 3])
  state = await session(ladderSession)
  assert.deepEqual([state.registered, state.waiting], [2, 3])

  // A freed seat, then an added one, go straight to the waiting learner due soonest (later in the list = due sooner).
  const soonest = list => list.reduce((best, person) => people.indexOf(person) > people.indexOf(best) ? person : best)
  const first = soonest(waiting)
  await api(seated[0], 'session.leave', { session: ladderSession })
  assert.ok((await api(first, 'sessions')).agenda.some(row => row.id === ladderSession))
  assert.ok((await page('/app/sessions', first)).includes('Moved from the waitlist into the session'))
  const second = soonest(waiting.filter(person => person !== first))
  assert.equal((await h.submit('session.seats', cookies.owner, { session: ladderSession, capacity: '3', policy: 'assign', order: 'due', offerHours: '24' }, '/app/sessions')).searchParams.get('error'), null)
  assert.ok((await api(second, 'sessions')).agenda.some(row => row.id === ladderSession))
  state = await session(ladderSession)
  assert.deepEqual([state.registered, state.waiting, state.capacity], [3, 1, 3])
  await api('learner', 'session.seats', { session: ladderSession, capacity: 5 }, 403)
}
