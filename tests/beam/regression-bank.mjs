import assert from 'node:assert/strict'

// LEARN-016: a GIFT file with every GIFT question type and an Aiken file are previewed without writing (each question's
// mapped type and every named loss), applied into the draft bank, published as a shuffled draw and taken with each
// type scored correctly; the bank exports to CSV and GIFT, and re-importing the GIFT export adds no duplicates.
const GIFT = `// Kitchen safety bank
$CATEGORY: $course$/Food safety

::Fridge::What is the highest safe fridge temperature? {
  =5 °C#Right
  ~10 °C#Too warm
  ~15 °C
}

Which of these are allergens? {
  ~%50%Peanuts
  ~%50%Sesame
  ~%-100%Rice
}

Raw chicken can be stored above cooked food. {F}

Name a bacterium often found on undercooked poultry. {=Salmonella =Campylobacter}

Hot holding keeps food at {=63 =63 °C} degrees or above.

Match each board to its food. {
  =Red -> Raw meat
  =Green -> Salad
  =Blue -> Fish
}

What is pi to two decimals? {#3.14:0.005}

[html]Describe <b>how</b> you clean a slicer. {
####Unplug, take apart, wash, rinse, sanitize, air dry.}

This line is a description with no answers.
`
const AIKEN = `Which glove colour is used for raw meat here?
A. Blue
B. White
C. Black
ANSWER: A

How often are fridge temperatures logged?
A) Twice a day
B) Weekly
ANSWER: A
`

export async function bankImportCheck(f) {
  const { api, h, cookies, ids, publish } = f
  const c = await api('author', 'course.create', { title: 'Kitchen safety bank', reviewer: ids.reviewer })
  let draftVersion = (await api('author', 'course.lesson', { course: c.id, draftVersion: c.draftVersion, title: 'Safe storage', body: 'Cold food cold, hot food hot.', sources: [] })).draftVersion

  // The preview through the course page's form writes nothing and names every loss.
  const form = new FormData()
  form.set('course', c.id); form.set('format', 'gift'); form.set('file', new Blob([GIFT], { type: 'text/plain' }), 'kitchen.gift')
  const previewPage = await h.raw(`/app/courses/${c.id}/bank/preview`, { cookie: cookies.author, form })
  const html = await previewPage.text()
  assert.equal(previewPage.status, 200, html.slice(0, 300))
  assert.ok(['nothing has been written', 'true/false → multiple choice', 'short answer → fill-in-the-blank', 'numeric → free response', 'essay → free response', 'Add 8 questions to the draft'].every(text => html.includes(text)))
  const preview = await api('author', 'bank.preview', { course: c.id, format: 'gift', text: GIFT })
  assert.equal((await api('author', `courses/${c.id}`)).draftVersion, draftVersion)
  assert.deepEqual(preview.items.map(item => item.type), ['category', 'multiple choice', 'multiple answer → multiple choice', 'true/false → multiple choice', 'short answer → fill-in-the-blank', 'short answer → fill-in-the-blank', 'matching', 'numeric → free response', 'essay → free response', 'description'])
  const losses = preview.items.flatMap(item => item.losses).join('\n')
  for (const named of ['category “$course$/Food safety” is not kept', 'question title “Fridge” is not kept', 'answer feedback is not kept', 'numeric tolerance (3.14:0.005) is not checked automatically', '[html] formatting is not kept', 'a description with no answers is not a question']) assert.ok(losses.includes(named), named)
  const blank = preview.items[5].question
  assert.deepEqual([blank.prompt, blank.blanks], ['Hot holding keeps food at ___ degrees or above.', [['63', '63 °C']]])

  // Apply the GIFT preview through its form, then the Aiken file through JSON.
  const applied = await h.submit('bank.import', cookies.author, { course: c.id, draftVersion: String(draftVersion), format: 'gift', text: GIFT }, `/app/courses/${c.id}`)
  assert.equal(applied.searchParams.get('error'), null)
  draftVersion++
  const aiken = await api('author', 'bank.import', { course: c.id, draftVersion, format: 'aiken', text: AIKEN })
  assert.deepEqual([aiken.added, aiken.duplicates, aiken.skipped], [2, 0, 0])
  draftVersion = aiken.draftVersion
  draftVersion = (await api('author', 'course.assessment', { course: c.id, draftVersion, passPercent: 100, maxAttempts: 2, drawCount: 10, shuffle: '1', assessor: ids.assessor })).draftVersion

  // Export the draft bank and re-import it: nothing is added twice.
  const gift = await (await h.raw(`/app/courses/${c.id}/bank.gift`, { cookie: cookies.author })).text()
  const csv = await (await h.raw(`/app/courses/${c.id}/bank.csv`, { cookie: cookies.author })).text()
  assert.equal(csv.trim().split('\r\n').length, 11)
  assert.ok(csv.includes('Hot holding keeps food at ___ degrees or above.') && gift.includes('~%50%Peanuts'))
  const again = await api('author', 'bank.preview', { course: c.id, format: 'gift', text: gift })
  assert.deepEqual([again.items.length, again.items.every(item => item.duplicate && item.losses.length === 0)], [10, true])
  const reimport = await api('author', 'bank.import', { course: c.id, draftVersion, format: 'gift', text: gift })
  assert.deepEqual([reimport.added, reimport.duplicates], [0, 10])
  draftVersion = reimport.draftVersion
  await publish((await api('author', 'course.submit', { course: c.id, draftVersion })).id)

  // The learner takes the drawn quiz with every answer right: each automatic type scores; the written ones wait for
  // the named assessor, who grades them, and the attempt passes.
  const course = await api('reviewer', `courses/${c.id}`)
  const revision = await api('reviewer', `revisions/${course.publishedRevision}`)
  const key = Object.fromEntries(revision.assessment.questions.map(question => [question.id, question]))
  const [assignment] = (await api('manager', 'assignment.create', { course: c.id, learners: [ids.learner], dueDate: '2030-10-01' })).created
  for (const lesson of (await api('learner', `assignments/${assignment}`)).lessons) await api('learner', 'lesson.complete', { assignment, lesson: lesson.id })
  const quiz = (await api('learner', `assignments/${assignment}`)).quiz
  assert.equal(quiz.questions.length, 10)
  const answers = {}
  for (const question of quiz.questions) {
    const stored = key[question.id]
    if (stored.kind === 'text') answers[`q_${question.id}`] = 'Unplug it first and sanitize every part.'
    else if (stored.kind === 'blank') answers[`q_${question.id}_0`] = stored.blanks[0][1]
    else if (stored.kind === 'match') stored.pairs.forEach((_, part) => { answers[`q_${question.id}_${part}`] = String(part) })
    else answers[`q_${question.id}`] = stored.correct.map(String)
  }
  const attempt = await api('learner', 'quiz.submit', { assignment, ...answers })
  assert.deepEqual([attempt.pending, attempt.score, attempt.maxScore], [true, 8, 10])
  const written = quiz.questions.filter(question => key[question.id].kind === 'text').map(question => question.id)
  await api('assessor', 'quiz.grade', { attempt: attempt.id, ...Object.fromEntries(written.map(id => [`points_${id}`, 1])), note: 'Complete.' })
  const scored = await api('learner', `attempts/${attempt.id}`)
  assert.deepEqual([scored.score, scored.passed], [10, 1])
  assert.ok(scored.responses.every(row => row.points === row.weight))
}
