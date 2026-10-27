import { sourceNestedDocx, htmlNestedCompanionZip } from './source-nested-fixtures.mjs'
import { htmlCompanionZip } from './source-html-fixtures.mjs'
import { taggedMergedPdf, taggedNestedPdf } from './source-pdf-fixtures.mjs'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { sourceLegacyMergedDocx, sourceProcedureDocx, sourceProcedurePdf } from './source-fixtures.mjs'
import { file } from './harness.mjs'

// Sources -> original comparison -> corrected draft -> named human review ->
// learner. Scans remain visibly blocked rather than pretending typed text is OCR.
export async function sourceBrowserCheck(f) {
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const evidence = process.env.BEAM_EVIDENCE_DIR || 'test-results'
  await mkdir(evidence, { recursive: true })
  const browser = await chromium.launch({ ...(process.env.BEAM_BROWSER_EXECUTABLE ? { executablePath: process.env.BEAM_BROWSER_EXECUTABLE } : {}), headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
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
          await page.screenshot({ path: join(evidence, `${width}-source-${name}.png`), fullPage: true })
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
          if (overflow) console.log('source layout overflow', await page.evaluate(() => [...document.querySelectorAll('main *')].map(node => ({tag:node.tagName,kind:node.className,right:Math.round(node.getBoundingClientRect().right),width:Math.round(node.getBoundingClientRect().width)})).filter(node=>node.right>innerWidth).slice(0,12)))
          assert.equal(overflow, false, `${name}: horizontal overflow at ${width}`)
        }
        async function upload(title, name, buffer, target = course) {
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
          await page.getByLabel('Draft course', { exact: true }).selectOption(target.id)
          await page.getByRole('button', { name: 'Prepare for this course', exact: true }).click()
        }
        const shift = width === 390 ? 'Evening' : 'Morning'
        const course = await f.api('author', 'course.create', { title: `${shift} work area opening procedure`, reviewer: f.ids.reviewer })
        await as('author')
        await upload(`${shift} work area opening SOP`, 'synthetic-beam-1.docx', sourceProcedureDocx)
        const originalLink = await page.getByRole('link', { name: 'Open original file', exact: true }).getAttribute('href')
        const original = await f.h.raw(originalLink, { cookie: f.cookies.author })
        assert.deepEqual(Buffer.from(await original.arrayBuffer()), sourceProcedureDocx)
        await page.getByLabel('Lesson text', { exact: true }).first().fill('Wash hands, sanitize and inspect tools.')
        await page.getByLabel('Row 2, cell 2', { exact: true }).fill('Sanitized')
        await page.getByLabel('First row contains column headings', {exact:true}).uncheck()
        await page.getByLabel('First row contains column headings', {exact:true}).check()
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
        await upload(`${shift} work area opening — scanned original`, 'synthetic-beam-2.pdf', sourceProcedurePdf(true))
        assert.equal(await page.locator('form[action="/app/do/source.convert"]').count(), 0)
        assert.equal(await page.locator('a[href$="/ocr"]').count() > 0, true)
        await page.locator('img.lesson-image').first().evaluate(image => image.decode())
        await shot('scan-ocr-required')
        // Merged Office cells remain editable, then retain their geometry through
        // the ordinary human publication and learner doors.
        for (const [format, bytes] of [['docx', sourceLegacyMergedDocx()], ['pdf', taggedMergedPdf()]]) {
        await as('author')
        const mergedCourse = await f.api('author', 'course.create', { title: `${shift} equipment inspection checklist (${format})`, reviewer: f.ids.reviewer })
        const mergedSource = await f.api('author', 'source.create', { title: `${shift} equipment inspection SOP`, reviewer: f.ids.reviewer,
          licence: 'owned', licenceEvidence: 'Employer-authored inspection checklist', provenance: 'Original inspection procedure', file: file(`synthetic-beam-merged.${format}`, bytes) })
        await page.goto(`${f.h.origin}/app/sources/${mergedSource.versionId}/prepare?course=${mergedCourse.id}`)
        await page.getByLabel('Row 2, cell 2', { exact: true }).fill('Sanitized')
        await page.getByLabel('First row contains column headings', { exact: true }).check()
        await page.getByLabel('I compared the extracted lessons', { exact: false }).check()
        for (const checkbox of await page.locator('input[name="resolvedUncertainties"]').all()) await checkbox.check()
        if (format === 'pdf') {
          await page.getByText('Preview original PDF',{exact:true}).click()
          await page.frameLocator('iframe.lesson-document').locator('canvas[data-page="1"]').waitFor({state:'visible'})
          assert.match(await page.frameLocator('iframe.lesson-document').locator('#pdf-page-text').textContent(),/Equipment/)
        }
        await shot(`merged-table-${format}-correction`)
        await page.getByRole('button', { name: 'Add reviewed lessons to draft', exact: true }).click()
        await page.waitForURL(url => url.pathname === `/app/courses/${mergedCourse.id}`)
        assert.equal(new URL(page.url()).searchParams.get('error'), null)
        assert.equal((await f.api('author', `courses/${mergedCourse.id}`)).publishedRevision, null)
        await page.getByRole('button', { name: 'Submit for review', exact: true }).click()
        const mergedRevision = (await f.api('author', `courses/${mergedCourse.id}`)).revisions.find(item => item.state === 'in_review').id
        await as('reviewer')
        await page.goto(`${f.h.origin}/app/revisions/${mergedRevision}`)
        await shot(`merged-table-${format}-human-review`)
        await page.getByRole('button', { name: 'Publish this revision', exact: true }).click()
        const mergedAssignment = await f.assign(mergedCourse), mergedLearning = await f.view(mergedAssignment)
        await as('learner')
        await page.goto(`${f.h.origin}/app/learn/${mergedAssignment}/lessons/${mergedLearning.lessons[0].id}`)
        const probe = page.getByRole('cell', { name: 'Probe', exact: true })
        assert.equal(await probe.getAttribute('colspan'), '2')
        assert.equal(await probe.getAttribute('rowspan'), '2')
        assert.equal(await page.getByRole('columnheader', { name: 'Equipment', exact: true }).getAttribute('colspan'), '2')
        assert.equal(await page.getByRole('cell', { name: 'Sanitized', exact: true }).count(), 1)
        await shot(`merged-table-${format}-learner`)
        }
        for (const [format, bytes] of [['docx',sourceNestedDocx()],['pdf',taggedNestedPdf()]]) {
          await as('author')
          const nestedCourse = await f.api('author','course.create',{title:`${shift} nested equipment checklist (${format})`,reviewer:f.ids.reviewer})
          await upload(`${shift} nested equipment original (${format})`, `synthetic-beam-nested.${format}`,bytes,nestedCourse)
          await page.getByLabel('Row 2, cell 1, nested table 1, row 2, cell 2',{exact:true}).fill('Sanitized tip')
          await page.getByLabel('I compared the extracted lessons',{exact:false}).check()
          for (const checkbox of await page.locator('input[name="resolvedUncertainties"]').all()) await checkbox.check()
          if (format === 'pdf') {
            await page.getByText('Preview original PDF',{exact:true}).click()
            await page.frameLocator('iframe.lesson-document').locator('canvas[data-page="1"]').waitFor({state:'visible'})
          }
          await shot(`nested-table-${format}-correction`)
          await page.getByRole('button',{name:'Add reviewed lessons to draft',exact:true}).click()
          await page.waitForURL(url=>url.pathname===`/app/courses/${nestedCourse.id}`)
          assert.equal(new URL(page.url()).searchParams.get('error'),null)
          const draft=await f.api('author',`courses/${nestedCourse.id}`)
          assert.equal(draft.draft.lessons[0].blocks.find(block=>block.kind==='table').table[1][0].tables[0].table[1][1].text,'Sanitized tip')
          await page.getByRole('button',{name:'Submit for review',exact:true}).click()
          const revision=(await f.api('author',`courses/${nestedCourse.id}`)).revisions.find(item=>item.state==='in_review').id
          await as('reviewer')
          await page.goto(`${f.h.origin}/app/revisions/${revision}`)
          await shot(`nested-table-${format}-human-review`)
          await page.getByRole('button',{name:'Publish this revision',exact:true}).click()
          const assignment=await f.assign(nestedCourse), learning=await f.view(assignment)
          await as('learner')
          await page.goto(`${f.h.origin}/app/learn/${assignment}/lessons/${learning.lessons[0].id}`)
          assert.equal(await page.locator('table table').count(),1)
          assert.equal(await page.getByRole('cell',{name:'Sanitized tip',exact:true}).count(),1)
          await shot(`nested-table-${format}-learner`)
        }
        await as('author')
        const htmlCourse = await f.api('author', 'course.create', { title: `${shift} packaged HTML inspection`, reviewer: f.ids.reviewer })
        await upload(`${shift} HTML procedure and companion images`, 'synthetic-beam-19.html.zip', htmlNestedCompanionZip(), htmlCourse)
        const htmlImage = page.getByRole('img', { name: 'Probe placement', exact: true })
        await htmlImage.evaluate(image => image.decode())
        await page.getByLabel('Accessible image description', { exact: true }).fill('Probe placement beside clean tools')
        await page.getByLabel('Row 2, cell 2', { exact: true }).fill('Sanitized')
        await page.getByLabel('I compared the extracted lessons', { exact: false }).check()
        await page.getByLabel('Row 2, cell 1, nested table 1, row 2, cell 2',{exact:true}).fill('Sanitized tip')
        await shot('html-companion-correction')
        await page.getByRole('button', { name: 'Add reviewed lessons to draft', exact: true }).click()
        await page.waitForURL(url => url.pathname === `/app/courses/${htmlCourse.id}`)
        assert.equal(new URL(page.url()).searchParams.get('error'), null)
        await page.getByRole('button', { name: 'Submit for review', exact: true }).click()
        const htmlRevision = (await f.api('author', `courses/${htmlCourse.id}`)).revisions.find(item => item.state === 'in_review').id
        await as('reviewer')
        await page.goto(`${f.h.origin}/app/revisions/${htmlRevision}`)
        await page.getByRole('img', { name: 'Probe placement beside clean tools', exact: true }).evaluate(image => image.decode())
        await shot('html-companion-human-review')
        await page.getByRole('button', { name: 'Publish this revision', exact: true }).click()
        const htmlAssignment = await f.assign(htmlCourse), htmlLearning = await f.view(htmlAssignment)
        await as('learner')
        await page.goto(`${f.h.origin}/app/learn/${htmlAssignment}/lessons/${htmlLearning.lessons[0].id}`)
        await page.getByRole('img', { name: 'Probe placement beside clean tools', exact: true }).evaluate(image => image.decode())
        assert.equal(await page.getByRole('cell', { name: 'Sanitized', exact: true }).count(), 1)
        assert.equal(await page.locator('table table').count(),1)
        assert.equal(await page.getByRole('cell',{name:'Sanitized tip',exact:true}).count(),1)
        await shot('html-companion-learner')
        console.log(`PASS source browser original/correction/table/image/review/publication/scan-refusal ${width}`)
      } finally { await context.close() }
    }
  } finally { await browser.close() }
}
