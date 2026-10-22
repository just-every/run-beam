import assert from 'node:assert/strict'
import { join } from 'node:path'

export async function accessBrowserCheck(f, browser, width, evidence) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true })
  try {
    await context.addCookies(f.cookies.owner.split('; ').map(cookie => { const at = cookie.indexOf('='); return { name: cookie.slice(0, at), value: cookie.slice(at + 1), url: f.h.origin } }))
    const page = await context.newPage()
    const shot = async (name, mask = []) => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} overflow ${width}`)
      await page.screenshot({ path: join(evidence, `${width}-access-${name}.png`), fullPage: true, mask })
    }
    const name = `Power BI training feed ${width}`
    await page.goto(`${f.h.origin}/app/access`)
    const issue = page.locator('form[action="/app/access/issue"]')
    await issue.getByLabel('Name', { exact: true }).fill(name)
    await issue.getByLabel('Audience', { exact: true }).selectOption('reports.read')
    await issue.getByLabel('Regression floor', { exact: true }).check()
    await issue.getByRole('button', { name: 'Issue credential', exact: true }).click()
    await page.waitForURL(/\/app\/access\/issued$/)
    await page.getByRole('heading', { name: 'New credential', exact: true }).waitFor()
    assert.ok(await page.locator('[data-token]').textContent())
    await shot('issued', [page.locator('[data-token]')])
    await page.reload()
    await page.waitForURL(/\/app\/access$/)
    assert.equal((await f.api('owner', 'app-credentials')).filter(item => item.name === name).length, 1)
    await shot('reloaded')
    const dashboard = await f.api('owner', 'dashboard.create', { name: `Floor staff safety ${width}`, team: f.ids.team, fields: ['name', 'course', 'status'], status: 'all' })
    await page.goto(`${f.h.origin}/app/dashboards/${dashboard.id}`)
    const link = page.locator('form[action="/app/dashboards/link"]')
    await link.getByLabel('Viewer work email').fill('manager@example.test')
    await link.getByLabel('Expires at (UTC)').fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16))
    await link.getByRole('button', { name: 'Create restricted link' }).click()
    await page.waitForURL(/\/app\/dashboards\/link$/)
    await page.getByRole('heading', { name: 'Restricted dashboard link', exact: true }).waitFor()
    await shot('restricted-link', [page.locator('.dashboard-link')])
    await page.reload()
    await page.waitForURL(/\/app\/dashboards$/)
    await page.goto(`${f.h.origin}/app/dashboards/${dashboard.id}`)
    assert.equal(await page.locator('form[action="/app/do/dashboard.share.revoke"]').count(), 1)
    await shot('dashboard-reloaded')
    await page.goto(`${f.h.origin}/app/import`)
    await page.getByRole('heading', { name: 'Move in from TalentLMS' }).waitFor()
    await shot('import-list')
  } finally { await context.close() }
}
