import assert from 'node:assert/strict'

// LEARN-015: an author publishes a fill-in-the-blank, an ordering and a matching question through the form and JSON
// doors; the learner's page shows a labelled control for every blank, position and pair without the answers; an
// attempt with accepted variants and one wrong order scores 2 of 3, an all-correct attempt 3 of 3, and each attempt
// keeps its responses, per-question result and scoring rule.
export async function questionTypesCheck(f) {
  const { api, h, cookies, ids, publish } = f
  const c = await api('author', 'course.create', { title: 'Kitchen hygiene check', reviewer: ids.reviewer })
  let draftVersion = c.draftVersion
  const edit = async (action, fields) => { draftVersion = (await api('author', action, { course: c.id, draftVersion, ...fields })).draftVersion }
  await edit('course.lesson', { title: 'Cold chain', body: 'Fridges stay at 5 °C or below, freezers at -18 °C or below.', sources: [] })
  // Fill in the blank through the author's form, with variants and case ignored.
  const saved = await h.submit('course.question', cookies.author, { course: c.id, draftVersion: String(draftVersion), kind: 'blank', prompt: 'Fridges stay at or below ___ °C and freezers at or below ___ °C.', answers: '5 | five\n-18 | minus 18', ignoreCase: '1' }, `/app/courses/${c.id}`)
  assert.equal(saved.searchParams.get('error'), null)
  draftVersion = (await api('author', `courses/${c.id}`)).draftVersion
  await edit('course.question', { kind: 'order', prompt: 'Put the dishwashing steps in order.', items: 'Scrape\nWash\nRinse\nSanitize' })
  await edit('course.question', { kind: 'match', prompt: 'Match each board colour to its food.', pairs: 'Red = Raw meat\nGreen = Salad\nBlue = Fish' })
  assert.equal((await api('author', 'course.question', { course: c.id, draftVersion, kind: 'match', prompt: 'Broken', pairs: 'Red = Raw meat' }, 400)).error, 'invalid_question')
  assert.equal((await api('author', 'course.question', { course: c.id, draftVersion, kind: 'order', prompt: 'Broken', items: 'Same\nSame' }, 400)).error, 'invalid_question')
  await edit('course.assessment', { passPercent: 100, maxAttempts: 3 })
  const editor = await (await h.raw(`/app/courses/${c.id}`, { cookie: cookies.author })).text()
  assert.ok(editor.includes('Fill in the blank') && editor.includes('Ordering') && editor.includes('Matching') && editor.includes('Red = Raw meat'))
  await publish((await api('author', 'course.submit', { course: c.id, draftVersion })).id)

  const [assignment] = (await api('manager', 'assignment.create', { course: c.id, learners: [ids.learner], dueDate: '2030-10-01' })).created
  for (const lesson of (await api('learner', `assignments/${assignment}`)).lessons) await api('learner', 'lesson.complete', { assignment, lesson: lesson.id })
  const quiz = (await api('learner', `assignments/${assignment}`)).quiz
  const [blank, order, match] = quiz.questions
  assert.deepEqual([blank.kind, blank.blanks, order.kind, order.positions, match.kind, match.lefts], ['blank', 2, 'order', 4, 'match', ['Red', 'Green', 'Blue']])
  assert.ok(!JSON.stringify(quiz).includes('minus 18') && !('items' in order) && !('pairs' in match))
  const item = label => String(order.options.find(option => option.label === label).index)
  const food = label => String(match.options.find(option => option.label === label).index)
  const page = await (await h.raw(`/app/learn/${assignment}/quiz`, { cookie: cookies.learner })).text()
  assert.ok(page.includes('Blank 2') && page.includes('Position 4') && page.includes(`name="q_${match.id}_2"`) && !page.includes('minus 18'))

  // Accepted variants (case and end spaces ignored) and a correct matching, with two ordering steps swapped: 2 of 3.
  const wrongOrder = await h.submit('quiz.submit', cookies.learner, { assignment, [`q_${blank.id}_0`]: 'FIVE', [`q_${blank.id}_1`]: '  Minus 18 ', [`q_${order.id}_0`]: item('Scrape'), [`q_${order.id}_1`]: item('Rinse'), [`q_${order.id}_2`]: item('Wash'), [`q_${order.id}_3`]: item('Sanitize'), [`q_${match.id}_0`]: food('Raw meat'), [`q_${match.id}_1`]: food('Salad'), [`q_${match.id}_2`]: food('Fish') }, `/app/learn/${assignment}`)
  assert.equal(wrongOrder.searchParams.get('error'), null)
  const first = (await api('learner', `assignments/${assignment}`)).attempts.at(-1)
  const firstDetail = await api('learner', `attempts/${first.id}`)
  assert.deepEqual([firstDetail.score, firstDetail.maxScore, firstDetail.passed], [2, 3, 0])
  const results = Object.fromEntries(firstDetail.responses.map(row => [row.question, row]))
  assert.deepEqual([results[blank.id].correct, results[order.id].correct, results[match.id].correct], [1, 0, 1])
  assert.deepEqual(results[blank.id].answer, ['FIVE', 'Minus 18'])
  assert.ok(firstDetail.scoringRule.includes('every choice, blank, position or pair is correct') && firstDetail.scoringRule.includes('pass at 100%'))
  assert.equal((await api('learner', 'quiz.submit', { assignment, [`q_${order.id}_0`]: '9' }, 400)).error, 'invalid_answer')

  // All correct through the JSON door: 3 of 3, passed, and the course completes.
  const second = await api('learner', 'quiz.submit', { assignment, [`q_${blank.id}_0`]: '5', [`q_${blank.id}_1`]: '-18', [`q_${order.id}_0`]: item('Scrape'), [`q_${order.id}_1`]: item('Wash'), [`q_${order.id}_2`]: item('Rinse'), [`q_${order.id}_3`]: item('Sanitize'), [`q_${match.id}_0`]: food('Raw meat'), [`q_${match.id}_1`]: food('Salad'), [`q_${match.id}_2`]: food('Fish') })
  const secondDetail = await api('learner', `attempts/${second.id ?? (await api('learner', `assignments/${assignment}`)).attempts.at(-1).id}`)
  assert.deepEqual([secondDetail.score, secondDetail.maxScore, secondDetail.passed, secondDetail.responses.every(row => row.correct === 1)], [3, 3, 1, true])
  assert.equal((await api('learner', `assignments/${assignment}`)).assignment.status, 'completed')
}
