import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { sourceProcedureDocx, sourceProcedurePdf } from './source-fixtures.mjs'

// Sources -> original comparison -> corrected draft -> named human review ->
// learner. Scans remain visibly blocked rather than pretending typed text is OCR.
export async function sourceBrowserCheck(f) {
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const evidence = process.env.BEAM_EVIDENCE_DIR || 'test-results'
  await mkdir(evidence, { recursive: true })
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true })
      try {
        const page = await context.newPage()
        async function as(role) {
          await context.clearCookies()
          await context.addCookies(f.cookies[role].split('; ').map(cookie => {
            const split = cookie.indexOf('=')
            return { name: cookie.slice(0, split), value: cookie.slice(split + 1), url: f.h.origin }
          }))
        }
        async function shot(name) {
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: horizontal overflow at ${width}`)
          await page.screenshot({ path: join(evidence, `${width}-source-${name}.png`), fullPage: true })
        }
        async function upload(title, name, buffer) {
          await page.goto(`${f.h.origin}/app/sources`)
          const form = page.locator('form[action="/app/do/source.create"]')
          await form.getByLabel('Title', { exact: true }).fill(title)
          await form.getByLabel('File', { exact: true }).setInputFiles({ name, mimeType: 'application/octet-stream', buffer })
          await form.getByLabel('License evidence').fill('Employer-authored synthetic procedure')
          await form.getByLabel('Where it came from').fill('Synthetic original procedure')
          await form.getByLabel('Responsible reviewer').selectOption(f.ids.reviewer)
          await form.getByRole('button', { name: 'Add source', exact: true }).click()
          const source = page.locator('section.card').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
          await source.getByRole('link', { name: 'Prepare lessons', exact: true }).click()
          await page.getByLabel('Draft course', { exact: true }).selectOption(course.id)
          await page.getByRole('button', { name: 'Prepare for this course', exact: true }).click()
        }
        const course = await f.api('author', 'course.create', { title: `Source preparation ${width}`, reviewer: f.ids.reviewer })
        await as('author')
        await upload(`Original procedure ${width}`, 'synthetic-beam-1.docx', sourceProcedureDocx)
        const originalLink = await page.getByRole('link', { name: 'Open original file', exact: true }).getAttribute('href')
        const original = await f.h.raw(originalLink, { cookie: f.cookies.author })
        assert.deepEqual(Buffer.from(await original.arrayBuffer()), sourceProcedureDocx)
        await page.getByLabel('Lesson text', { exact: true }).first().fill('Wash hands, sanitize and inspect tools.')
        await page.getByLabel('Row 2, cell 2', { exact: true }).fill('Sanitized')
        await page.getByLabel('Accessible image description', { exact: true }).fill('Probe position after sanitation')
        await page.getByLabel('I compared the extracted lessons', { exact: false }).check()
        await page.locator('img.lesson-image').first().evaluate(image => image.decode())
        await shot('comparison-correction')
        await page.getByRole('button', { name: 'Add reviewed lessons to draft', exact: true }).click()
        await page.waitForURL(url => url.pathname === `/app/courses/${course.id}`)
        assert.equal(new URL(page.url()).searchParams.get('error'), null)
        const corrected = await f.api('author', `courses/${course.id}`)
        assert.equal(corrected.publishedRevision, null)
        assert.match(corrected.draft.lessons[0].body, /sanitize/)
        assert.equal(corrected.draft.lessons[0].blocks.find(block => block.kind === 'table').table[1][1].text, 'Sanitized')
        await page.getByRole('button', { name: 'Submit for review', exact: true }).click()
        const revision = (await f.api('author', `courses/${course.id}`)).revisions.find(item => item.state === 'in_review').id
        await as('reviewer')
        await page.goto(`${f.h.origin}/app/revisions/${revision}`)
        assert.equal(await page.getByRole('cell', { name: 'Sanitized', exact: true }).count(), 1)
        await page.getByRole('img', { name: 'Probe position after sanitation', exact: true }).evaluate(image => image.decode())
        await shot('human-review')
        await page.getByRole('button', { name: 'Publish this revision', exact: true }).click()
        assert.equal((await f.api('reviewer', `revisions/${revision}`)).revision.state, 'published')
        const assignment = await f.assign(course), learner = await f.view(assignment)
        await as('learner')
        await page.goto(`${f.h.origin}/app/learn/${assignment}/lessons/${learner.lessons[0].id}`)
        await page.getByRole('img', { name: 'Probe position after sanitation', exact: true }).evaluate(image => image.decode())
        assert.equal(await page.getByRole('cell', { name: 'Sanitized', exact: true }).count(), 1)
        await shot('published-learner')
        await as('author')
        await upload(`Raster procedure ${width}`, 'synthetic-beam-2.pdf', sourceProcedurePdf(true))
        assert.equal(await page.locator('form[action="/app/do/source.convert"]').count(), 0)
        assert.equal(await page.locator('a[href$="/ocr"]').count() > 0, true)
        await page.locator('img.lesson-image').first().evaluate(image => image.decode())
        await shot('scan-ocr-required')
        console.log(`PASS source browser original/correction/table/image/review/publication/scan-refusal ${width}`)
      } finally { await context.close() }
    }
  } finally { await browser.close() }
}
