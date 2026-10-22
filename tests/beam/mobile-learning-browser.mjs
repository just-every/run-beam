import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { file } from './harness.mjs'
import { syntheticAudio, syntheticImage, syntheticVideo } from './fixtures.mjs'
import { sourceProcedurePdf } from './source-fixtures.mjs'
import { scormPackage } from './scorm-fixtures.mjs'

async function assignedCourse(f, width) {
  const title = `Workstation inspection — ${width === 390 ? 'mobile' : 'desktop'}`
  const c = await f.api('author', 'course.create', { title, reviewer: f.ids.reviewer })
  let draftVersion = c.draftVersion, lesson
  const edit = async (action, fields) => {
    const result = await f.api(action === 'package.import' ? 'owner' : 'author', action, { course: c.id, draftVersion, ...fields })
    draftVersion = result.draftVersion
    return result
  }
  const first = await edit('course.lesson', { title: 'Inspect the station', body: 'Inspect clean tools and record the temperature.', sources: [] })
  lesson = first.draft.lessons[0].id
  for (const [index, kind, extension, bytes] of [[1, 'image', 'png', syntheticImage], [2, 'audio', 'mp3', syntheticAudio], [3, 'video', 'mp4', syntheticVideo], [4, 'document', 'pdf', sourceProcedurePdf()]]) {
    const asset = await f.api('author', 'source.create', { title: `Inspection ${kind} original`, licence: 'owned', licenceEvidence: 'Original synthetic Beam media', reviewer: f.ids.reviewer, provenance: 'Synthetic Beam fixture', file: file(`inspection-${kind}.${extension}`, bytes) })
    await edit('course.block', { lesson, content: { kind, source: asset.versionId, text: `Station ${kind}` } })
  }
  await edit('course.block', { lesson, content: { kind: 'check', text: 'Which tool is safe?', choices: ['Clean tool', 'Dirty tool'], answer: 0, feedback: 'Use clean tools.' } })
  await edit('course.lesson', { title: 'Record the inspection', body: 'Record the reading before using the station.', sources: [] })
  await edit('course.question', { prompt: 'What comes before using the station?', choices: 'Record temperature\nSkip inspection', correct: '1' })
  await edit('course.assessment', { passPercent: 100, maxAttempts: 2, practicalInstructions: 'Demonstrate the inspection and upload the record.', assessor: f.ids.assessor })
  await edit('package.import', { licence: 'owned', licenceEvidence: 'Original Beam package dedicated to CC0', file: file('synthetic-beam-5.zip', scormPackage()) })
  const revision = (await f.api('author', 'course.submit', { course: c.id, draftVersion })).id
  await f.publish(revision)
  return { ...c, title, revision, assignment: await f.assign(c) }
}

