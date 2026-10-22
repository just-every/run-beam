// Built-page cmi5 acceptance; synthetic credentials belong only to this isolated LRS network edge.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { xapiFixture } from './xapi-fixture.mjs'
import { cmi5Package } from './scorm-fixtures.mjs'
const f = await xapiFixture()
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
      await page.screenshot({ path: join(directory, `${width}-cmi5-${name}.png`), fullPage: true })
    }
    const connection = await f.api('owner', 'xapi.connect', { name: `cmi5 record store ${width}`, endpoint: f.lrs.endpoint, key: 'synthetic-beam-1', secret: 'synthetic-beam-2', consent: true })
    const course = await f.api('owner', 'course.create', { title: `Vaccine cold chain cmi5 ${width}`, reviewer: f.ids.reviewer })
    const owner = await as('owner')
    await owner.goto(`${f.h.origin}/app/courses/${course.id}`)
    const upload = owner.locator('form[action="/app/do/package.import"]').filter({ has: owner.getByRole('button', { name: 'Validate cmi5 package', exact: true }) })
    await upload.getByLabel('cmi5 ZIP package', { exact: true }).setInputFiles({ name: 'cmi5.zip', mimeType: 'application/zip', buffer: cmi5Package() })
    await upload.getByLabel('cmi5 LRS connection', { exact: true }).selectOption(connection.id)
    await upload.getByLabel('License evidence', { exact: true }).fill('Original Beam CC0 1.0 AU')
    await upload.getByRole('checkbox').last().check()
    await upload.getByRole('button', { name: 'Validate cmi5 package', exact: true }).click()
    await owner.getByRole('heading', { name: 'Vaccine cold chain cmi5', exact: true }).waitFor()
    await shot(owner, 'editor')
    await owner.getByRole('button', { name: 'Preview Keep vaccines between 2 and 8 degrees', exact: true }).click()
    await owner.waitForURL(/\/app\/packages\/play\//)
    const preview = owner.frameLocator('iframe.package-frame')
    await preview.getByText('Ready · Browse · moveOn CompletedAndPassed', { exact: true }).waitFor()
    assert.equal(await preview.getByRole('button', { name: 'Pass check', exact: true }).isDisabled(), true)
    await shot(owner, 'preview')
    await owner.getByRole('link', { name: 'Back to course editor', exact: true }).click()
    await owner.getByRole('button', { name: 'Submit for review', exact: true }).click()
    const revision = (await f.api('owner', `courses/${course.id}`)).revisions[0].id
    const reviewer = await as('reviewer')
    await reviewer.goto(`${f.h.origin}/app/revisions/${revision}`)
    await reviewer.getByText(/moveOn CompletedAndPassed/).waitFor()
    await shot(reviewer, 'review')
    await reviewer.getByRole('button', { name: 'Publish this revision', exact: true }).click()
    const assignment = await f.assign(course), learner = await as('learner')
    await learner.goto(`${f.h.origin}/app/learn/${assignment}`)
    await shot(learner, 'assigned')
    async function start(page) {
      await page.getByRole('button', { name: 'Start or resume Keep vaccines between 2 and 8 degrees', exact: true }).click()
      await page.waitForURL(/\/app\/packages\/play\//)
      await page.frameLocator('iframe.package-frame').getByText('Ready · Normal · moveOn CompletedAndPassed', { exact: true }).waitFor()
      return page.frameLocator('iframe.package-frame')
    }
    const frame = await start(learner)
    assert.equal(await learner.frames()[1].evaluate(() => { try { return !!parent.document.body } catch { return false } }), false)
    await frame.getByLabel('Your place', { exact: true }).fill('temperature-check')
    await frame.getByRole('button', { name: 'Save bookmark', exact: true }).click()
    await frame.getByText('Saved bookmark', { exact: true }).waitFor()
    await shot(learner, 'interrupted')
    // Leave without Terminated; a fresh device/page resumes the same registration and saved state.
    const resumed = await as('learner')
    await resumed.goto(`${f.h.origin}/app/learn/${assignment}`)
    const resumedFrame = await start(resumed)
    await resumedFrame.getByText('Resumed place: temperature-check', { exact: true }).waitFor()
    await shot(resumed, 'resumed')
    await resumedFrame.getByRole('button', { name: 'Fail check', exact: true }).click()
    await resumedFrame.getByText('Failed and terminated', { exact: true }).waitFor()
    await resumed.getByRole('link', { name: 'Return to course', exact: true }).click()
    await resumed.getByText('moveOn CompletedAndPassed · Failed; try a new session', { exact: true }).waitFor()
    assert.equal((await f.view(assignment)).completion, null)
    await shot(resumed, 'failed')
    const passingFrame = await start(resumed)
    await passingFrame.getByRole('button', { name: 'Pass check', exact: true }).click()
    await passingFrame.getByText('Passed and terminated', { exact: true }).waitFor()
    await shot(resumed, 'passed')
    await resumed.getByRole('link', { name: 'Return to course', exact: true }).click()
    assert.equal((await f.view(assignment)).completion.revision, revision)
    await shot(resumed, 'completed')
    await resumed.getByRole('link', { name: 'Inspect runtime evidence', exact: true }).click()
    await resumed.getByRole('heading', { name: 'Package runtime evidence', exact: true }).waitFor()
    await resumed.getByText(/abandoned · resumed|abandoned/).first().waitFor()
    await shot(resumed, 'evidence')
    for (const context of contexts) await context.close()
    console.log(`PASS cmi5 built import/preview/review/assign/isolated AU/abandon/resume/fail/pass/provenance ${width}`)
  }
} finally { await browser?.close(); await f.h.close() }
