import assert from 'node:assert/strict'

// LEARN-015: an author publishes a fill-in-the-blank, an ordering and a matching question through the form and JSON
// doors; the learner's page shows a labelled control for every blank, position and pair without the answers. In a real
// browser a phone tap and a desktop drag pair a matching answer with its item. By keyboard alone at 390 and at 1440
// pixels the learner submits the page with one wrong position (2 of 3), with accepted variants in the blanks (case and
// end spaces ignored: 3 of 3, completing the course) and, newly assigned, with every canonical answer (3 of 3); each
// attempt keeps its responses, per-question result and scoring rule. BEAM_PLAYWRIGHT may name a newer Playwright module
// for local runs.
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

  const enroll = async () => {
    const [id] = (await api('manager', 'assignment.create', { course: c.id, learners: [ids.learner], dueDate: '2030-10-01' })).created
    for (const lesson of (await api('learner', `assignments/${id}`)).lessons) await api('learner', 'lesson.complete', { assignment: id, lesson: lesson.id })
    return id
  }
  const assignment = await enroll()
  const quiz = (await api('learner', `assignments/${assignment}`)).quiz
  const [blank, order, match] = quiz.questions
  assert.deepEqual([blank.kind, blank.blanks, order.kind, order.positions, match.kind, match.lefts], ['blank', 2, 'order', 4, 'match', ['Red', 'Green', 'Blue']])
  assert.ok(!JSON.stringify(quiz).includes('minus 18') && !('items' in order) && !('pairs' in match))
  const item = label => String(order.options.find(option => option.label === label).index)
  const food = label => String(match.options.find(option => option.label === label).index)
  const page = await (await h.raw(`/app/learn/${assignment}/quiz`, { cookie: cookies.learner })).text()
  assert.ok(page.includes('Blank 2') && page.includes('Position 4') && page.includes(`name="q_${match.id}_2"`) && !page.includes('minus 18'))

  const foods = ['Raw meat', 'Salad', 'Fish'], steps = ['Scrape', 'Wash', 'Rinse', 'Sanitize']
  const answers = {
    oneWrong: { blanks: ['5', '-18'], steps: ['Scrape', 'Rinse', 'Wash', 'Sanitize'], foods, score: 2, results: [1, 0, 1], stored: ['5', '-18'] },
    variants: { blanks: ['FIVE', '  Minus 18 '], steps, foods, score: 3, results: [1, 1, 1], stored: ['FIVE', 'Minus 18'] },
    canonical: { blanks: ['5', '-18'], steps, foods, score: 3, results: [1, 1, 1], stored: ['5', '-18'] },
  }
  assert.ok(page.includes('/beam-match.js') && page.includes('data-match'))
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT || '@playwright/test')
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  const submitted = []
  try {
    const signedIn = async (viewport, id) => {
      const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true })
      await context.addCookies(cookies.learner.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: h.origin })))
      const opened = await context.newPage()
      await opened.goto(`${h.origin}/app/learn/${id}/quiz`)
      return opened
    }
    const phone = { width: 390, height: 844 }, desktop = { width: 1440, height: 1800 }
    // On a phone, tapping an answer and then an item pairs them; on a desktop, dragging answers onto items does.
    const tapped = await signedIn(phone, assignment)
    await tapped.locator('.drag-chip', { hasText: 'Fish' }).click()
    await tapped.locator('.match-pair').nth(2).locator('label').click()
    assert.equal(await tapped.inputValue(`[name="q_${match.id}_2"]`), food('Fish'))
    const dragged = await signedIn(desktop, assignment)
    for (const [part, label] of foods.entries()) await dragged.locator('.drag-chip', { hasText: label }).dragTo(dragged.locator('.match-pair').nth(part))
    assert.deepEqual(await Promise.all([0, 1, 2].map(part => dragged.inputValue(`[name="q_${match.id}_${part}"]`))), foods.map(food))
    assert.equal(await dragged.locator('.drag-chip.used').count(), 3)

    // By keyboard alone: Tab to each blank, position and pair, type the blank or the first letters of an option (the
    // select's own type-ahead), Tab to Submit and press Enter.
    const prefix = (options, label) => { for (let n = 1; ; n++) { const start = label.slice(0, n).toLowerCase(); if (options.filter(option => option.label.toLowerCase().startsWith(start)).length === 1) return label.slice(0, n) } }
    const byKeyboard = async (viewport, id, set) => {
      const tab = await signedIn(viewport, id)
      const tabTo = async (test, arg) => { for (let n = 0; n < 80; n++) { await tab.keyboard.press('Tab'); if (await tab.evaluate(test, arg)) return } assert.fail(`not reachable by Tab at ${viewport.width}px`) }
      const control = name => tabTo(wanted => document.activeElement?.getAttribute('name') === wanted, name)
      for (const [part, text] of set.blanks.entries()) { await control(`q_${blank.id}_${part}`); await tab.keyboard.type(text) }
      for (const [part, label] of set.steps.entries()) { await control(`q_${order.id}_${part}`); await tab.keyboard.type(prefix(order.options, label)) }
      for (const [part, label] of set.foods.entries()) { await control(`q_${match.id}_${part}`); await tab.keyboard.type(prefix(match.options, label)) }
      const chosen = name => tab.inputValue(`[name="${name}"]`)
      assert.deepEqual(await Promise.all([...set.steps.map((_, part) => chosen(`q_${order.id}_${part}`)), ...set.foods.map((_, part) => chosen(`q_${match.id}_${part}`))]), [...set.steps.map(item), ...set.foods.map(food)])
      await tabTo(() => document.activeElement?.matches('button[type="submit"]') ?? false)
      await Promise.all([tab.waitForURL(`**/app/learn/${id}?**`), tab.keyboard.press('Enter')])
      await tab.context().close()
      submitted.push({ id: (await api('learner', `assignments/${id}`)).attempts.at(-1).id, set, width: viewport.width })
    }
    for (const viewport of [desktop, phone]) {
      const first = viewport === desktop ? assignment : await enroll()
      await byKeyboard(viewport, first, answers.oneWrong)
      if (viewport === desktop) assert.equal((await api('learner', 'quiz.submit', { assignment, [`q_${order.id}_0`]: '9' }, 400)).error, 'invalid_answer')
      await byKeyboard(viewport, first, answers.variants)
      assert.equal((await api('learner', `assignments/${first}`)).assignment.status, 'completed')
      await byKeyboard(viewport, await enroll(), answers.canonical)
    }
  } finally {
    await browser.close()
  }
  // Each attempt's stored responses, per-question result, score and rule.
  assert.deepEqual(submitted.map(({ set, width }) => [width, set.score]), [[1440, 2], [1440, 3], [1440, 3], [390, 2], [390, 3], [390, 3]])
  for (const { id, set } of submitted) {
    const detail = await api('learner', `attempts/${id}`)
    assert.deepEqual([detail.score, detail.maxScore, detail.passed], [set.score, 3, set.score === 3 ? 1 : 0])
    const results = Object.fromEntries(detail.responses.map(row => [row.question, row]))
    assert.deepEqual([results[blank.id].correct, results[order.id].correct, results[match.id].correct], set.results)
    assert.deepEqual([results[blank.id].answer, results[order.id].answer, results[match.id].answer], [set.stored, set.steps.map(label => Number(item(label))), set.foods.map(label => Number(food(label)))])
    assert.ok(detail.scoringRule.includes('every choice, blank, position or pair is correct') && detail.scoringRule.includes('pass at 100%'))
  }
}

