import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './regression-fixture.mjs'
import { scormPackage } from './scorm-fixtures.mjs'
import { preparePackage, publishPackage } from './regression-packages.mjs'

const f = await fixture()
const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
const evidence = process.env.BEAM_EVIDENCE_DIR || 'test-results'
await mkdir(evidence, { recursive: true })
let browser
try {
  browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  for (const width of [1440, 390]) {
    const contexts = []
    async function as(role) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true })
      contexts.push(context)
      await context.addCookies(f.cookies[role].split('; ').map(cookie => { const at = cookie.indexOf('='); return { name: cookie.slice(0, at), value: cookie.slice(at + 1), url: f.h.origin } }))
      const page = await context.newPage()
      page.on('pageerror', error => console.error('browser pageerror:', error.message))
      return page
    }
    async function shot(page, name) {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: horizontal overflow at ${width}`)
      await page.screenshot({ path: join(evidence, `${width}-package-${name}.png`), fullPage: true })
    }
    const owner = await as('owner')
    await owner.goto(`${f.h.origin}/app/courses`)
    const create = owner.locator('form[action="/app/do/course.create"]')
    await create.getByLabel('Title', { exact: true }).fill(`Cold chain training ${width}`)
    await create.getByLabel('Reviewer who publishes it').selectOption(f.ids.reviewer)
    await create.getByRole('button', { name: 'Create course', exact: true }).click()
    await owner.waitForURL(/\/app\/courses\/[\w-]+/)
    const courseId = new URL(owner.url()).pathname.split('/').at(-1)
    const upload = owner.locator('form[action="/app/do/package.import"]')
    await upload.getByLabel('SCORM ZIP package').setInputFiles({ name: 'cold-chain.zip', mimeType: 'application/zip', buffer: scormPackage() })
    await upload.getByLabel('License evidence', { exact: true }).fill('Original Beam training package, CC0 1.0 Universal')
    await upload.getByRole('button', { name: 'Validate and add package' }).click()
    await owner.getByRole('heading', { name: 'Keep vaccines between 2 and 8 degrees', exact: true }).waitFor()
    await shot(owner, 'editor')
    await owner.getByRole('button', { name: 'Preview Keep vaccines between 2 and 8 degrees', exact: true }).click()
    await owner.waitForURL(/\/app\/packages\/play\//)
    const previewFrame = owner.frameLocator('iframe.package-frame')
    await previewFrame.getByRole('heading', { name: 'Vaccine cold chain' }).waitFor()
    await previewFrame.getByRole('button', { name: 'Pass check', exact: true }).click()
    await owner.getByText('Preview only. No training was recorded.', { exact: true }).waitFor()
    await shot(owner, 'preview')
    await owner.getByRole('link', { name: 'Back to course editor' }).click()
    await owner.getByRole('button', { name: 'Submit for review', exact: true }).click()
    const course = await f.api('owner', `courses/${courseId}`)
    const revision = course.revisions[0].id
    const reviewer = await as('reviewer')
    await reviewer.goto(`${f.h.origin}/app/revisions/${revision}`)
    await shot(reviewer, 'review')
    await reviewer.getByRole('button', { name: 'Publish this revision', exact: true }).click()
    const assignment = (await f.api('manager', 'assignment.create', { course: courseId, learners: [f.ids.learner], dueDate: '2030-10-01' })).created[0]
    const learner = await as('learner')
    await learner.goto(`${f.h.origin}/app/learn/${assignment}`)
    await shot(learner, 'assigned')
    await learner.getByRole('button', { name: 'Start or resume Keep vaccines between 2 and 8 degrees', exact: true }).click()
    await learner.waitForURL(/\/app\/packages\/play\//)
    const frame = learner.frameLocator('iframe.package-frame')
    await frame.getByLabel('Your place').fill('temperature-check')
    // The sandbox cannot reach the Beam DOM or storage.
    assert.equal(await learner.frames()[1].evaluate(() => { try { return !!parent.document.body } catch { return false } }), false)
    await frame.getByRole('button', { name: 'Save and suspend' }).click()
    await learner.getByText('Saved. You can return to the course.', { exact: true }).waitFor()
    await shot(learner, 'suspended')
    // A separate browser context models another device with a fresh page/runtime.
    const phone = await as('learner')
    await phone.goto(`${f.h.origin}/app/learn/${assignment}`)
    await phone.getByRole('button', { name: 'Start or resume Keep vaccines between 2 and 8 degrees', exact: true }).click()
    await phone.waitForURL(/\/app\/packages\/play\//)
    const resumed = phone.frameLocator('iframe.package-frame')
    await resumed.getByText(/Resumed place: temperature-check.*temperature=5;checked=true.*Entry: resume/).waitFor()
    await shot(phone, 'resumed')
    await resumed.getByRole('button', { name: 'Fail check' }).click()
    await phone.getByText('Saved. You can return to the course.', { exact: true }).waitFor()
    await phone.getByRole('link', { name: 'Return to course', exact: true }).click()
    await phone.getByText('Failed: completion is not awarded.', { exact: true }).waitFor()
    assert.equal((await f.view(assignment)).completion, null)
    await shot(phone, 'failed')
    await phone.getByRole('button', { name: 'Start or resume Keep vaccines between 2 and 8 degrees', exact: true }).click()
    await phone.waitForURL(/\/app\/packages\/play\//)
    await phone.frameLocator('iframe.package-frame').getByRole('button', { name: 'Pass check', exact: true }).click()
    await phone.getByText('Course completed. Your exact revision and package evidence are saved.', { exact: true }).waitFor()
    await shot(phone, 'passed')
    await phone.getByRole('link', { name: 'Return to course', exact: true }).click()
    assert.equal((await f.view(assignment)).completion.revision, revision)
    await shot(phone, 'completed')
    await phone.getByRole('link', { name: 'Inspect runtime evidence' }).click()
    await phone.getByRole('heading', { name: 'Package runtime evidence' }).waitFor()
    await shot(phone, 'evidence')
    // 2004 uses the same isolated player, with a real prerequisite navigation.
    if (!process.argv.includes('--only=1.2')) {
      const c = await publishPackage(f, await preparePackage(f, '2004-4', { multi: true, title: `Cold chain sequencing ${width}` }))
      await phone.goto(`${f.h.origin}/app/learn/${c.assignment}`)
      const buttons = phone.locator('form[action="/app/do/package.launch"] button')
      await buttons.nth(1).click()
      assert.ok(new URL(phone.url()).searchParams.get('error'))
      await shot(phone, '2004-prerequisite')
      await phone.locator('form[action="/app/do/package.launch"] button').first().click()
      await phone.waitForURL(/\/app\/packages\/play\//)
      await phone.frameLocator('iframe.package-frame').getByRole('button', { name: 'Pass check', exact: true }).click()
      await phone.getByText('Saved. You can return to the course.', { exact: true }).waitFor()
      await phone.getByRole('link', { name: 'Return to course', exact: true }).click()
      await phone.locator('form[action="/app/do/package.launch"] button').nth(1).click()
      await phone.waitForURL(/\/app\/packages\/play\//)
      await shot(phone, '2004-sequence')
      await phone.frameLocator('iframe.package-frame').getByRole('button', { name: 'Complete without pass', exact: true }).click()
      await phone.getByText('Course completed. Your exact revision and package evidence are saved.', { exact: true }).waitFor()
      await phone.getByRole('link', { name: 'Return to course', exact: true }).click()
      await phone.getByText('Completed; no passed result declared', { exact: true }).waitFor()
      await shot(phone, '2004-completed')
    }
    for (const context of contexts) await context.close()
    console.log(`PASS package browser import/review/preview/assign/sandbox/suspend/cross-device resume/fail/pass/evidence ${width}`)
  }
} finally { await browser?.close(); await f.h.close() }
