import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export async function portalWrittenFlow(f, portal, foreignPortal) {
  const { api, h, cookies, ids } = f
  const invite = await api('owner', 'portal.invite', { portal: portal.id, email: 'synthetic-beam-32@example.test', name: 'Written assessment learner', sendInvitation: true })
  const cookie = await h.signIn('synthetic-beam-32@example.test', { requested: true })
  const call = (door, body, status = 200, as = cookie) => h.api(`portal/${portal.id}/${door}`, as, body, status)
  await call('claim', { identity: invite.id })
  await call('consent', { accept: true, noticeVersion: (await call('consent')).noticeVersion })
  const course = await api('author', 'course.create', { title: 'Written station assessment', reviewer: ids.reviewer })
  let version = course.draftVersion
  const edit = async (action, fields) => { version = (await api('author', action, { course: course.id, draftVersion: version, ...fields })).draftVersion }
  await edit('course.lesson', { title: 'Safe station', body: 'Inspect the station.', sources: [] })
  await edit('course.question', { kind: 'text', prompt: 'Explain your inspection.', guidance: 'Private owner grading guidance.', points: 3 })
  await edit('course.assessment', { passPercent: 100, maxAttempts: 2, assessor: ids.owner })
  const revision = (await api('author', 'course.submit', { course: course.id, draftVersion: version })).id
  await f.publish(revision)
  await api('owner', 'portal.share', { portal: portal.id, revision, confirm: true })
  const enrollment = await call('enroll', { identity: invite.id, revision }, 200, cookies.owner)
  const door = `assessment?enrollment=${enrollment.id}`, review = `assessment-review?enrollment=${enrollment.id}`
  const lesson = (await call(`learning?enrollment=${enrollment.id}`)).lessons[0]
  await call('learning', { enrollment: enrollment.id, lesson: lesson.id })
  const ready = await call(door), question = ready.questions[0]
  assert.deepEqual([ready.available, question.kind, question.points], [true, 'text', 3])
  assert.ok(!JSON.stringify(ready).includes('Private owner grading guidance.'))
  await call(review, undefined, 403)
  await call(review, undefined, 404, cookies.assessor)
  await call(review, undefined, 404, cookies.manager)
  const submitted = await call('assessment', { enrollment: enrollment.id, number: 1, [`q_${question.id}`]: 'I inspect the probe before starting work.' })
  assert.deepEqual([submitted.pending, submitted.passed, submitted.attempts[0].state], [true, false, 'awaiting_review'])
  await call('assessment', { enrollment: enrollment.id, number: 2 }, 409)
  await call('completion', { enrollment: enrollment.id }, 409)
  const ownerView = await call(review, undefined, 200, cookies.owner)
  assert.deepEqual(ownerView.attempts[0].responses.map(row => [row.selected, row.guidance, row.points]), [[['I inspect the probe before starting work.'], 'Private owner grading guidance.', null]])
  const grade = { enrollment: enrollment.id, attempt: submitted.attempts[0].id, [`points_${question.id}`]: 3, note: 'Observed all required inspection points.' }
  await call('assessment-review', grade, 403)
  await call('assessment-review', grade, 404, cookies.assessor)
  await call('assessment-review', { ...grade, [`points_${question.id}`]: 4 }, 400, cookies.owner)
  await h.api(`portal/${foreignPortal.id}/assessment-review`, cookies.owner, grade, 404)
  await call('consent', { withdraw: true })
  await call('assessment-review', grade, 404, cookies.owner)
  await call('consent', { accept: true, noticeVersion: (await call('consent')).noticeVersion })
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const evidence = process.env.BEAM_EVIDENCE_DIR || 'test-results'
  await mkdir(evidence, { recursive: true })
  const browser = await chromium.launch({ ...(process.env.BEAM_BROWSER_EXECUTABLE ? { executablePath: process.env.BEAM_BROWSER_EXECUTABLE } : {}), headless: true, args: ['--use-mock-keychain', '--password-store=basic', '--ignore-certificate-errors'] })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
    await context.addCookies(cookies.owner.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: h.origin })))
    const page = await context.newPage()
    const shot = async state => {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        for (const control of await page.locator('button,a').all()) assert.ok((await control.innerText()).trim())
        await page.screenshot({ path: join(evidence, `${width}-portal-written-${state}.png`), fullPage: true })
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
    await page.goto(`${h.origin}/portal/${portal.id}/${review}`)
    await page.getByRole('button', { name: 'Record written review', exact: true }).waitFor()
    await page.getByText('I inspect the probe before starting work.', { exact: true }).waitFor()
    await shot('pending')
    await page.locator(`[name="points_${question.id}"]`).fill('3')
    await page.locator('[name="note"]').fill(grade.note)
    await page.getByRole('button', { name: 'Record written review', exact: true }).click()
    await page.getByText('100% · Passed', { exact: true }).waitFor()
    await shot('graded')
    await context.close()
  } finally { await browser.close() }
  const graded = await call(door)
  assert.deepEqual([graded.pending, graded.passed, graded.attempts[0].score, graded.attempts[0].maxScore, graded.attempts[0].percent, graded.attempts[0].state], [false, true, 3, 3, 100, 'scored'])
  await call('assessment-review', grade, 409, cookies.owner)
  const receipt = await call(`assessment.json?enrollment=${enrollment.id}`)
  assert.deepEqual(receipt.attempts[0].responses.map(row => row.points), [3])
  assert.ok(!JSON.stringify(receipt).includes('Private owner grading guidance.'))
  const completed = await call('completion', { enrollment: enrollment.id })
  assert.equal(completed.completion.attempt, submitted.attempts[0].id)
  assert.deepEqual((await call('report', undefined, 200, cookies.owner)).enrollments.filter(row => row.id === enrollment.id).map(row => [row.assessmentPassed, row.completion]), [[1, completed.completion.id]])
  const records = (await (await h.raw('/app/data-export.json', { cookie: cookies.owner })).json()).records
  assert.deepEqual(records.beam_portal_quiz_reviews.rows.map(row => [row.attempt_id, row.assessor_id, row.note]), [[submitted.attempts[0].id, ids.owner, grade.note]])
  const audit = await api('owner', 'audit')
  const events = audit.events.filter(row => row.action === 'portal.quiz.grade')
  assert.deepEqual(events.map(row => [row.detail.identity, row.detail.revision, row.detail.attempt, row.detail.assessor, row.detail.outcome]), [[invite.id, revision, submitted.attempts[0].id, ids.owner, 'passed']])
  assert.ok(!JSON.stringify(events).includes('I inspect the probe'))
}
