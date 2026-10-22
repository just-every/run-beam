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

// AUTHOR-009's local authored/reviewed/web doors; real provider delivery remains explicitly unconnected.
export async function prepareMicrolearning(f, suffix = '') {
  const { file } = await import('./harness.mjs'), { syntheticImage } = await import('./fixtures.mjs')
  const source = await f.api('author', 'source.create', { title: `Vaccine SOP ${suffix}`, reviewer: f.ids.reviewer, licence: 'owned', licenceEvidence: 'Employer-authored procedure', provenance: 'Operations manual', file: file('sop.txt', 'Keep vaccines between 2 and 8 degrees. Inspect the thermometer before use.') })
  const image = await f.api('author', 'source.create', { title: 'Thermometer placement', reviewer: f.ids.reviewer, licence: 'owned', licenceEvidence: 'Original synthetic diagram', provenance: 'Operations diagram', file: file('synthetic-beam-1.png', syntheticImage) })
  const c = await f.api('author', 'course.create', { title: `Five-day vaccine safety ${suffix}`, reviewer: f.ids.reviewer })
  let version = 1
  for (let day = 1; day <= 5; day++) version = (await f.api('author', 'course.lesson', { course: c.id, draftVersion: version, title: `Day ${day}: vaccine procedure`, body: `Step ${day}: Keep vaccines between 2 and 8 degrees. Inspect the thermometer before use.`, sources: [source.versionId] })).draftVersion
  const seen = await f.api('author', `courses/${c.id}`)
  version = (await f.api('author', 'course.block', { course: c.id, draftVersion: version, lesson: seen.draft.lessons[0].id, kind: 'image', text: 'Thermometer placement diagram', source: image.versionId })).draftVersion
  version = (await f.api('author', 'course.question', { course: c.id, draftVersion: version, prompt: 'Safe vaccine temperature?', choices: '5 degrees\n20 degrees', correct: '1' })).draftVersion
  version = (await f.api('author', 'course.assessment', { course: c.id, draftVersion: version, passPercent: 100, maxAttempts: 3 })).draftVersion
  const draft = (await f.api('author', `courses/${c.id}`)).draft
  const sequence = { workStart: 0, workEnd: 24, workDays: [0,1,2,3,4,5,6], days: draft.lessons.map(lesson => ({ lesson: lesson.id, prompt: 'Which temperature is safe?', choices: [{ label: '5 degrees', feedback: 'Yes. Continue at the next scheduled release.', next: 'continue' }, { label: '20 degrees', feedback: 'Review the procedure: use 2 to 8 degrees, then try again.', next: 'retry' }] })) }
  const saved = await f.api('author', 'course.sequence', { course: c.id, draftVersion: version, sequence })
  return { ...c, draftVersion: saved.draftVersion, sequence, source, image }
}
export async function microlearningCheck(f) {
  const c = await prepareMicrolearning(f)
  const before = await f.api('author', `courses/${c.id}`)
  await f.api('learner', 'course.sequence', { course: c.id, draftVersion: c.draftVersion, sequence: c.sequence }, 403)
  await f.api('author', 'course.sequence', { course: c.id, draftVersion: c.draftVersion, sequence: { ...c.sequence, days: c.sequence.days.slice(0,4) } }, 422)
  assert.deepEqual((await f.api('author', `courses/${c.id}`)).draft, before.draft)
  for (const channel of ['web','sms','teams']) {
    const response = await f.h.raw(`/app/courses/${c.id}/sequence?channel=${channel}`, { cookie: f.cookies.author })
    const text = await response.text(); assert.equal(response.status, 200)
    assert.ok(text.includes('No message is sent') && text.includes('Required assessment') && text.includes(c.source.versionId))
  }
  const revision = (await f.api('author', 'course.submit', { course: c.id, draftVersion: c.draftVersion })).id
  await f.api('learner', 'sequence-preview/' + c.id, undefined, 403)
  const reviewed = await f.api('reviewer', `sequence-preview/${c.id}?revision=${revision}`)
  assert.equal(reviewed.program.days.length, 5); assert.equal(reviewed.assessmentRequired, true)
  await f.publish(revision)
  const assignment = await f.assign(c), view = () => f.api('learner', `sequences/${assignment}`)
  await f.api('other', `sequences/${assignment}`, undefined, 404)
  let state = await view()
  assert.equal(state.revision, revision); assert.equal(state.available, true)
  assert.deepEqual(state.schedule.map(slot => slot.day), [1,2,3,4,5])
  assert.equal(new Date(state.schedule[1].opensAt).toISOString().slice(11), '00:00:00.000Z')
  assert.equal(state.schedule[1].opensAt - state.schedule[2].opensAt, -86400000)
  const send = (day, choice, version, status = 200) => f.api('learner', 'sequence.answer', { assignment, day, choice, version }, status)
  await send(2, 0, state.version, 409)
  const wrong = await send(1, 1, state.version)
  assert.equal(wrong.next, 'retry'); assert.ok(wrong.feedback.includes('try again'))
  assert.equal((await f.view(assignment)).lessons[0].completed, false)
  state = await view()
  await f.api('manager', 'sequence.pause', { assignment, version: state.version, pause: true }, 404)
  await f.api('learner', 'sequence.pause', { assignment, version: state.version, pause: true })
  state = await view(); assert.equal(state.paused, true)
  await send(1, 0, state.version, 409)
  await f.api('learner', 'sequence.pause', { assignment, version: state.version, pause: false })
  state = await view(); assert.equal(state.paused, false)
  const good = await send(1, 0, state.version)
  assert.equal(good.next, 'continue'); assert.equal(good.revision, revision)
  assert.equal((await f.view(assignment)).lessons[0].completed, true)
  state = await view(); assert.equal(state.day, 2); assert.equal(state.available, false)
  await send(2, 0, state.version, 409)
  await send(1, 0, state.version, 409)
  // Use stored enrollment instants, like the existing access-window journeys; application code has no fake clock.
  for (let day = 2; day <= 5; day++) {
    const start = new Date(); start.setUTCHours(0, 0, 0, 0)
    await f.h.db.prepare('UPDATE beam_assignments SET assigned_at=? WHERE id=?').bind(start.getTime() - (day - 1) * 86400000, assignment).run()
    state = await view(); assert.equal(state.day, day); assert.equal(state.available, true)
    await send(day, 0, state.version)
    assert.equal((await f.view(assignment)).completion, null, 'formative branches never satisfy the required quiz')
  }
  state = await view(); assert.equal(state.day, 0); assert.equal(state.advanced.length, 5)
  assert.equal(state.answers.filter(a => a.next === 'continue').length, 5)
  const learning = await f.view(assignment), question = learning.quiz.questions[0]
  await f.api('learner', 'quiz.submit', { assignment, [`q_${question.id}`]: ['0'] })
  assert.equal((await f.view(assignment)).completion.revision, revision)
  assert.equal((await f.api('manager', `sequences/${assignment}`)).answers.length, 0, 'no new private-reply exposure to managers')
  // Publication freezes schedule/branches/source ids; editing the draft cannot alter an existing assignment.
  const edited = await f.api('author', 'course.sequence', { course: c.id, draftVersion: c.draftVersion, sequence: { ...c.sequence, workStart: 9, workEnd: 17 } })
  assert.equal((await view()).program.workStart, 0)
  const restored = await f.api('author', 'course.restore', { course: c.id, draftVersion: edited.draftVersion, revision })
  assert.deepEqual(restored.draft.sequence, reviewed.program)
  const exported = await f.h.raw('/app/data-export.json', { cookie: f.cookies.owner }).then(r => r.json())
  assert.ok(exported.records.beam_sequence_answers.rows.some(row => row.assignment_id === assignment && row.course_revision_id === revision))
  const assigned = await f.assign(c)
  // Move the new enrollment to tomorrow: even a valid learner cannot request an unreleased module.
  await f.h.db.prepare('UPDATE beam_assignments SET assigned_at=? WHERE id=?').bind(Date.now() + 86400000, assigned).run()
  const future = await f.api('learner', `sequences/${assigned}`)
  assert.equal(future.available, false)
  await f.api('learner', 'sequence.answer', { assignment: assigned, day: 1, choice: 0, version: future.version }, 409)
  return { ...c, assignment, revision }
}