/** Real emitted Worker, native media and compatible SCORM, with the browser network actually interrupted. */
export async function mobileLearningBrowserCheck(f) {
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const evidence = process.env.BEAM_EVIDENCE_DIR || 'test-results'
  await mkdir(evidence, { recursive: true })
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  try {
    for (const width of [1440, 390]) {
      const c = await assignedCourse(f, width)
      const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width === 390, ignoreHTTPSErrors: true })
      try {
        const cookies = role => f.cookies[role].split('; ').map(cookie => {
          const at = cookie.indexOf('=')
          return { name: cookie.slice(0, at), value: cookie.slice(at + 1), url: f.h.origin }
        })
        await context.addCookies(cookies('learner'))
        const page = await context.newPage(), errors = [], failed = []
        page.on('pageerror', error => errors.push(error.message))
        page.on('requestfailed', request => failed.push(new URL(request.url()).pathname))
        page.on('dialog', dialog => dialog.accept())
        const shot = async name => {
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: overflow at ${width}`)
          await page.screenshot({ path: join(evidence, `${width}-mobile-learning-${name}.png`), fullPage: true })
        }
        const activate = async control => {
          const href = await control.evaluate(element => element instanceof HTMLAnchorElement ? element.href : null)
          const action = async () => {
            if (width === 390) await control.tap()
            else { await control.focus(); await page.keyboard.press('Enter') }
          }
          if (href && new URL(href).origin === f.h.origin) await Promise.all([page.waitForURL(href), action()])
          else await action()
        }
        const confirmed = async name => {
          await page.locator('[data-save-status]').filter({ hasText: /^Saved on Beam\.$/ }).waitFor()
          await shot(name)
          await activate(page.locator('[data-save-continue]'))
        }
        const target = async locator => {
          const rect = await locator.boundingBox()
          assert.ok(rect && rect.width >= 44 && rect.height >= 44, 'primary touch control is at least 44px')
        }
        await page.goto(`${f.h.origin}/app/learning`)
        await activate(page.getByRole('link', { name: c.title, exact: true }))
        await shot('assignment')
        await activate(page.getByRole('link', { name: 'Start', exact: true }))
        await page.locator('[data-save-enhanced=true]').waitFor()
        await page.getByRole('img', { name: 'Station image', exact: true }).waitFor()
        await page.waitForFunction(() => { const image = document.querySelector('.lesson-image'); return image.complete && image.naturalWidth > 0 })
        // Native playback proves real bytes, rather than merely finding media elements.
        for (const kind of ['video', 'audio']) {
          await page.locator(kind).evaluate(async media => { media.muted = true; await media.play() })
          await page.waitForFunction(kind => document.querySelector(kind).currentTime > 0, kind)
          await page.locator(kind).evaluate(media => media.pause())
          assert.equal(await page.locator(kind).getAttribute('controls'), '')
        }
        await page.locator('video').focus()
        await page.keyboard.press('Space')
        await page.waitForFunction(() => !document.querySelector('video').paused)
        await page.keyboard.press('Space')
        await page.waitForFunction(() => document.querySelector('video').paused)
        await page.getByLabel('Clean tool', { exact: true }).focus()
        await page.keyboard.press('Space')
        await activate(page.getByText('Check your answer', { exact: true }))
        assert.equal(await page.getByLabel('Clean tool', { exact: true }).isChecked(), true)
        const pdfLink = page.getByRole('link', { name: 'Download Station document (PDF)', exact: true })
        assert.equal((await context.request.get(f.h.origin + await pdfLink.getAttribute('href'))).status(), 200)
        const done = page.getByRole('button', { name: 'Mark done and continue', exact: true })
        await target(done)
        await shot('mixed-media')
        await context.setOffline(true)
        await activate(done)
        await page.locator('[data-save-status]').filter({ hasText: /^Save not confirmed/ }).waitFor()
        assert.equal((await f.view(c.assignment)).lessons.filter(item => item.completed).length, 0)
        await page.locator('[data-save-baseline]').filter({ hasText: '0 of 2' }).waitFor()
        await shot('lesson-interrupted')
        await context.setOffline(false)
        await activate(page.getByRole('button', { name: 'Retry save', exact: true }))
        await confirmed('lesson-saved')
        await page.getByRole('heading', { name: 'Record the inspection', exact: true }).waitFor()
        await activate(page.getByRole('link', { name: c.title, exact: true }))
        // Server resume opens the second lesson after a navigation and a fresh page request.
        await activate(page.getByRole('link', { name: 'Resume', exact: true }))
        await page.getByRole('heading', { name: 'Record the inspection', exact: true }).waitFor()
        await page.locator('[data-save-baseline]').filter({ hasText: '1 of 2' }).waitFor()
        await shot('native-resumed')
        await activate(page.getByRole('button', { name: 'Mark done', exact: true }))
        await confirmed('native-done')

        const launch = () => activate(page.getByRole('button', { name: 'Start or resume Keep vaccines between 2 and 8 degrees', exact: true }))
        await launch()
        await page.waitForURL(/\/app\/packages\/play\//)
        let frame = page.frameLocator('iframe.package-frame')
        await frame.getByLabel('Your place').fill('synthetic-beam-6')
        await activate(frame.getByRole('button', { name: 'Save and suspend', exact: true }))
        await page.getByText('Saved. You can return to the course.', { exact: true }).waitFor()
        await shot('package-saved')
        await activate(page.getByRole('link', { name: 'Return to course', exact: true }))
        await page.reload()
        await launch()
        frame = page.frameLocator('iframe.package-frame')
        await frame.getByText(/Resumed place: synthetic-beam-6.*Entry: resume/).waitFor()
        await shot('package-resumed')
        await activate(frame.getByRole('button', { name: 'Pass check', exact: true }))
        await page.getByText('Saved. You can return to the course.', { exact: true }).waitFor()
        await activate(page.getByRole('link', { name: 'Return to course', exact: true }))
        await activate(page.getByRole('link', { name: 'Take the quiz', exact: true }))
        await page.getByLabel('Record temperature', { exact: true }).focus()
        await page.keyboard.press('Space')
        await shot('quiz')
        await activate(page.getByRole('button', { name: 'Submit answers', exact: true }))
        await activate(page.getByRole('link', { name: 'Submit evidence', exact: true }))
        await page.locator('[data-save-enhanced=true]').waitFor()
        const evidenceText = 'Inspected clean tools and recorded the temperature before opening.', bytes = Buffer.from('Opening inspection record: clean probe, temperature 5 degrees.')
        await page.getByLabel('What you did', { exact: true }).fill(evidenceText)
        await page.getByLabel('Evidence file (optional)', { exact: true }).setInputFiles({ name: 'opening-inspection.txt', mimeType: 'text/plain', buffer: bytes })
        await page.locator('[data-save-status]').filter({ hasText: /^Pending:/ }).waitFor()
        const submit = page.getByRole('button', { name: 'Submit for assessment', exact: true })
        await target(submit)
        await shot('evidence-pending')
        await context.setOffline(true)
        await activate(submit)
        await page.locator('[data-save-status]').filter({ hasText: /^Save not confirmed/ }).waitFor()
        assert.equal(await page.getByLabel('What you did', { exact: true }).inputValue(), evidenceText)
        assert.equal(await page.locator('input[type=file]').evaluate(input => input.files[0].name), 'opening-inspection.txt')
        assert.equal((await f.view(c.assignment)).attempts.filter(item => item.kind === 'practical').length, 0)
        await shot('evidence-interrupted')
        await context.setOffline(false)
        // Cut the response only after the real Worker accepted the bytes. No application response is fabricated.
        await page.route('**/api/beam/practical.submit', async route => { await route.fetch(); await route.abort('connectionfailed') }, { times: 1 })
        await activate(page.getByRole('button', { name: 'Retry save', exact: true }))
        await page.locator('[data-save-status]').filter({ hasText: /^Save not confirmed/ }).waitFor()
        const pending = (await f.view(c.assignment)).attempts.filter(item => item.kind === 'practical')
        assert.equal(pending.length, 1)
        assert.equal(pending[0].evidenceText, evidenceText)
        await shot('response-lost')
        await activate(page.getByRole('button', { name: 'Retry save', exact: true }))
        await confirmed('evidence-saved')
        assert.equal((await f.view(c.assignment)).attempts.filter(item => item.kind === 'practical').length, 1)
        const attachment = await f.h.raw(`/app/files/attachment/${pending[0].attachment}`, { cookie: f.cookies.learner })
        assert.deepEqual(Buffer.from(await attachment.arrayBuffer()), bytes)
        assert.equal((await f.view(c.assignment)).completion, null, 'pending evidence never awards completion')
        await f.api('assessor', 'practical.decide', { attempt: pending[0].id, decision: 'accepted', note: 'Observed the complete inspection and checked the reading.' })
        await page.reload()
        await page.getByRole('heading', { name: 'Completion', exact: true }).waitFor()
        await shot('completed')
        await activate(page.getByRole('link', { name: 'Certificate', exact: true }))
        await shot('certificate')
        await page.goto(`${f.h.origin}/app/records/${f.ids.learner}`)
        await shot('record')
        assert.equal((await f.api('learner', 'records/me')).completions.filter(item => item.course === c.id).length, 1)
        assert.equal((await f.view(c.assignment)).completion.revision, c.revision)
        assert.ok(failed.some(path => path === '/api/beam/me'), 'browser network interruption failed a real request')
        assert.deepEqual(errors, [])

        // No private draft survives an account switch or browser history restoration.
        const privacy = await f.course(`Equipment inspection — private draft ${width}`, true), privateAssignment = await f.assign(privacy)
        await f.lessons(privateAssignment)
        await page.goto(`${f.h.origin}/app/learn/${privateAssignment}/practical`)
        await page.locator('[data-save-enhanced=true]').waitFor()
        await page.getByLabel('What you did', { exact: true }).fill('Private draft of the equipment inspection.')
        await page.getByLabel('Evidence file (optional)', { exact: true }).setInputFiles({ name: 'private-inspection.txt', mimeType: 'text/plain', buffer: bytes })
        await context.clearCookies()
        await context.addCookies(cookies('other'))
        await activate(page.getByRole('button', { name: 'Submit for assessment', exact: true }))
        await page.locator('[data-save-status]').filter({ hasText: /^Your sign-in changed/ }).waitFor()
        assert.equal(await page.getByLabel('What you did', { exact: true }).inputValue(), '')
        assert.equal(await page.locator('input[type=file]').evaluate(input => input.files.length), 0)
        assert.equal((await f.view(privateAssignment)).attempts.length, 0)
        await shot('account-changed')
        console.log(`PASS LEARN-003 mixed media, SCORM resume, keyboard/touch, interrupted evidence, retry deduplication, records and private draft clearing ${width}`)
      } finally { await context.close() }
    }
  } finally { await browser.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { fixture } = await import('./regression-fixture.mjs')
  const f = await fixture({ businessName:'Sierra Lakes Produce', names:{ owner:'Morgan Hayes', learner:'Riley Morgan', manager:'Nina Brooks', author:'Alex Rivera', reviewer:'Sam Taylor', assessor:'Avery Carter', other:'Jordan Allen' } })
  try { await mobileLearningBrowserCheck(f) } finally { await f.h.close() }
}
