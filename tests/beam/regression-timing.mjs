import assert from 'node:assert/strict'

// LEARN-018: a 10-minute quiz runs on the server's clock beside a practical that has no clock. In a real browser the
// page counts down from the server's deadline and announces the five- and one-minute warnings once each in its live
// region. At expiry only saved answers score and later answers are refused through the form and JSON doors, while the
// practical evidence is still taken, untimed. The owner's 50% accommodation gives a second learner 15 minutes, recorded
// with who granted it; a manager grants a teammate extra time, is refused for anyone outside their teams, and the newest
// of two accommodations on the course wins. BEAM_PLAYWRIGHT may name a newer Playwright module for local runs.
export async function timedCheck(f) {
  const { api, h, cookies, ids, publish } = f
  const MINUTE = 60_000
  // Time passes for one running attempt: its start and deadline move back together.
  const age = (session, ms) => h.db.prepare('UPDATE beam_quiz_sessions SET started_at = started_at - ?1, deadline = deadline - ?1 WHERE id = ?2').bind(ms, session).run()
  const c = await api('author', 'course.create', { title: 'Timed test', reviewer: ids.reviewer })
  let draftVersion = c.draftVersion
  const edit = async (action, fields) => { draftVersion = (await api('author', action, { course: c.id, draftVersion, ...fields })).draftVersion }
  await edit('course.lesson', { title: 'Read first', body: 'The procedure in brief.', sources: [] })
  await edit('course.question', { prompt: 'First step?', choices: 'Check\nSkip', correct: '1' })
  await edit('course.question', { prompt: 'Second step?', choices: 'Record\nForget', correct: '1' })
  await edit('course.assessment', { passPercent: 100, maxAttempts: 2, timeLimitMinutes: 10, practicalInstructions: 'Lock out the slicer while the assessor watches', assessor: ids.other })
  await publish((await api('author', 'course.submit', { course: c.id, draftVersion })).id)
  await f.team('Timed team', [ids.learner, ids.assessor])
  await api('learner', 'accommodation.grant', { learner: ids.assessor, course: c.id, kind: 'percent', amount: 50 }, 403)
  // The owner grants extra time to anyone.
  const granted = await h.submit('accommodation.grant', cookies.owner, { learner: ids.assessor, course: c.id, kind: 'percent', amount: '50', note: 'LEARN-011 extra time' }, `/app/records/${ids.assessor}`)
  assert.equal(granted.searchParams.get('error'), null)
  const [mine, second] = (await api('manager', 'assignment.create', { course: c.id, learners: [ids.learner, ids.assessor], dueDate: '2030-10-01' })).created
  const learn = async (role, assignment) => { const view = await api(role, `assignments/${assignment}`); for (const lesson of view.lessons) await api(role, 'lesson.complete', { assignment, lesson: lesson.id }); return (await api(role, `assignments/${assignment}`)).quiz }
  const quiz = await learn('learner', mine)
  assert.deepEqual([quiz.timeLimitMinutes, quiz.extraMinutes, quiz.session], [10, 0, null])
  const [q1, q2] = quiz.questions.map(question => question.id)
  await api('learner', 'quiz.submit', { assignment: mine, [`q_${q1}`]: ['0'] }, 409)
  // Starting sets the server's clock; the page counts down to that deadline with its own script allowed.
  const started = await api('learner', 'quiz.start', { assignment: mine })
  assert.equal(started.deadline - started.startedAt, 10 * MINUTE)
  const running = await h.raw(`/app/learn/${mine}/quiz`, { cookie: cookies.learner })
  const html = await running.text()
  assert.ok(running.headers.get('content-security-policy').includes("script-src 'self'") && html.includes('/beam-countdown.js') && html.includes(`data-deadline="${started.deadline}"`))
  assert.equal((await h.raw('/beam-countdown.js')).status, 200)
  // In a browser the countdown starts from the server's deadline; the warnings reach the live region once each, at five
  // minutes and at one minute left. Only the page's clock moves here: the server's deadline is unchanged.
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT || '@playwright/test')
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true })
    await context.addCookies(cookies.learner.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: h.origin })))
    const tab = await context.newPage()
    await tab.clock.install()
    await tab.goto(`${h.origin}/app/learn/${mine}/quiz`)
    const region = tab.locator('[role="status"][aria-live]')
    const left = async () => { const [m, s] = (await tab.locator('[data-left]').textContent()).split(':').map(Number); return m * 60 + s }
    const shown = await left()
    assert.ok(shown > 590 && shown <= 600, `countdown starts at ${shown}s`)
    assert.deepEqual([await region.count(), await region.textContent()], [1, ''])
    await tab.clock.fastForward(5 * MINUTE + 5_000)
    const five = await region.textContent()
    assert.ok(five && await left() <= 300)
    await tab.clock.fastForward(MINUTE)
    assert.equal(await region.textContent(), five)
    await tab.clock.fastForward(3 * MINUTE)
    const one = await region.textContent()
    assert.ok(one && one !== five && await left() <= 60)
  } finally {
    await browser.close()
  }
  const saved = await h.submit('quiz.save', cookies.learner, { assignment: mine, [`q_${q1}`]: '0' }, `/app/learn/${mine}/quiz`)
  assert.equal(saved.searchParams.get('error'), null)
  // Leaving and coming back resumes the same attempt with the time still running.
  await age(started.id, 4 * MINUTE)
  const resumed = await api('learner', 'quiz.start', { assignment: mine })
  assert.deepEqual([resumed.id, resumed.resumed, resumed.deadline], [started.id, true, started.deadline - 4 * MINUTE])
  assert.deepEqual((await api('learner', `assignments/${mine}`)).quiz.session.answers, { [q1]: [0] })
  // It expires: the saved answer is scored at the deadline and the unsaved one counts as unanswered.
  await age(started.id, 7 * MINUTE)
  const after = await api('learner', `assignments/${mine}`)
  assert.equal(after.quiz.session, null)
  const [expired] = after.attempts
  assert.deepEqual([expired.score, expired.maxScore, expired.passed, expired.closeReason], [1, 2, 0, 'expired'])
  assert.equal((await api('learner', 'quiz.save', { assignment: mine, [`q_${q2}`]: ['0'] }, 409)).error, 'time_expired')
  const late = await h.raw('/api/beam/quiz.submit', { cookie: cookies.learner, body: { assignment: mine, [`q_${q1}`]: ['0'], [`q_${q2}`]: ['0'] } })
  assert.deepEqual([late.status, (await late.json()).error], [409, 'time_expired'])
  assert.equal((await h.submit('quiz.submit', cookies.learner, { assignment: mine, [`q_${q2}`]: '0' }, `/app/learn/${mine}`)).searchParams.get('error'), 'time_expired')
  const detail = await api('learner', `attempts/${expired.id}`)
  assert.deepEqual(Object.fromEntries(detail.responses.map(row => [row.question, [row.answer, row.correct]])), { [q1]: [[0], 1], [q2]: [[], 0] })
  assert.deepEqual([detail.timing.timeLimitMinutes, detail.timing.extraMinutes, detail.timing.closeReason, detail.timing.closedAt - detail.timing.startedAt], [10, 0, 'expired', 10 * MINUTE])
  assert.ok(detail.scoringRule.includes('time limit 10 minutes'))
  assert.equal((await api('manager', `report?course=${c.id}`)).rows.find(row => row.assignment === mine).quizAttempts, 1)
  // The practical has no clock: its evidence is taken after the quiz's time ran out, and its attempt carries no timing.
  const practical = await api('learner', 'practical.submit', { assignment: mine, evidence: 'Locked out the slicer with the assessor watching' })
  assert.equal((await api('learner', `attempts/${practical.id}`)).timing, null)
  // A manager grants extra time only to people in their teams; of two accommodations on the course the newest wins.
  assert.equal((await api('manager', 'accommodation.grant', { learner: ids.other, course: c.id, kind: 'percent', amount: 50 }, 403)).error, 'learner_outside_your_team')
  await api('manager', 'accommodation.grant', { learner: ids.learner, course: c.id, kind: 'percent', amount: 50 })
  await api('manager', 'accommodation.grant', { learner: ids.learner, course: c.id, kind: 'minutes', amount: 3, note: 'Replaces the 50%' })
  const retry = (await api('learner', `assignments/${mine}`)).quiz
  assert.deepEqual([retry.extraMinutes, retry.accommodation.kind, retry.accommodation.amount, retry.accommodation.grantedBy], [3, 'minutes', 3, ids.manager])
  const again = await api('learner', 'quiz.start', { assignment: mine })
  assert.equal(again.deadline - again.startedAt, 13 * MINUTE)
  // The second learner's accommodation: a 15-minute limit, recorded with who granted it, shown on the attempt.
  const theirs = await learn('assessor', second)
  assert.deepEqual([theirs.extraMinutes, theirs.accommodation.kind, theirs.accommodation.amount, theirs.accommodation.grantedBy], [5, 'percent', 50, ids.owner])
  const start = await api('assessor', 'quiz.start', { assignment: second })
  assert.equal(start.deadline - start.startedAt, 15 * MINUTE)
  const submitted = await api('assessor', 'quiz.submit', { assignment: second, [`q_${q1}`]: ['0'], [`q_${q2}`]: ['0'] })
  assert.ok(submitted.passed)
  const timing = (await api('manager', `attempts/${submitted.id}`)).timing
  assert.deepEqual([timing.timeLimitMinutes, timing.extraMinutes, timing.closeReason, timing.accommodation.grantedBy, timing.accommodation.note], [10, 5, 'submitted', ids.owner, 'LEARN-011 extra time'])
  const page = await (await h.raw(`/app/attempts/${submitted.id}`, { cookie: cookies.manager })).text()
  assert.ok(page.includes('50% extra time') && page.includes(`granted by ${timing.accommodation.grantedByName}`))
  return { started, expired: detail, accommodated: timing }
}