// LEARN-001: an author builds a weighted bank with an always-asked written task, draws 4 of 6 questions per attempt in a
// shuffled order, holds feedback until the learner passes or runs out of attempts, and adds a satisfaction survey. The
// same attempt always shows the same draw, which the attempt records; the written answer waits for the named assessor
// (another assessor and the learner are refused), and the score is the sum of the drawn questions' earned points over
// their weights. A second attempt passes after grading and completes the course without the survey; survey answers
// stay nameless, never complete anything, and their results show only to the course's staff once three learners answer.
export async function questionBankCheck(f) {
  const { api, h, cookies, ids, publish } = f
  const c = await api('author', 'course.create', { title: 'Allergen service', reviewer: ids.reviewer })
  let draftVersion = c.draftVersion
  const edit = async (action, fields) => { draftVersion = (await api('author', action, { course: c.id, draftVersion, ...fields })).draftVersion }
  await edit('course.lesson', { title: 'The fourteen allergens', body: 'Ask, check the matrix, tell the kitchen.', sources: [] })
  const saved = await h.submit('course.question', cookies.author, { course: c.id, draftVersion: String(draftVersion), kind: 'text', prompt: 'Describe how you take an allergy order.', guidance: 'Ask, check the matrix, tell the kitchen.', points: '4', always: '1' }, `/app/courses/${c.id}`)
  assert.equal(saved.searchParams.get('error'), null)
  draftVersion = (await api('author', `courses/${c.id}`)).draftVersion
  const choice = (prompt, right, points) => edit('course.question', { prompt, choices: 'Yes\nNo', correct: right === 'Yes' ? '1' : '2', ...(points ? { points } : {}) })
  await choice('Is sesame an allergen?', 'Yes', 3)
  await choice('Is rice an allergen?', 'No')
  await choice('Is celery an allergen?', 'Yes')
  await choice('Is lupin an allergen?', 'Yes')
  await edit('course.question', { kind: 'blank', prompt: 'There are ___ regulated allergens.', answers: '14 | fourteen' })
  assert.equal((await api('author', 'course.assessment', { course: c.id, draftVersion, passPercent: 70, maxAttempts: 3, drawCount: 7 })).draftVersion, draftVersion + 1)
  draftVersion++
  assert.equal((await api('author', 'course.submit', { course: c.id, draftVersion }, 400)).error, 'draw_exceeds_bank')
  await edit('course.assessment', { passPercent: 70, maxAttempts: 3, drawCount: 4, shuffle: '1', feedback: 'final' })
  assert.equal((await api('author', 'course.submit', { course: c.id, draftVersion }, 400)).error, 'assessor_required')
  await edit('course.assessment', { passPercent: 70, maxAttempts: 3, drawCount: 4, shuffle: '1', feedback: 'final', assessor: ids.assessor })
  await edit('course.survey', { survey: 'rating: How useful was this course?\nWhat should we add?' })
  const editor = await (await h.raw(`/app/courses/${c.id}`, { cookie: cookies.author })).text()
  assert.ok(editor.includes('Each attempt draws 4 of these 6 questions at random, in a shuffled order') && editor.includes('always asked') && editor.includes('Satisfaction survey'))
  const revision = (await api('author', 'course.submit', { course: c.id, draftVersion })).id
  await publish(revision)
  const published = (await api('reviewer', `revisions/${revision}`)).assessment
  assert.deepEqual([published.draw_count, published.shuffle, published.feedback, published.assessor_id, published.questions.length], [4, 1, 'final', ids.assessor, 6])

  const key = Object.fromEntries(published.questions.map(question => [question.id, question]))
  const answerFor = (question, right) => {
    const stored = key[question.id]
    if (stored.kind === 'text') return { [`q_${question.id}`]: right ? 'Ask the guest, check the allergen matrix and tell the kitchen.' : 'Serve it.' }
    if (stored.kind === 'blank') return { [`q_${question.id}_0`]: right ? 'fourteen' : '9' }
    return { [`q_${question.id}`]: [String(right ? stored.correct[0] : 1 - stored.correct[0])] }
  }
  const [assignment] = (await api('manager', 'assignment.create', { course: c.id, learners: [ids.learner], dueDate: '2030-10-01' })).created
  for (const lesson of (await api('learner', `assignments/${assignment}`)).lessons) await api('learner', 'lesson.complete', { assignment, lesson: lesson.id })
  const drawn = async () => (await api('learner', `assignments/${assignment}`)).quiz
  const first = await drawn()
  assert.equal(first.questions.length, 4)
  assert.deepEqual((await drawn()).questions.map(question => question.id), first.questions.map(question => question.id))
  assert.ok(first.questions.some(question => question.kind === 'text') && first.bank === 6 && first.draw === 4)
  assert.equal(new Set(first.questions.map(question => question.id)).size, 4)
  assert.ok(!JSON.stringify(first).includes('allergen matrix'))
  const page = await (await h.raw(`/app/learn/${assignment}/quiz`, { cookie: cookies.learner })).text()
  assert.ok(page.includes('written answer') && page.includes('drawn from a bank of 6'))

  // Attempt 1: every automatic question wrong, the written answer pending: it waits for the named assessor.
  const one = await api('learner', 'quiz.submit', { assignment, ...Object.assign({}, ...first.questions.map(question => answerFor(question, key[question.id].kind === 'text'))) })
  assert.deepEqual([one.pending, one.score, one.passed], [true, 0, false])
  const weightOf = question => key[question.id].points ?? 1
  assert.equal(one.maxScore, first.questions.reduce((sum, question) => sum + weightOf(question), 0))
  assert.equal((await api('learner', 'quiz.submit', { assignment }, 409)).error, 'attempt_awaiting_grading')
  const written = first.questions.find(question => question.kind === 'text').id
  assert.equal((await api('other', 'quiz.grade', { attempt: one.id, [`points_${written}`]: 4, note: 'Good' }, 403)).error, 'named_assessor_required')
  const queue = await (await h.raw('/app', { cookie: cookies.assessor })).text()
  assert.ok(queue.includes('Allergen service'))
  const grading = await (await h.raw(`/app/attempts/${one.id}`, { cookie: cookies.assessor })).text()
  assert.ok(grading.includes('Grade the written answers') && grading.includes('Ask the guest, check the allergen matrix'))
  const graded = await h.submit('quiz.grade', cookies.assessor, { attempt: one.id, [`points_${written}`]: '3', note: 'Name the kitchen ticket step.' }, `/app/attempts/${one.id}`)
  assert.equal(graded.searchParams.get('error'), null)
  const scored = await api('manager', `attempts/${one.id}`)
  assert.deepEqual(scored.responses.map(row => row.question), first.questions.map(question => question.id))
  assert.equal(scored.score, scored.responses.reduce((sum, row) => sum + row.points, 0))
  assert.deepEqual([scored.score, scored.maxScore, scored.passed, scored.state, scored.decision.decision], [3, one.maxScore, 0, 'scored', 'graded'])
  assert.ok(scored.scoringRule.includes('weight') && scored.scoringRule.includes('pass at 70%'))
  // Feedback is held: the learner sees the score, not which answers were right, until they pass or run out of attempts.
  const mine = await api('learner', `attempts/${one.id}`)
  assert.equal(mine.feedback, 'withheld')
  assert.ok(mine.responses.every(row => !('correct' in row) && !('points' in row)) && mine.score === 3)

  // Attempt 2: a fresh draw, recorded as shown; everything right; graded in full it passes and completes the course.
  const second = await drawn()
  assert.equal(second.attemptsLeft, 2)
  const two = await api('learner', 'quiz.submit', { assignment, ...Object.assign({}, ...second.questions.map(question => answerFor(question, true))) })
  assert.equal(two.pending, true)
  await api('assessor', 'quiz.grade', { attempt: two.id, [`points_${written}`]: 4, note: 'Complete.' })
  const passed = await api('learner', `attempts/${two.id}`)
  assert.deepEqual(passed.responses.map(row => row.question), second.questions.map(question => question.id))
  assert.deepEqual([passed.score, passed.maxScore, passed.passed, passed.feedback], [two.maxScore, two.maxScore, 1, 'shown'])
  assert.ok(passed.responses.every(row => row.points === row.weight))
  const done = await api('learner', `assignments/${assignment}`)
  assert.equal(done.assignment.status, 'completed')
  assert.deepEqual([done.survey.answered, done.completion.method], [false, 'assessed'])
  assert.equal((await api('learner', `attempts/${one.id}`)).feedback, 'shown')

  // The survey: optional, nameless, once per assignment, never a completion; results only from three answers, staff only.
  const learners = [['learner', assignment]]
  // Two more of the fixture's people take the course (inviting new people would spend the invitation rate limit).
  for (const name of ['author', 'other']) {
    const [own] = (await api('owner', 'assignment.create', { course: c.id, learners: [ids[name]], dueDate: '2030-10-01' })).created
    assert.equal((await api(name, 'survey.answer', { assignment: own, [`s_${published.questions[0].id}`]: '5' }, 409)).error, 'lessons_incomplete')
    for (const lesson of (await api(name, `assignments/${own}`)).lessons) await api(name, 'lesson.complete', { assignment: own, lesson: lesson.id })
    learners.push([name, own])
  }
  const survey = (await api('learner', `assignments/${assignment}`)).survey.questions
  const [rating, text] = survey
  for (const [index, [name, own]] of learners.entries()) {
    if (index === 2) assert.equal((await api('author', `revisions/${revision}/survey`)).hidden, 'too_few_answers')
    await api(name, 'survey.answer', { assignment: own, [`s_${rating.id}`]: String(3 + index), [`s_${text.id}`]: `More on cross-contact ${index}` })
  }
  assert.equal((await api('learner', 'survey.answer', { assignment, [`s_${rating.id}`]: '1' }, 409)).error, 'already_responded')
  const results = await api('author', `revisions/${revision}/survey`)
  assert.deepEqual([results.hidden, results.answers, results.questions[0].ratings, results.questions[1].texts.length], [null, 3, [0, 0, 1, 1, 1], 3])
  assert.ok(![ids.learner, ids.author, ids.other].some(id => JSON.stringify(results).includes(id)))
  for (const [name, own] of learners.slice(1)) {
    const view = await api(name, `assignments/${own}`)
    assert.deepEqual([view.survey.answered, view.assignment.status, view.completion], [true, 'open', null])
  }
  for (const role of ['manager', 'assessor']) assert.equal((await api(role, `revisions/${revision}/survey`, undefined, 403)).error, 'forbidden')
  const revisionPage = await (await h.raw(`/app/revisions/${revision}`, { cookie: cookies.reviewer })).text()
  assert.ok(revisionPage.includes('More on cross-contact 1') && revisionPage.includes('drawn at random from a bank of 6'))
}
