import assert from 'node:assert/strict'

export async function courseLocaleBrowser(f, pages) {
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const { mkdir } = await import('node:fs/promises'), { join } = await import('node:path')
  const evidence = process.env.BEAM_EVIDENCE_DIR || 'test-results'
  await mkdir(evidence, { recursive: true })
  const browser = await chromium.launch({ ...(process.env.BEAM_BROWSER_EXECUTABLE ? { executablePath: process.env.BEAM_BROWSER_EXECUTABLE } : {}), headless: true, args: ['--use-mock-keychain', '--password-store=basic', '--ignore-certificate-errors'] })
  try {
    for (const width of [1440, 390]) {
      for (const [name, role, path, heading] of pages) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true })
        await context.addCookies(f.cookies[role].split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: f.h.origin })))
        const page = await context.newPage()
        await page.goto(f.h.origin + path)
        await page.getByRole('heading', { name: heading, exact: true }).first().scrollIntoViewIfNeeded()
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} fits ${width}`)
        if (name === 'lesson') {
          await page.waitForFunction(() => { const media = document.querySelector('video'); return media?.readyState >= 2 && media.textTracks[0]?.cues?.length > 0 })
          await page.locator('video').evaluate(media => { media.textTracks[0].mode = 'showing'; media.currentTime = 0.2 })
          await page.waitForFunction(() => document.querySelector('video')?.textTracks[0]?.activeCues?.length > 0)
          assert.match(await page.locator('video').evaluate(media => media.textTracks[0].activeCues[0].text), /herramientas limpias/)
        }
        const iconOnly = await page.locator('button, a, [role="button"]').evaluateAll(nodes => nodes.filter(node => !node.textContent.trim() && !node.querySelector('img')).map(node => ({ label: node.getAttribute('aria-label'), tip: node.getAttribute('data-tooltip') })))
        assert.ok(iconOnly.every(control => control.label && control.tip), 'Icon-only controls carry a visible tooltip')
        await page.screenshot({ path: join(evidence, `${width}-locale-${name}.png`) })
        await context.close()
      }
      console.log(`PASS reviewed course locale ${pages.map(([name]) => name).join(', ')} ${width}`)
    }
  } finally { await browser.close() }
}

// The author corrects a mistranslation in normal text fields, without editing transport data.
export async function correctLocaleText(f, course, translation, body) {
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const browser = await chromium.launch({ ...(process.env.BEAM_BROWSER_EXECUTABLE ? { executablePath: process.env.BEAM_BROWSER_EXECUTABLE } : {}), headless: true, args: ['--use-mock-keychain', '--password-store=basic', '--ignore-certificate-errors'] })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })
    await context.addCookies(f.cookies.author.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: f.h.origin })))
    const page = await context.newPage(); await page.goto(`${f.h.origin}/app/courses/${course}`)
    await page.getByLabel('Lesson 1 text', { exact: true }).fill(body)
    await page.getByLabel('Caption track 1, cue 1', { exact: true }).fill('Inspecciona herramientas limpias.')
    await page.getByRole('button', { name: 'Save corrected translation', exact: true }).click()
    assert.equal(new URL(page.url()).searchParams.get('error'), null)
    const item = (await f.api('author', `course-locales/${course}`)).translations.find(row => row.id === translation)
    assert.equal(item.draft.lessons[0].body, body)
    await context.close()
    return { version: item.version }
  } finally { await browser.close() }
}

// Executes a paid-request form with the same human session used by the qualification journey.
export async function approveModelInBrowser(f, path, action) {
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const browser = await chromium.launch({ ...(process.env.BEAM_BROWSER_EXECUTABLE ? { executablePath: process.env.BEAM_BROWSER_EXECUTABLE } : {}), headless: true, args: ['--use-mock-keychain', '--password-store=basic', '--ignore-certificate-errors'] })
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 }, ignoreHTTPSErrors: true })
    await context.addCookies(f.cookies.owner.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: f.h.origin })))
    const page = await context.newPage(); await page.goto(f.h.origin + path)
    const form = page.locator(`form[action="/app/do/${action}"]`)
    await form.getByRole('checkbox').check()
    await form.getByRole('button').click({ timeout: 110000 })
    await page.waitForURL(url => !url.pathname.endsWith('/translate') && !url.pathname.endsWith('/generate'), { timeout: 110000 })
    assert.equal(new URL(page.url()).searchParams.get('error'), null, 'Paid preparation completes through the editor form')
    await context.close()
  } finally { await browser.close() }
}
