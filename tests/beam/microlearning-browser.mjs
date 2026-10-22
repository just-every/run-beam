import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './regression-fixture.mjs'
import { prepareMicrolearning } from './regression-collab.mjs'
const f = await fixture({ ownerName: 'Avery Patel', businessName: 'Sierra Lakes Produce', names: { author: 'Jordan Brooks', reviewer: 'Morgan Lee', learner: 'Elena Gomez', assessor: 'Priya Shah', other: 'Chris Adams', manager: 'Tom Okafor' } })
const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
const directory = process.env.BEAM_EVIDENCE_DIR || 'test-results'
await mkdir(directory, { recursive: true })
let browser
try {
  browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  for (const width of [1440, 390]) {
    const contexts = []
    async function as(role) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true })
      contexts.push(context)
      await context.addCookies(f.cookies[role].split('; ').map(cookie => { const at = cookie.indexOf('='); return { name: cookie.slice(0, at), value: cookie.slice(at + 1), url: f.h.origin } }))
      return context.newPage()
    }
    async function shot(page, name) {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: overflow ${width}`)
      await page.screenshot({ path: join(directory, `${width}-sequence-${name}.png`), fullPage: true })
    }
    const c = await prepareMicrolearning(f, `browser ${width}`), author = await as('author')
    await author.goto(`${f.h.origin}/app/courses/${c.id}`)
    await author.getByText('Edit five-day sequence', { exact: true }).click()
    const edit = author.locator('form[action="/app/do/course.sequence"]').filter({ has: author.getByRole('button', { name: 'Save five-day sequence', exact: true }) })
    await edit.getByLabel('Day 1 feedback 2', { exact: true }).fill('Review the SOP: keep vaccines at 2 to 8 degrees, then try again.')
    await shot(author, 'authoring-controls')
    await edit.getByRole('button', { name: 'Save five-day sequence', exact: true }).click()
    await author.waitForURL(url => url.searchParams.has('notice'))
    await shot(author, 'editor')
    for (const channel of ['web', 'sms', 'teams']) {
      await author.goto(`${f.h.origin}/app/courses/${c.id}/sequence?channel=${channel}`)
      await author.getByRole('heading', { name: 'Microlearning preview', exact: true }).waitFor()
      assert.equal(await author.getByRole('heading', { level: 2 }).count(), 5)
      await shot(author, `preview-${channel}`)
    }
    await author.goto(`${f.h.origin}/app/courses/${c.id}`)
    await author.getByRole('button', { name: 'Submit for review', exact: true }).click()
    const revision = (await f.api('author', `courses/${c.id}`)).revisions[0].id, reviewer = await as('reviewer')
    await reviewer.goto(`${f.h.origin}/app/revisions/${revision}`)
    await reviewer.getByRole('heading', { name: 'Five-day microlearning for review', exact: true }).waitFor()
    await shot(reviewer, 'review')
    await reviewer.getByRole('button', { name: 'Publish this revision', exact: true }).click()
    const assignment = await f.assign(c), learner = await as('learner')
    await learner.goto(`${f.h.origin}/app/learn/${assignment}`)
    await learner.getByRole('link', { name: 'Open five-day sequence', exact: true }).click()
    await learner.getByRole('heading', { name: 'Five-day microlearning', exact: true }).waitFor()
    await learner.getByRole('img', { name: 'Thermometer placement diagram', exact: true }).waitFor()
    await shot(learner, 'day-one')
    await learner.getByRole('button', { name: 'Pause sequence', exact: true }).click()
    await learner.getByRole('button', { name: 'Resume sequence', exact: true }).waitFor()
    assert.equal(await learner.getByRole('button', { name: 'Send formative reply', exact: true }).count(), 0)
    await shot(learner, 'paused')
    await learner.getByRole('button', { name: 'Resume sequence', exact: true }).click()
    await learner.getByLabel('Which temperature is safe?', { exact: true }).selectOption('1')
    await learner.getByRole('button', { name: 'Send formative reply', exact: true }).click()
    await learner.getByText(/Review the SOP: keep vaccines/).waitFor()
    await shot(learner, 'retry-feedback')
    await learner.getByLabel('Which temperature is safe?', { exact: true }).selectOption('0')
    await learner.getByRole('button', { name: 'Send formative reply', exact: true }).click()
    await learner.getByText(/Day 2 of 5/).waitFor()
    await shot(learner, 'waiting-day-two')
    assert.equal((await f.view(assignment)).completion, null)
    for (let day = 2; day <= 5; day++) {
      const start = new Date(); start.setUTCHours(0,0,0,0)
      await f.h.db.prepare('UPDATE beam_assignments SET assigned_at=? WHERE id=?').bind(start.getTime() - (day-1)*86400000, assignment).run()
      await learner.reload()
      await learner.getByLabel('Which temperature is safe?', { exact: true }).selectOption('0')
      await learner.getByRole('button', { name: 'Send formative reply', exact: true }).click()
    }
    await learner.getByText('All five modules answered.', { exact: true }).waitFor()
    assert.equal((await f.view(assignment)).completion, null)
    await shot(learner, 'assessment-still-required')
    await learner.getByRole('link', { name: 'Open full course and required assessment', exact: true }).click()
    const question = (await f.view(assignment)).quiz.questions[0]
    // The canonical quiz is intentionally separate from every formative reply.
    await f.api('learner', 'quiz.submit', { assignment, [`q_${question.id}`]: ['0'] })
    await learner.reload()
    assert.equal((await f.view(assignment)).completion.revision, revision)
    await shot(learner, 'completed')
    for (const context of contexts) await context.close()
    console.log(`PASS microlearning built authoring/web-SMS-Teams previews/review/media/workday spacing/pause/resume/branch/required-assessment ${width}`)
  }
} finally { await browser?.close(); await f.h.close() }
