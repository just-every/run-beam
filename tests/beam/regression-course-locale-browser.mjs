import assert from 'node:assert/strict'

export async function courseLocaleBrowser(f, pages) {
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const { mkdir } = await import('node:fs/promises'), { join } = await import('node:path')
  const evidence = process.env.BEAM_EVIDENCE_DIR || 'test-results'
  await mkdir(evidence, { recursive: true })
  const browser = await chromium.launch({ ...(process.env.BEAM_BROWSER_EXECUTABLE ? { executablePath: process.env.BEAM_BROWSER_EXECUTABLE } : {}), headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  try {
    for (const width of [1440, 390]) {
      for (const [name, role, path, heading] of pages) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true })
        await context.addCookies(f.cookies[role].split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: f.h.origin })))
        const page = await context.newPage()
        await page.goto(f.h.origin + path)
        await page.getByRole('heading', { name: heading, exact: true }).first().scrollIntoViewIfNeeded()
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} fits ${width}`)
        await page.screenshot({ path: join(evidence, `${width}-locale-${name}.png`) })
        await context.close()
      }
      console.log(`PASS reviewed course locale ${pages.map(([name]) => name).join('/')} ${width}`)
    }
  } finally { await browser.close() }
}

// The author corrects a mistranslation in normal text fields, without editing transport data.
export async function correctLocaleText(f, course, translation, body) {
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const browser = await chromium.launch({ ...(process.env.BEAM_BROWSER_EXECUTABLE ? { executablePath: process.env.BEAM_BROWSER_EXECUTABLE } : {}), headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })
    await context.addCookies(f.cookies.author.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: f.h.origin })))
    const page = await context.newPage(); await page.goto(`${f.h.origin}/app/courses/${course}`)
    await page.getByLabel('Lesson 1 text', { exact: true }).fill(body)
    await page.getByRole('button', { name: 'Save corrected translation', exact: true }).click()
    assert.equal(new URL(page.url()).searchParams.get('error'), null)
    const item = (await f.api('author', `course-locales/${course}`)).translations.find(row => row.id === translation)
    assert.equal(item.draft.lessons[0].body, body)
    await context.close()
    return { version: item.version }
  } finally { await browser.close() }
}
