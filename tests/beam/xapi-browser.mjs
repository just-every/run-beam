import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { file } from './harness.mjs'
import { producerSecret } from './xapi-fixture.mjs'
export async function xapiBrowser(f, activityServer) {
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const directory = process.env.BEAM_EVIDENCE_DIR || 'test-results'
  await mkdir(directory, { recursive: true })
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  try {
    for (const width of [1440, 390]) {
      const contexts = []
      async function as(role) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true })
        contexts.push(context)
        await context.addCookies(f.cookies[role].split('; ').map(cookie => { const at = cookie.indexOf('='); return { name: cookie.slice(0, at), value: cookie.slice(at + 1), url: f.h.origin } }))
        return context.newPage()
      }
      async function shot(page, name) {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: horizontal overflow at ${width}`)
        await page.evaluate(() => scrollTo(0, 0))
        await page.screenshot({ path: join(directory, `${width}-xapi-${name}.png`), fullPage: true })
      }
      const owner = await as('owner')
      await owner.goto(`${f.h.origin}/app/integrations`)
      const connect = owner.locator('form[action="/app/do/xapi.connect"]')
      await connect.getByLabel('Connection name').fill(`Vaccine skills record store ${width}`)
      await connect.getByLabel('LRS endpoint ending in /').fill(f.lrs.endpoint)
      await connect.getByLabel('LRS key', { exact: true }).fill('synthetic-beam-1')
      await connect.getByLabel('LRS secret', { exact: true }).fill('synthetic-beam-2')
      await connect.getByRole('checkbox').check()
      await connect.getByRole('button', { name: 'Connect and check LRS' }).click()
      await owner.getByRole('heading', { name: `Vaccine skills record store ${width}`, exact: true }).waitFor()
      await shot(owner, 'integrations')
      const connection = (await f.api('owner', 'xapi')).connections.find(c => c.name === `Vaccine skills record store ${width}`)
      const source = await f.api('owner', 'source.create', { title: `Vaccine SOP ${width}`, licence: 'owned', licenceEvidence: 'Employer-authored SOP', reviewer: f.ids.reviewer, provenance: 'Operations manual', file: file('sop.txt', 'Keep vaccines between 2 and 8 degrees.') })
      const course = await f.api('owner', 'course.create', { title: `Vaccine handling skills ${width}`, reviewer: f.ids.reviewer })
      const native = await f.api('owner', 'course.lesson', { course: course.id, draftVersion: 1, title: 'Prepare the cold chain', body: 'Read the employer procedure before completing the vaccine handling check.', sources: [] })
      await owner.goto(`${f.h.origin}/app/courses/${course.id}`)
      await owner.getByText('Add an authorized activity', { exact: true }).click()
      const add = owner.locator('form[action="/app/do/xapi.activity"]')
      const activityIri = `${activityServer.origin}/cold-chain-${width}`
      await add.getByLabel('LRS connection', { exact: true }).selectOption(connection.id)
      await add.getByLabel('Activity title', { exact: true }).fill('Keep vaccines between 2 and 8 degrees')
      await add.getByLabel('Activity identity (IRI)').fill(activityIri)
      await add.getByLabel('Activity launch address').fill(`${activityServer.origin}/launch`)
      await add.getByLabel('Learning objectives').fill('Keep vaccines between 2 and 8 degrees.')
      await add.getByLabel('Server producer shared secret (at least 16 characters)').fill(producerSecret)
      await add.locator(`input[name="sources"][value="${source.versionId}"]`).check()
      await add.getByRole('checkbox').last().check()
      await add.getByRole('button', { name: 'Add activity for review' }).click()
      await owner.getByText('Producer username:', { exact: false }).waitFor()
      await shot(owner, 'editor')
      const draft = await f.api('owner', `courses/${course.id}`), activity = draft.draft.xapiActivities[0]
      activityServer.register(activityIri, activity)
      await owner.getByRole('button', { name: 'Submit for review', exact: true }).click()
      const revision = (await f.api('owner', `courses/${course.id}`)).revisions[0].id
      const reviewer = await as('reviewer')
      await reviewer.goto(`${f.h.origin}/app/revisions/${revision}`)
      await shot(reviewer, 'review')
      await reviewer.getByRole('button', { name: 'Publish this revision', exact: true }).click()
      const assignment = await f.assign(course), learner = await as('learner')
      await learner.goto(`${f.h.origin}/app/learn/${assignment}`)
      await shot(learner, 'assigned')
      await learner.getByRole('button', { name: 'Open Keep vaccines between 2 and 8 degrees', exact: true }).click()
      try { await learner.waitForURL(url => url.origin === activityServer.origin, { timeout: 10000 }) } catch (error) { console.log('Activity handoff stopped at', new URL(learner.url()).pathname, 'heading', await learner.locator('h1').allTextContents()); await shot(learner, 'handoff-refusal'); throw error }
      await learner.getByRole('heading', { name: 'Vaccine cold chain', exact: true }).waitFor()
      assert.ok(!(await learner.content()).includes(producerSecret))
      await shot(learner, 'activity')
      await learner.getByRole('button', { name: 'Submit temperature check' }).click()
      await learner.getByRole('heading', { name: 'Cold-chain check failed' }).waitFor()
      await learner.goto(`${f.h.origin}/app/learn/${assignment}`)
      await learner.getByText('Failed: no course completion awarded. Open a new attempt when you are ready.', { exact: true }).waitFor()
      await shot(learner, 'failed')
      await learner.getByRole('button', { name: 'Open Keep vaccines between 2 and 8 degrees', exact: true }).click()
      await learner.getByLabel('Vaccine temperature').selectOption('5')
      await learner.getByRole('button', { name: 'Submit temperature check' }).click()
      await learner.getByRole('heading', { name: 'Cold-chain check passed' }).waitFor()
      await learner.goto(`${f.h.origin}/app/learn/${assignment}`)
      await learner.getByText('Completed and passed; LRS statement verified.', { exact: true }).waitFor()
      assert.equal((await f.view(assignment)).completion, null)
      await shot(learner, 'native-required')
      // Complete the native lesson through its built page as well.
      await learner.getByRole('link', { name: 'Prepare the cold chain', exact: false }).first().click()
      await learner.locator('form[action="/app/do/lesson.complete"] button').click()
      await learner.goto(`${f.h.origin}/app/learn/${assignment}`)
      assert.equal((await f.view(assignment)).completion.revision, revision)
      await shot(learner, 'completed')
      await learner.getByRole('link', { name: 'Inspect xAPI evidence' }).click()
      await learner.getByRole('heading', { name: 'xAPI evidence', exact: true }).waitFor()
      await shot(learner, 'evidence')
      await f.api('owner', 'source.version', { source: source.id, provenance: 'Reviewed updated range', file: file('sop.txt', 'Keep vaccines between 2 and 6 degrees.') })
      await owner.goto(`${f.h.origin}/app/courses/${course.id}`)
      await owner.getByRole('heading', { name: 'Source changed', exact: true }).waitFor()
      await shot(owner, 'impact')
      await owner.goto(`${f.h.origin}/app/integrations`)
      await owner.locator(`form[action="/app/do/xapi.revoke"]:has(input[value="${connection.id}"]) button`).click()
      await owner.getByText('Revoked: launches and results are refused.', { exact: true }).first().waitFor()
      await shot(owner, 'revoked')
      for (const context of contexts) await context.close()
    }
  } finally { await browser.close() }
}
