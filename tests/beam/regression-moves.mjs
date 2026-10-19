import assert from 'node:assert/strict'

// AUTHOR-010: a course with two lessons, a quiz and a practical. One learner is mid-course, one has passed the quiz with
// the practical waiting, one has finished. A typo fix moved to the new revision: the reviewer's preview shows who moves
// and what reopens; the mid-course learner keeps their place, the quiz pass and the waiting practical carry over and its
// acceptance completes the new revision. Then an added lesson and a changed quiz, marked material: only the new lesson
// reopens, the unfinished practical is voided and kept in history, earlier attempts no longer count, and the finished
// learner keeps their completion and certificate and gets a new assignment.
export async function movesCheck(f) {
  const { api, h, cookies, ids } = f
  const page = async (path, role) => (await h.raw(path, { cookie: cookies[role] })).text()
  const c = await api('author', 'course.create', { title: 'Cold room', reviewer: ids.reviewer })
  let draftVersion = c.draftVersion
  const edit = async (action, fields) => { draftVersion = (await api('author', action, { course: c.id, draftVersion, ...fields })).draftVersion }
  await edit('course.lesson', { title: 'Temperatures', body: 'Keep the cold room at 1-4 C.', sources: [] })
  await edit('course.lesson', { title: 'Door seals', body: 'Check the seals evry morning.', sources: [] })
  await edit('course.question', { prompt: 'Highest safe temperature?', choices: '4 C\n8 C', correct: '1' })
  await edit('course.assessment', { passPercent: 100, maxAttempts: 3, practicalInstructions: 'Check a door seal with your assessor watching.', assessor: ids.other })
  const submit = async () => (await api('author', 'course.submit', { course: c.id, draftVersion })).id
  const publish = async (revision, fields) => assert.equal((await h.submit('revision.decide', cookies.reviewer, { revision, decision: 'publish', ...fields })).searchParams.get('error'), null)
  const first = await submit()
  await publish(first, { reassignment: 'none' })
  await api('owner', 'assignment.create', { course: c.id, learners: [ids.learner, ids.author, ids.assessor], dueDate: '2030-10-01', dueTime: '17:00', timezone: 'UTC' })
  const open = async role => (await api(role, 'records/me')).assignments.find(row => row.course === c.id && row.status === 'open')?.id
  const view = async role => api(role, `assignments/${await open(role)}`)
  const done = async (role, count) => { const v = await view(role); for (const lesson of v.lessons.slice(0, count)) await api(role, 'lesson.complete', { assignment: v.assignment.id, lesson: lesson.id }) }
  const pass = async role => { const v = await view(role); return api(role, 'quiz.submit', { assignment: v.assignment.id, [`q_${v.quiz.questions[0].id}`]: ['0'] }) }

  // Mid-course (one lesson), quiz passed with the practical waiting, and finished.
  await done('learner', 1)
  await done('author', 2)
  await pass('author')
  const waiting = (await api('author', 'practical.submit', { assignment: await open('author'), evidence: 'Checked the seal on door 2' })).id
  await done('assessor', 2)
  await pass('assessor')
  const finishedAttempt = (await api('assessor', 'practical.submit', { assignment: await open('assessor'), evidence: 'Checked all seals' })).id
  await api('other', 'practical.decide', { attempt: finishedAttempt, decision: 'accepted', note: 'Good' })
  const finished = (await api('assessor', 'records/me')).completions.find(row => row.course === c.id)

  // A typo fix: the preview shows who moves and what reopens; publishing moves them.
  await edit('course.lesson', { lesson: (await api('author', `courses/${c.id}`)).draft.lessons[1].id, title: 'Door seals', body: 'Check the seals every morning.', sources: [] })
  const second = await submit()
  let preview = await api('reviewer', `revisions/${second}/moves`)
  const planned = name => preview.moves.find(row => row.learnerName === name)
  assert.deepEqual([planned('learner').kept, planned('learner').reopened, planned('learner').assessment], [['Temperatures'], ['Door seals'], 'unchanged'])
  assert.deepEqual([planned('author').attemptsCarried, preview.finished.map(row => row.learnerName)], [2, ['assessor']])
  await api('learner', `revisions/${second}/moves`, undefined, 403)
  assert.ok((await page(`/app/revisions/${second}`, 'reviewer')).includes('If you move open assignments'))
  await publish(second, { reassignment: 'open' })

  // The mid-course learner keeps their place on the new revision; the move records both revisions, who and when.
  let moved = await view('learner')
  assert.deepEqual([moved.assignment.revision, moved.lessons.map(lesson => lesson.completed), moved.resumeLesson], [second, [true, false], moved.lessons[1].id])
  assert.deepEqual([moved.moves[0].fromRevision, moved.moves[0].toRevision, moved.moves[0].movedByName], [1, 2, 'reviewer'])
  assert.ok((await page(`/app/learn/${moved.assignment.id}`, 'learner')).includes('Revision 1 to revision 2'))
  // The quiz pass and the waiting practical carry over; accepting it completes revision 2.
  moved = await view('author')
  assert.deepEqual([moved.quiz.passed, moved.practical.pending, moved.lessons.map(lesson => lesson.completed)], [true, true, [true, false]])
  await done('author', 2)
  const accepted = await api('other', 'practical.decide', { attempt: waiting, decision: 'accepted', note: 'Seal checked properly' })
  const completion = (await api('author', 'records/me')).completions.find(row => row.course === c.id)
  assert.deepEqual([!!accepted.completion, completion.revision, completion.evidence.practicalAttempt], [true, second, waiting])
  assert.equal((await api('assessor', 'records/me')).assignments.filter(row => row.course === c.id && row.status === 'open').length, 0)

  // A material change: a new lesson and a changed quiz. The learner submits a practical first, which the move voids.
  await done('learner', 2)
  await edit('course.lesson', { title: 'Alarms', body: 'Answer a cold-room alarm within 10 minutes.', sources: [] })
  await edit('course.question', { prompt: 'Who answers an alarm?', choices: 'Whoever is on shift\nNobody', correct: '1' })
  const third = await submit()
  await pass('learner')
  const voided = (await api('learner', 'practical.submit', { assignment: await open('learner'), evidence: 'Seal on door 1' })).id
  preview = await api('reviewer', `revisions/${third}/moves`)
  assert.deepEqual([planned('learner').reopened, planned('learner').assessment, planned('learner').attemptsVoided], [['Alarms'], 'changed', 1])
  await publish(third, { reassignment: 'everyone', dueDays: 21 })
  moved = await view('learner')
  assert.deepEqual([moved.lessons.map(lesson => lesson.completed), moved.quiz.passed, moved.practical.pending], [[true, true, false], false, false])
  assert.equal((await api('other', 'practical.decide', { attempt: voided, decision: 'accepted', note: 'Too late' }, 409)).error, 'attempt_closed_by_reset')
  assert.equal((await api('learner', `attempts/${voided}`)).evidence, 'Seal on door 1')
  assert.ok((await api('learner', 'transcripts/me')).entries.some(entry => entry.kind === 'moved to a new revision' && entry.revision === 2))
  // The finished learner keeps their completion and certificate and has a new assignment on revision 3.
  const after = await api('assessor', 'records/me')
  assert.deepEqual(after.completions.find(row => row.id === finished.id), finished)
  assert.equal((await api('assessor', `certificates/${finished.certificate}`)).revision, 1)
  assert.equal((await view('assessor')).assignment.revision, third)
}
