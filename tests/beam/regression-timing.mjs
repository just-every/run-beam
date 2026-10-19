import assert from 'node:assert/strict'

// LEARN-018: a 10-minute quiz runs on the server's clock; at expiry only saved answers score and later answers are
// refused through the form and JSON doors; a manager's 50% accommodation gives a second learner 15 minutes.
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
  await edit('course.assessment', { passPercent: 100, maxAttempts: 2, timeLimitMinutes: 10 })
  await publish((await api('author', 'course.submit', { course: c.id, draftVersion })).id)
  await f.team('Timed team', [ids.learner, ids.assessor])
  await api('learner', 'accommodation.grant', { learner: ids.assessor, course: c.id, kind: 'percent', amount: 50 }, 403)
  const granted = await h.submit('accommodation.grant', cookies.manager, { learner: ids.assessor, course: c.id, kind: 'percent', amount: '50', note: 'LEARN-011 extra time' }, `/app/records/${ids.assessor}`)
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
  // The second learner's accommodation: a 15-minute limit, recorded with who granted it, shown on the attempt.
  const theirs = await learn('assessor', second)
  assert.deepEqual([theirs.extraMinutes, theirs.accommodation.kind, theirs.accommodation.amount, theirs.accommodation.grantedBy], [5, 'percent', 50, ids.manager])
  const start = await api('assessor', 'quiz.start', { assignment: second })
  assert.equal(start.deadline - start.startedAt, 15 * MINUTE)
  const submitted = await api('assessor', 'quiz.submit', { assignment: second, [`q_${q1}`]: ['0'], [`q_${q2}`]: ['0'] })
  assert.ok(submitted.passed && submitted.completion)
  const timing = (await api('manager', `attempts/${submitted.id}`)).timing
  assert.deepEqual([timing.timeLimitMinutes, timing.extraMinutes, timing.closeReason, timing.accommodation.grantedBy, timing.accommodation.note], [10, 5, 'submitted', ids.manager, 'LEARN-011 extra time'])
  const page = await (await h.raw(`/app/attempts/${submitted.id}`, { cookie: cookies.manager })).text()
  assert.ok(page.includes('50% extra time') && page.includes('granted by manager'))
  return { started, expired: detail, accommodated: timing }
}
