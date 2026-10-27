import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export async function portalMediaBrowser(f, { portal, cookie, enrollment, lesson, paths }) {
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const evidence = process.env.BEAM_EVIDENCE_DIR || 'test-results'
  await mkdir(evidence, { recursive: true })
  const browser = await chromium.launch({ ...(process.env.BEAM_BROWSER_EXECUTABLE ? { executablePath: process.env.BEAM_BROWSER_EXECUTABLE } : {}), headless: true, args: ['--use-mock-keychain', '--password-store=basic', '--ignore-certificate-errors'] })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
    await context.addCookies(cookie.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: f.h.origin })))
    const page = await context.newPage(), base = `/portal/${portal.id}`
    const shot = async name => {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        for (const control of await page.locator('button,a').all()) assert.ok((await control.innerText()).trim(), 'Every portal action has a visible label')
        await page.screenshot({ path: join(evidence, `${width}-portal-media-${name}.png`), fullPage: true })
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
    await page.goto(`${f.h.origin}${base}/learning?enrollment=${enrollment.id}`)
    await page.getByRole('heading', { name: 'Partner station induction', exact: true }).waitFor()
    await page.getByRole('img', { name: 'image station guide', exact: true }).evaluate(image => image.decode())
    await page.getByRole('img', { name: 'Approved extracted station image', exact: true }).evaluate(image => image.decode())
    assert.deepEqual(await page.locator('table tr').allTextContents(), ['ToolCondition', 'ProbeClean'])
    assert.equal(await page.locator('strong').innerText(), 'Prepare')
    await page.getByText('Check your answer', { exact: true }).click()
    await page.getByText('Inspect before work.', { exact: true }).waitFor()
    for (const kind of ['audio', 'video']) {
      await page.locator(kind).evaluate(media => new Promise((resolve, reject) => {
        if (media.readyState >= 1) return resolve()
        media.addEventListener('loadedmetadata', resolve, { once: true })
        media.addEventListener('error', () => reject(new Error('Approved portal media did not load')), { once: true })
      }))
      assert.equal(await page.locator(kind).evaluate(media => media.duration > 0), true)
      await page.locator(kind).evaluate(media => media.play())
      await page.locator(kind).evaluate(media => media.pause())
    }
    assert.equal(await page.locator('track').getAttribute('label'), 'English captions')
    const download = page.waitForEvent('download')
    await page.getByRole('link', { name: 'Download document station guide (PDF)', exact: true }).click()
    const chunks = []
    for await (const chunk of await (await download).createReadStream()) chunks.push(chunk)
    assert.ok(Buffer.concat(chunks).subarray(0, 5).equals(Buffer.from('%PDF-')))
    await page.getByText('Read recorded', { exact: true }).waitFor()
    await shot('learning')
    await page.getByRole('link', { name: 'Review course completion', exact: true }).click()
    const complete = page.getByRole('button', { name: 'Record course completion', exact: true })
    assert.equal(await complete.evaluate(button => getComputedStyle(button).backgroundColor), 'rgb(25, 51, 77)')
    await shot('ready')
    await complete.click()
    await page.getByText('Course completed', { exact: true }).waitFor()
    const earned = await f.h.api(`portal/${portal.id}/completion?enrollment=${enrollment.id}`, cookie)
    assert.equal(earned.completion.method, 'lessons')
    assert.deepEqual(earned.completion.evidence.lessons.map(row => row.lesson), [lesson.id])
    await shot('earned')
    await page.getByRole('link', { name: 'Consent settings', exact: true }).click()
    await page.getByRole('button', { name: 'Withdraw consent', exact: true }).click()
    for (const path of paths) assert.equal((await f.h.raw(path, { cookie })).status, 403)
    await page.goto(`${f.h.origin}${base}/learning?enrollment=${enrollment.id}`)
    await page.getByRole('heading', { name: 'Access is closed', exact: true }).waitFor()
    assert.equal(await page.locator('audio,video,main img').count(), 0)
    await shot('closed')
    await context.close()
  } finally { await browser.close() }
}
