import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// Receives the real public-door fixtures returned by portalReportFlow.
export async function portalReportBrowser(f, data) {
  const { portal, foreignPortal, admin, learner, completion, learnerName } = data
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const evidence = process.env.BEAM_EVIDENCE_DIR || 'test-results'
  await mkdir(evidence, { recursive: true })
  const browser = await chromium.launch({ ...(process.env.BEAM_BROWSER_EXECUTABLE ? { executablePath: process.env.BEAM_BROWSER_EXECUTABLE } : {}),
    headless: true, args: ['--use-mock-keychain', '--password-store=basic', '--ignore-certificate-errors'] })
  const base = `/app/portal/${portal.id}`
  const contextFor = async cookie => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
    await context.addCookies(cookie.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: f.h.origin })))
    return context
  }
  try {
    const adminContext = await contextFor(admin.cookie), learnerContext = await contextFor(learner.cookie)
    const page = await adminContext.newPage(), learnerPage = await learnerContext.newPage()
    const shot = async (width, state) => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Report fits ${width}`)
      for (const control of await page.locator('button,a').all()) assert.ok((await control.innerText()).trim(), 'Report actions have visible labels')
      await page.screenshot({ path: join(evidence, `${width}-portal-report-${state}.png`), fullPage: true })
    }
    const form = async (target, label) => {
      const response = target.waitForResponse(item => item.request().method() === 'POST' && new URL(item.url()).pathname === `${base}/consent`)
      await target.getByRole('button', { name: label, exact: true }).click()
      assert.equal((await response).status(), 303, 'The rendered consent form passes the exact-Origin check')
      await target.waitForLoadState('domcontentloaded')
    }
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await learnerPage.setViewportSize({ width, height: 1000 })
      assert.equal((await page.goto(`${f.h.origin}${base}/report`)).status(), 200)
      await page.getByRole('heading', { name: 'Portal learning report', exact: true, level: 2 }).waitFor()
      const completedRow = page.locator('li.row').filter({ hasText: learnerName })
      assert.ok((await completedRow.innerText()).includes('Completed'))
      assert.ok((await completedRow.innerText()).includes('Lessons read: 2 of 2'))
      assert.ok((await completedRow.innerText()).includes('Assessment attempts: 2 · Passed'))
      assert.ok((await completedRow.innerText()).includes(completion.number))
      assert.ok((await completedRow.innerText()).includes(new Date(completion.completedAt).toISOString()))
      assert.equal(await page.getByText('Planned', { exact: true }).count(), 1)
      assert.equal(await page.getByText('In progress', { exact: true }).count(), 1)
      await shot(width, 'earned')
      const downloading = page.waitForEvent('download')
      await page.getByRole('link', { name: 'Download progress report', exact: true }).click()
      const chunks = []
      for await (const chunk of await (await downloading).createReadStream()) chunks.push(chunk)
      const csv = Buffer.concat(chunks).toString('utf8')
      assert.ok(csv.includes(completion.number) && csv.includes('"completed"') && csv.includes('"planned"') && csv.includes('"in_progress"'))
      assert.ok(csv.includes(`"'${data.adminName.replaceAll('"', '""')}"`))
      await page.getByRole('link', { name: 'Consenting learners', exact: true }).click()
      await page.locator(`a[href="${base}/report"]`).click()
      await page.getByRole('heading', { name: 'Portal learning report', exact: true, level: 2 }).waitFor()

      await learnerPage.goto(`${f.h.origin}${base}/consent`)
      await form(learnerPage, 'Withdraw consent')
      await page.reload()
      assert.equal(await page.getByText(learnerName, { exact: true }).count(), 0)
      assert.ok(!(await page.locator('main').innerText()).includes(completion.number))
      await shot(width, 'withdrawn')
      const restricted = await adminContext.request.get(`${f.h.origin}${base}/report.csv`)
      assert.equal(restricted.status(), 200)
      assert.ok(!(await restricted.text()).includes(completion.number))
      await learnerPage.getByRole('checkbox').check()
      await form(learnerPage, 'Accept training notice')
      await page.reload()
      assert.ok((await page.locator('main').innerText()).includes(completion.number), 'Renewal exposes the existing certificate')

      const foreign = await page.goto(`${f.h.origin}/app/portal/${foreignPortal.id}/report`)
      assert.equal(foreign.status(), 404)
      assert.ok(!(await page.locator('main').innerText()).includes(completion.number))
      await page.goto(`${f.h.origin}${base}/consent`)
      await form(page, 'Withdraw consent')
      assert.equal((await page.goto(`${f.h.origin}${base}/report`)).status(), 403)
      await shot(width, 'closed')
      await page.goto(`${f.h.origin}${base}/consent`)
      await page.getByRole('checkbox').check()
      await form(page, 'Accept training notice')
      assert.equal((await page.goto(`${f.h.origin}${base}/report`)).status(), 403, 'Renewal cannot revive report administration')
      await f.api('owner', 'portal.admin', { portal: portal.id, identity: admin.id })
    }
    await adminContext.close()
    await learnerContext.close()
  } finally { await browser.close() }
}
