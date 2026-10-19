import assert from 'node:assert/strict'

// AUTHOR-003: two coauthors edit from the same draft. A save to a different lesson merges; a save to the lesson the
// other changed becomes a conflict that a coauthor resolves with a merged text. Threads on a question and a change
// request on a lesson are added, answered and resolved; learners cannot comment. A learner reports a broken lesson:
// it reaches the owner's content queue and the responsible expert with the learner's name, other authors without it,
// never with attempts; the owner closes it and the learner sees the outcome.
export async function collabCheck(f) {
  const { api, h, cookies, ids, publish } = f
  const page = async (path, role) => (await h.raw(path, { cookie: cookies[role] })).text()
  const c = await api('author', 'course.create', { title: 'Delivery checks', reviewer: ids.reviewer })
  let v = c.draftVersion
  v = (await api('author', 'course.lesson', { course: c.id, draftVersion: v, title: 'Receiving', body: 'Check the van temperature.', sources: [] })).draftVersion
  v = (await api('author', 'course.lesson', { course: c.id, draftVersion: v, title: 'Labels', body: 'Label every box.', sources: [] })).draftVersion
  v = (await api('author', 'course.question', { course: c.id, draftVersion: v, prompt: 'Highest van temperature?', choices: '5 C\n10 C', correct: '1' })).draftVersion
  v = (await api('author', 'course.assessment', { course: c.id, draftVersion: v, passPercent: 100, maxAttempts: 2 })).draftVersion

  // Both coauthors open the same draft.
  const seen = await api('reviewer', `courses/${c.id}`)
  const [receiving, labels] = seen.draft.lessons
  const first = await api('author', 'course.lesson', { course: c.id, draftVersion: seen.draftVersion, lesson: receiving.id, base: seen.lessonBases[receiving.id], title: 'Receiving', body: 'Check the van temperature and the seal.', sources: [] })
  // A save from the older draft to another lesson merges.
  const merged = await api('reviewer', 'course.lesson', { course: c.id, draftVersion: seen.draftVersion, lesson: labels.id, base: seen.lessonBases[labels.id], title: 'Labels', body: 'Label every box with the date.', sources: [] })
  assert.equal(merged.draftVersion, first.draftVersion + 1)
  assert.deepEqual(merged.draft.lessons.map(lesson => lesson.body), ['Check the van temperature and the seal.', 'Label every box with the date.'])
  // A save from the older draft to the lesson the other changed is kept as a conflict.
  const clash = await api('reviewer', 'course.lesson', { course: c.id, draftVersion: seen.draftVersion, lesson: receiving.id, base: seen.lessonBases[receiving.id], title: 'Receiving', body: 'Check the van temperature and the delivery note.', sources: [] }, 409)
  assert.equal(clash.error, 'lesson_conflict')
  const html = await page(`/app/courses/${c.id}`, 'author')
  assert.ok(html.includes('Conflicting edits') && html.includes('Check the van temperature and the seal.') && html.includes('Check the van temperature and the delivery note.'))
  const current = (await api('author', `courses/${c.id}`)).draftVersion
  assert.equal((await h.submit('conflict.resolve', cookies.author, { course: c.id, draftVersion: String(current), conflict: clash.detail.conflict, choice: 'merged', title: 'Receiving', body: 'Check the van temperature, the seal and the delivery note.' }, `/app/courses/${c.id}`)).searchParams.get('error'), null)
  let collab = await api('author', `courses/${c.id}/collaboration`)
  assert.deepEqual([collab.conflicts[0].resolution, collab.conflicts[0].resolvedByName], ['merged', 'author'])
  assert.equal((await api('author', `courses/${c.id}`)).draft.lessons[0].body, 'Check the van temperature, the seal and the delivery note.')

  // Threads: a question comment answered and resolved; a change request on a lesson; learners cannot comment.
  const question = seen.draft.questions[0].id
  const thread = (await api('reviewer', 'course.comment', { course: c.id, targetKind: 'question', target: question, body: 'Should 8 C be a choice too?' })).id
  await h.submit('course.comment', cookies.author, { course: c.id, thread, body: 'Added it to the next draft.' }, `/app/courses/${c.id}`)
  await api('learner', 'course.comment', { course: c.id, targetKind: 'question', target: question, body: 'Hi' }, 403)
  assert.equal((await h.submit('course.thread.resolve', cookies.author, { thread }, `/app/courses/${c.id}`)).searchParams.get('error'), null)
  await api('author', 'course.comment', { course: c.id, thread, body: 'Late reply' }, 409)
  await api('reviewer', 'course.comment', { course: c.id, targetKind: 'lesson', target: labels.id, kind: 'change', body: 'Say which date format.' })
  collab = await api('reviewer', `courses/${c.id}/collaboration`)
  const resolved = collab.threads.find(row => row.id === thread)
  assert.deepEqual([resolved.replies.map(reply => reply.body), resolved.resolvedByName], [['Added it to the next draft.'], 'author'])
  assert.ok((await page(`/app/courses/${c.id}`, 'author')).includes('Change requested'))

  // Learner feedback: a broken-content report on a lesson reaches the queue; names only for the responsible people.
  const revision = (await api('author', 'course.submit', { course: c.id, draftVersion: (await api('author', `courses/${c.id}`)).draftVersion })).id
  await publish(revision)
  const [assignment] = (await api('owner', 'assignment.create', { course: c.id, learners: [ids.learner], dueDate: '2030-10-01', dueTime: '17:00', timezone: 'UTC' })).created
  const lesson = (await api('learner', `assignments/${assignment}`)).lessons[0].id
  assert.ok((await page(`/app/learn/${assignment}/lessons/${lesson}`, 'learner')).includes('Tell us about this lesson'))
  assert.equal((await h.submit('feedback.send', cookies.learner, { assignment, lesson, kind: 'broken', body: 'The temperature chart does not load' }, `/app/learn/${assignment}/lessons/${lesson}`)).searchParams.get('error'), null)
  await api('assessor', 'feedback.send', { assignment, kind: 'feedback', body: 'Not mine' }, 404)
  const item = role => api(role, 'content-queue').then(list => list.find(row => row.course === c.id))
  const [owner, expert, coauthor] = [await item('owner'), await item('reviewer'), await item('author')]
  assert.deepEqual([owner.learnerName, owner.lessonTitle, owner.kind, expert.learnerName, expert.canClose], ['learner', 'Receiving', 'broken', 'learner', true])
  assert.deepEqual([coauthor.body, 'learnerName' in coauthor, coauthor.canClose], ['The temperature chart does not load', false, false])
  for (const shown of [owner, expert, coauthor]) assert.ok(!('attempts' in shown) && !('score' in shown))
  assert.ok((await page('/app/courses', 'owner')).includes('Content feedback'))
  await api('author', 'feedback.close', { feedback: owner.id, note: 'Nope' }, 403)
  assert.equal((await h.submit('feedback.close', cookies.owner, { feedback: owner.id, note: 'Replaced the chart with a table' }, '/app/courses')).searchParams.get('error'), null)
  assert.ok((await page(`/app/learn/${assignment}`, 'learner')).includes('closed: Replaced the chart with a table'))
}
