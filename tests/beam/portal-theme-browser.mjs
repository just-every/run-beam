import assert from 'node:assert/strict'

export async function portalThemeBrowserCheck(f, settings, pending, certificate) {
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const { mkdir } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const directory = process.env.BEAM_EVIDENCE_DIR || 'test-results'
  await mkdir(directory, { recursive: true })
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic', '--ignore-certificate-errors'] })
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true })
      try {
        const page = await context.newPage()
        const visit = async (role, path) => {
          await context.clearCookies()
          if (role) await context.addCookies(f.cookies[role].split('; ').map(cookie => { const at = cookie.indexOf('='); return { name: cookie.slice(0, at), value: cookie.slice(at + 1), url: f.h.origin } }))
          await page.goto(f.h.origin + path)
          await page.locator('h1').waitFor()
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${path} at ${width}`)
          const images = page.locator('img[src="/beam-theme/logo"]')
          assert.ok(await images.count() > 0, 'the themed page contains the employer logo')
          for (const image of await images.all()) assert.ok(await image.evaluate(element => element.complete && element.naturalWidth > 0))
          assert.equal(await page.locator('html').evaluate(element => getComputedStyle(element).getPropertyValue('--navy').trim()), settings.primary)
          assert.equal(await page.locator('html').evaluate(element => getComputedStyle(element).getPropertyValue('--blue').trim()), settings.accent)
          assert.equal(await page.locator('link[rel="icon"]').getAttribute('href'), '/beam-theme/favicon')
          if (path.startsWith('/app/certificates/')) assert.equal(await page.locator('.certificate img').getAttribute('src'), '/beam-theme/logo', 'the rendered certificate carries the employer logo')
          await page.screenshot({ path: join(directory, `${width}-portal-${role || 'signin'}-${path.split('?')[0].split('/').filter(Boolean).slice(0, 2).join('-')}.png`), fullPage: true })
        }
        await visit('owner', '/app/business')
        await page.getByLabel('Primary color', { exact: true }).fill('#eeeeee')
        await page.getByRole('button', { name: 'Save theme', exact: true }).click()
        await page.getByRole('alert').waitFor()
        assert.match(await page.getByRole('alert').innerText(), /primary and white/);
        await page.screenshot({ path: join(directory, `${width}-portal-contrast.png`), fullPage: true })
        const next = { primary: width === 1440 ? '#264653' : '#4a2545', accent: width === 1440 ? '#5b214b' : '#21445b', signinHeading: `Sierra Lakes team learning ${width}`, signinText: `Use your Sierra Lakes work email. Training is paid work time. ${width}`, senderName: `Sierra Lakes Training ${width}` }
        for (const [label, key] of [['Primary color', 'primary'], ['Accent color', 'accent'], ['Sign-in heading', 'signinHeading'], ['Sign-in text', 'signinText'], ['Email sender name', 'senderName']]) {
          await page.getByLabel(label, { exact: true }).fill(next[key])
        }
        const { syntheticImage } = await import('./fixtures.mjs')
        for (const label of ['Logo', 'Favicon']) await page.getByLabel(label, { exact: true }).setInputFiles({ name: 'synthetic-beam-1.png', mimeType: 'image/png', buffer: syntheticImage })
        await page.getByRole('button', { name: 'Save theme', exact: true }).click()
        await page.getByRole('status').waitFor()
        const persisted = await f.api('owner', 'theme')
        for (const [name, value] of Object.entries(next)) assert.equal(persisted[name], value, `Settings persisted ${name}`)
        settings = next
        await visit('owner', '/app/business')
        await visit('learner', `/app/certificates/${certificate}`)
        await visit('learner', '/app/learning')
        await visit('manager', `/app/manage?status=open&select=${pending}`)
        const actions = page.locator('summary[data-tooltip]').first()
        await actions.focus()
        assert.equal(await actions.evaluate(element => getComputedStyle(element, '::after').opacity), '1')
        await page.screenshot({ path: join(directory, `${width}-portal-keyboard-tooltip.png`), fullPage: true })
        await actions.evaluate(element => element.blur())
        await actions.hover()
        await page.waitForTimeout(350)
        assert.equal(await actions.evaluate(element => getComputedStyle(element, '::after').opacity), '1')
        await page.screenshot({ path: join(directory, `${width}-portal-hover-tooltip.png`), fullPage: true })
        await visit(null, '/signin')
        assert.equal(await page.locator('h1').innerText(), settings.signinHeading)
        assert.ok((await page.locator('body').innerText()).includes(settings.signinText))
        assert.equal(await page.getByRole('button').first().evaluate(element => getComputedStyle(element).backgroundColor), width === 1440 ? 'rgb(38, 70, 83)' : 'rgb(74, 37, 69)')
        await page.getByLabel('Email', { exact: true }).fill('learner@example.test')
        await page.getByRole('button', { name: 'Email a sign-in link', exact: true }).click()
        assert.equal(f.h.mails.at(-1).from, `${next.senderName} <auth@example.test>`)
        assert.ok(f.h.mails.at(-1).html.includes(next.primary) && f.h.mails.at(-1).html.includes(next.accent))
        const link = f.h.mails.at(-1).text.match(/https:\/\/[^\s]+\/auth\/confirm\?token=[^\s]+/)?.[0]
        assert.ok(link, 'ordinary sign-in mail contains the confirmation link')
        await page.goto(link)
        await page.getByRole('button', { name: 'Confirm', exact: true }).click()
        await page.waitForURL('**/app*')
        assert.equal((await page.request.get(f.h.origin + '/api/beam/me')).status(), 200, 'ordinary branded sign-in reaches the learner')
      } finally { await context.close() }
    }
  } finally { await browser.close() }
}
