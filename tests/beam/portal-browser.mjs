import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { portalNotice } from './regression-portals.mjs'

/** Forms reach the real Worker; only provider mail is captured at the existing network edge. */
export async function portalEntryBrowserCheck(f) {
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const evidence = process.env.BEAM_EVIDENCE_DIR || 'test-results'
  await mkdir(evidence, { recursive: true })
  const browser = await chromium.launch({ ...(process.env.BEAM_BROWSER_EXECUTABLE ? { executablePath: process.env.BEAM_BROWSER_EXECUTABLE } : {}), headless: true, args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic', '--ignore-certificate-errors'] })
  try {
    for (const width of [1440, 390]) {
      const create = async kind => {
        const p = await f.api('owner', 'portal.create', { kind, name: `${kind} training ${width}`, consentText: 'A separate training choice for this portal.', confirm: true })
        await f.api('owner', 'portal.notice', { portal: p.id, version: 0, ...portalNotice })
        return p
      }
      const customer = await create('customer'), partner = await create('partner')
      const email = `synthetic-beam-browser-${width}@example.test`
      const invite = async p => f.api('owner', 'portal.invite', { portal: p.id, email, name: 'External learner', sendInvitation: true })
      const invitation = await invite(customer)
      const cookie = await f.h.signIn(email, { requested: true })
      const second = await invite(partner)
      const cookies = value => value.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: f.h.origin }))
      const context = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true })
      try {
        await context.addCookies(cookies(cookie))
        const page = await context.newPage(), errors = []
        page.on('pageerror', error => errors.push(error.message))
        const base = `/app/portal/${customer.id}`
        const state = async () => (await f.h.raw(`/api/beam/portal/${customer.id}/consent`, { cookie })).json()
        const shot = async name => {
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} fits ${width}`)
          // All controls are textual; an icon-only control added later must supply the shared tooltip contract.
          for (const control of await page.locator('button,a').all()) assert.ok((await control.innerText()).trim(), 'Portal controls have visible labels')
          assert.equal(await page.locator('.nav').count(), 0, 'No employee navigation is rendered')
          await page.screenshot({ path: join(evidence, `${width}-portal-${name}.png`), fullPage: true })
        }
        const submit = async name => {
          await page.getByRole('button', { name, exact: true }).focus()
          await Promise.all([page.waitForNavigation(), page.keyboard.press('Enter')])
        }
        await page.goto(`${f.h.origin}${base}/claim?identity=${invitation.id}`)
        await page.getByRole('heading', { name: 'Claim your invitation' }).waitFor()
        assert.equal((await f.h.raw(`/api/beam/portal/${customer.id}/consent`, { cookie })).status, 404, 'GET cannot claim an identity')
        await shot('claim')
        await submit('Claim invitation')
        assert.equal((await state()).accepted, false, 'Claiming never accepts consent')
        const body = await page.locator('main').innerText()
        for (const value of Object.values(portalNotice)) assert.ok(body.includes(value), 'Complete notice disclosure is rendered')
        await shot('notice')
        await page.getByRole('checkbox', { name: 'I accept this portal’s training notice.' }).check()
        await submit('Accept training notice')
        assert.equal((await state()).accepted, true)
        assert.equal((await state()).decision.identity, invitation.id)
        await shot('accepted')
        // The same verified account has a different identity and no inherited consent in another portal.
        await f.h.raw(`/api/beam/portal/${partner.id}/claim`, { cookie, body: { identity: second.id } })
        const partnerState = async () => (await f.h.raw(`/api/beam/portal/${partner.id}/consent`, { cookie })).json()
        assert.equal((await partnerState()).accepted, false)
        await f.h.raw(`/api/beam/portal/${partner.id}/consent`, { cookie, body: { accept: true, noticeVersion: 1 } })
        await f.api('owner', 'portal.admin', { portal: customer.id, identity: invitation.id })
        const course = await f.course(`Portal induction ${width}`)
        await f.api('owner', 'portal.share', { portal: customer.id, revision: course.revision, confirm: true })
        const partnerCourse = await f.course(`Partner-only induction ${width}`)
        await f.api('owner', 'portal.share', { portal: partner.id, revision: partnerCourse.revision, confirm: true })
        await page.getByRole('link', { name: 'Open shared catalog' }).click()
        await page.getByText(course.title, { exact: true }).waitFor()
        assert.ok(!(await page.locator('main').innerText()).includes('Perform the owned procedure.'))
        assert.equal(await page.getByText(partnerCourse.title, { exact: true }).count(), 0, 'Other portal courses are not rendered')
        await shot('catalog')
        await page.getByRole('link', { name: 'Your consent' }).click()
        await submit('Withdraw consent')
        assert.equal((await state()).accepted, false)
        assert.equal((await partnerState()).accepted, true, 'Withdrawal leaves other portal consent unchanged')
        await shot('withdrawn')
        const closed = await page.goto(`${f.h.origin}${base}/catalog`)
        assert.equal(closed.status(), 403)
        await shot('closed-catalog')
        await page.getByRole('link', { name: 'Review your consent' }).click()
        await page.getByRole('checkbox').check()
        await submit('Accept training notice')
        assert.equal((await f.h.raw(`/api/beam/portal/${customer.id}/roster`, { cookie })).status, 403, 'Renewal cannot revive administrator rights')
        // A stale rendered notice is refused after the operator publishes a new version.
        await submit('Withdraw consent')
        await f.api('owner', 'portal.notice', { portal: customer.id, version: 1, ...portalNotice, purpose: 'Updated learning purpose' })
        await page.getByRole('checkbox').check()
        await submit('Accept training notice')
        assert.equal((await state()).accepted, false)
        await page.getByText('The training notice changed. Review the current notice before accepting.').waitFor()
        await shot('notice-changed')
        await page.getByRole('link', { name: 'Review your consent' }).click()
        await page.getByRole('checkbox').check()
        await submit('Accept training notice')
        assert.equal((await state()).decision.noticeVersion, 2)
        await f.api('owner', 'portal.revoke', { portal: customer.id, identity: invitation.id })
        await page.reload()
        await page.getByText('Portal admission is closed. You can still withdraw consent here.').waitFor()
        assert.equal(await page.getByRole('button', { name: 'Accept training notice' }).count(), 0)
        await submit('Withdraw consent')
        assert.equal((await state()).accepted, false)
        await shot('admission-closed')
        await context.clearCookies()
        await context.addCookies(cookies(f.cookies.learner))
        const refused = await page.goto(`${f.h.origin}${base}/claim?identity=${invitation.id}`)
        assert.equal(refused.status(), 404, 'An employee cannot claim another account invitation')
        assert.ok(!(await page.locator('main').innerText()).includes(customer.name))
        await shot('wrong-account')
        await context.clearCookies()
        const signin = await context.request.get(f.h.origin + base + '/consent', { maxRedirects: 0 })
        assert.equal(signin.status(), 303)
        assert.equal(new URL(signin.headers().location).searchParams.get('returnTo'), base + '/consent')
        assert.deepEqual(errors, [])
        console.log(`PASS portal rendered claim, complete consent, catalog isolation, withdrawal, stale notice and account refusal ${width}`)
      } finally { await context.close() }
    }
  } finally { await browser.close() }
}
