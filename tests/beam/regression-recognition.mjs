import assert from 'node:assert/strict'

// LEARN-013: the owner sets points and two badges; nobody is on a leaderboard before answering the one-time notice; a learning administrator of the team's unit switches on levels and
// an activity leaderboard for the team and for a cohort (an audience) and sets a team challenge (a learner and an outside administrator are refused). A learner
// earns the course badge and level 2 through a real completion and the leaderboard carries its activity label;
// practising a scenario, a failed quiz attempt and every recognition setting change nothing in attempts, completions,
// completion rules or the practice run; opting out removes the learner from the leaderboard and the challenge count.
export async function recognitionCheck(f) {
  const { api, h, cookies, ids, course, publish, request } = f
  const person = async (name) => {
    const id = (await api('owner', 'person.invite', { email: `${name}@example.test`, name, roles: ['learner'] })).id
    return { id, cookie: await h.signIn(`${name}@example.test`, { requested: true }) }
  }
  const [rosa, tim, ula, vic] = [await person('rosa'), await person('tim'), await person('ula'), await person('vic')]
  const as = (who, path, body, status) => h.api(path, who.cookie, body, status)
  const team = (await api('owner', 'team.create', { name: 'Recognition crew' })).id
  await api('owner', 'team.members', { team, members: [rosa.id, tim.id] })
  const unit = (await api('owner', 'unit.create', { name: 'Recognition unit', teams: [team] })).id
  const otherUnit = (await api('owner', 'unit.create', { name: 'Elsewhere unit', teams: [] })).id
  await api('owner', 'admin.grant', { member: ula.id, unit })
  await api('owner', 'admin.grant', { member: vic.id, unit: otherUnit })

  // A course with one lesson, and one with a lesson and a one-question quiz.
  const first = await course('Recognition basics')
  const author = await api('author', 'course.create', { title: 'Recognition quiz', reviewer: ids.reviewer })
  let draftVersion = (await api('author', 'course.lesson', { course: author.id, draftVersion: author.draftVersion, title: 'Rule', body: 'Lock the door.', sources: [] })).draftVersion
  draftVersion = (await api('author', 'course.question', { course: author.id, draftVersion, prompt: 'Lock the door?', choices: 'Yes\nNo', correct: '1' })).draftVersion
  draftVersion = (await api('author', 'course.assessment', { course: author.id, draftVersion, passPercent: 100, maxAttempts: 3 })).draftVersion
  const quizRevision = (await api('author', 'course.submit', { course: author.id, draftVersion })).id
  await publish(quizRevision)
  const quiz = { id: author.id, revision: quizRevision }

  // Configuration: the owner alone sets points and badges; team settings belong to the owner and the team's unit administrator.
  await as(rosa, 'recognition.points', { lessonPoints: 5, coursePoints: 20 }, 403)
  await api('owner', 'recognition.points', { lessonPoints: 5, coursePoints: 20 })
  const badge = (await api('owner', 'recognition.badge', { name: 'Basics done', description: 'Finished the basics course.', milestone: 'course', course: first.id })).id
  await api('owner', 'recognition.badge', { name: 'Two courses', description: 'Finished two different courses.', milestone: 'courses', courses: 2 })
  await as(rosa, 'recognition.group', { group: team, levels: 'on', levelPoints: 20, leaderboard: 'on' }, 403)
  await as(vic, 'recognition.group', { group: team, levels: 'on', levelPoints: 20, leaderboard: 'on' }, 403)
  await as(ula, 'recognition.group', { group: team, levels: 'on', levelPoints: 20, leaderboard: 'on' })
  const day = n => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
  await as(vic, 'recognition.challenge', { group: team, name: 'Week of learning', goal: 2, startsOn: day(-1), endsOn: day(1) }, 403)
  await as(ula, 'recognition.challenge', { group: team, name: 'Week of learning', goal: 2, startsOn: day(-1), endsOn: day(1) })
  assert.ok((await api('owner', 'audit?category=recognition')).events.some(event => event.action === 'recognition.group' && event.subject === team))

  // A cohort: Ula's audience of the crew's team, with its own leaderboard (no levels).
  const cohort = (await as(ula, 'audience.save', { name: 'Recognition cohort', teams: [team] })).id
  await as(ula, 'audience.preview', { audience: cohort })
  await as(ula, 'audience.state', { audience: cohort, state: 'active' })
  await as(vic, 'recognition.group', { kind: 'audience', group: cohort, leaderboard: 'on' }, 403)
  await as(ula, 'recognition.group', { kind: 'audience', group: cohort, leaderboard: 'on' })

  const view = who => as(who, 'recognition')
  // The one-time notice: until Rosa and Tim answer it they are on no leaderboard; then they are.
  assert.deepEqual([(await view(rosa)).me.noticeDue, (await view(tim)).groups.find(item => item.id === team).leaderboard], [true, []])
  assert.match(await h.raw('/app/learning', { cookie: rosa.cookie }).then(response => response.text()), /recognition\.visibility/)
  for (const who of [rosa, tim]) await as(who, 'recognition.visibility', { visible: 'yes' })
  assert.equal((await view(rosa)).me.noticeDue, false)
  let mine = (await view(rosa)).me
  assert.deepEqual([mine.points, mine.badges, mine.levels.map(item => item.level)], [0, [], [1]])

  // Rosa reads the quiz course's lesson, fails its quiz once and practises a reviewer-deployed scenario on it: the
  // lesson gives 5 points; the failed attempt and the practice give nothing.
  const assignment = async (c) => (await api('owner', 'assignment.create', { course: c.id, learners: [rosa.id], dueDate: '2030-10-01', dueTime: '17:00', timezone: 'UTC' })).created[0]
  const quizAssignment = await assignment(quiz)
  for (const lesson of (await as(rosa, `assignments/${quizAssignment}`)).lessons) await as(rosa, 'lesson.complete', { assignment: quizAssignment, lesson: lesson.id })
  const [question] = (await as(rosa, `assignments/${quizAssignment}`)).quiz.questions
  assert.equal((await as(rosa, 'quiz.submit', { assignment: quizAssignment, [`q_${question.id}`]: ['1'] })).passed, false)
  const token = (await request('/api/beam/agent.issue', { role: 'author', body: { expiresInSeconds: 300 } })).data.token
  const steps = [{ id: 'door', situation: 'Someone knocks before opening.', choices: [{ label: 'Keep it locked', feedback: 'Right.', next: null, sources: [] }, { label: 'Open it', feedback: 'Not yet.', next: null, sources: [] }] }]
  const proposed = (await request('/api/beam/agent.propose', { token, body: { kind: 'scenario', title: 'Early knock', agent: 'claude-code', reasons: ['Practise the door.'], inputs: [], excluded: [], payload: { course: quiz.id, courseRevision: quiz.revision, title: 'Early knock', rubric: 'Door stays locked.', steps } } })).data
  const scenario = (await api('reviewer', 'agent.decide', { proposal: proposed.id, decision: 'approve', sha256: proposed.sha256 })).result.scenario
  await as(rosa, 'practice.choose', { scenario, step: 'door', choice: 1 })
  mine = (await view(rosa)).me
  assert.deepEqual([mine.points, mine.lessons, mine.courses, mine.badges], [5, 1, 0, []])

  // A real completion earns the course badge, 30 points and level 2 (one level every 20 points).
  const firstAssignment = await assignment(first)
  for (const lesson of (await as(rosa, `assignments/${firstAssignment}`)).lessons) await as(rosa, 'lesson.complete', { assignment: firstAssignment, lesson: lesson.id })
  mine = (await view(rosa)).me
  assert.deepEqual([mine.points, mine.courses, mine.badges.map(item => item.id), mine.levels.map(item => item.level)], [30, 1, [badge], [2]])

  // The leaderboard counts activity, says so, and carries Rosa's points and level; the challenge counts her completion.
  const board = (await view(tim)).groups.find(item => item.id === team)
  assert.ok(board.leaderboardLabel)
  assert.deepEqual(board.leaderboard.map(row => [row.member, row.points, row.level, row.badges]), [[rosa.id, 30, 2, 1], [tim.id, 0, 1, 0]])
  assert.ok(board.leaderboard.every(row => !Object.keys(row).some(key => /score|attempt|practice|answer/i.test(key))), 'no scores, attempts, practice or answers on the leaderboard')
  assert.deepEqual(board.challenges.map(item => [item.completions, item.goal, item.met, item.state]), [[1, 2, false, 'running']])
  const cohortBoard = (await view(tim)).groups.find(item => item.kind === 'audience' && item.id === cohort)
  assert.deepEqual([cohortBoard.leaderboardLabel, cohortBoard.leaderboard.map(row => [row.member, row.points, row.level])], [board.leaderboardLabel, [[rosa.id, 30, null], [tim.id, 0, null]]])
  const html = await h.raw('/app/recognition', { cookie: tim.cookie }).then(response => response.text())
  assert.ok(html.includes(board.leaderboardLabel.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))) && html.includes('rosa'))
  assert.match(await h.raw('/app/learning', { cookie: rosa.cookie }).then(response => response.text()), /href="\/app\/recognition"/)

  // Recognition changes nothing it reads: attempts, completions, the revision's completion rules and the practice run.
  const snapshot = async () => ({ record: await api('owner', `records/${rosa.id}`), attempts: await as(rosa, `assignments/${quizAssignment}`), revision: await api('reviewer', `revisions/${quiz.revision}`), practice: await as(rosa, `practice/${scenario}`) })
  const before = await snapshot()
  await as(rosa, 'recognition.visibility', { visible: 'no' })
  await api('owner', 'recognition.points', { lessonPoints: 1, coursePoints: 1 })
  await api('owner', 'recognition.badge.retire', { badge })
  await as(ula, 'recognition.group', { group: team, levelPoints: 50 })
  assert.deepEqual(await snapshot(), before)

  // Opted out, Rosa is off the leaderboard and out of the challenge count; she still sees her own recognition.
  const after = (await view(tim)).groups.find(item => item.id === team)
  assert.equal(after.leaderboard, null, 'the leaderboard was switched off with the levels change')
  await as(ula, 'recognition.group', { group: team, levels: 'on', levelPoints: 20, leaderboard: 'on' })
  const again = (await view(tim)).groups.find(item => item.id === team)
  assert.deepEqual([again.leaderboard.map(row => row.member), again.challenges[0].completions], [[tim.id], 0])
  assert.deepEqual((await view(tim)).groups.find(item => item.id === cohort).leaderboard.map(row => row.member), [tim.id])
  mine = (await view(rosa)).me
  assert.deepEqual([mine.visible, mine.points, mine.badges], [false, 3, []])
  await as(rosa, 'recognition.visibility', { visible: 'yes' })
  assert.deepEqual((await view(tim)).groups.find(item => item.id === team).leaderboard.map(row => row.member), [rosa.id, tim.id])
}
