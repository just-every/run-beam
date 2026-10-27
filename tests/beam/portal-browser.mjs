import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { file } from './harness.mjs'
import { syntheticImage } from './fixtures.mjs'
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
      const settings = { primary: '#19334d', accent: '#235238', signinHeading: 'Training', signinText: 'Welcome', senderName: 'Training' }
      await f.api('owner', 'portal.theme', { portal: customer.id, ...settings, logo: file('synthetic-beam-1.png', syntheticImage), favicon: file('synthetic-beam-2.png', syntheticImage) })
      await f.api('owner', 'portal.theme', { portal: partner.id, ...settings, primary: '#235238' })
      const email = `synthetic-beam-browser-${width}@example.test`
      const customerName = `Customer learner ${width}`, partnerName = `Partner learner ${width}`
      const invite = async p => f.api('owner', 'portal.invite', { portal: p.id, email, name: p.id === customer.id ? customerName : partnerName, sendInvitation: true })
      const invitation = await invite(customer)
      let cookie
      const mail = f.h.mails.findLast(message => message.to.some(to => to.includes(email)))
      const link = `${mail.text ?? ''} ${mail.html ?? ''}`.match(/https:\/\/[^\s"<>]*\/auth\/confirm\?token=[^\s"<>]+/)?.[0]
      assert.ok(link, 'The invitation contains an ordinary verified sign-in link')
      const cookies = value => value.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: f.h.origin }))
      const context = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true })
      try {
        const page = await context.newPage(), errors = []
        page.on('pageerror', error => errors.push(error.message))
        const base = `/app/portal/${customer.id}`
        const state = async () => {
          const response = await f.h.raw(`/api/beam/portal/${customer.id}/consent`, { cookie })
          const data = await response.json()
          assert.equal(response.status, 200, JSON.stringify(data))
          return data
        }
        const shot = async name => {
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} fits ${width}`)
          // All controls are textual; an icon-only control added later must supply the shared tooltip contract.
          for (const control of await page.locator('button,a').all()) assert.ok((await control.innerText()).trim(), 'Portal controls have visible labels')
          assert.equal(await page.locator('.nav').count(), 0, 'No employee navigation is rendered')
          await page.screenshot({ path: join(evidence, `${width}-portal-${name}.png`), fullPage: true })
        }
        const submit = async (name, status = 200) => {
          await page.getByRole('button', { name, exact: true }).focus()
          const [response] = await Promise.all([page.waitForNavigation(), page.keyboard.press('Enter')])
          assert.equal(response.status(), status, `${name}: ${await page.locator('main').innerText()}`)
        }
        await page.goto(link.replaceAll('&amp;', '&'))
        await submit('Confirm')
        assert.equal(new URL(page.url()).pathname, base + '/claim', 'Verified invitation returns to the rendered claim')
        assert.equal(new URL(page.url()).searchParams.get('identity'), invitation.id)
        cookie = (await context.cookies()).map(item => `${item.name}=${item.value}`).join('; ')
        const second = await invite(partner)
        await page.getByRole('heading', { name: 'Claim your invitation' }).waitFor()
        assert.equal((await f.h.raw(`/api/beam/portal/${customer.id}/consent`, { cookie })).status, 404, 'GET cannot claim an identity')
        assert.equal(await page.getByRole('button', { name: 'Claim invitation' }).evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(25, 51, 77)', 'The pending claim uses its own portal color')
        await page.getByRole('img', { name: `customer training ${width}`, exact: true }).waitFor()
        for (const asset of ['logo', 'favicon']) {
          const response = await f.h.raw(`${base}/${asset}?identity=${invitation.id}`, { cookie })
          assert.equal(response.status, 200)
          assert.deepEqual(Buffer.from(await response.arrayBuffer()), syntheticImage)
          assert.equal((await f.h.raw(`${base}/${asset}`, { cookie: f.cookies.learner })).status, 404, 'Employee authority cannot read external brand assets')
          assert.equal((await f.h.raw(`/app/portal/${partner.id}/${asset}?identity=${invitation.id}`, { cookie })).status, 404, 'An invitation cannot read another portal asset')
        }
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
        await page.goto(`${f.h.origin}/app/portal/${partner.id}/consent`)
        assert.equal(await page.getByRole('button', { name: 'Accept training notice' }).evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(35, 82, 56)', 'Partner branding is independent')
        await shot('partner-notice')
        await page.goto(f.h.origin + base + '/consent')
        await f.h.raw(`/api/beam/portal/${partner.id}/consent`, { cookie, body: { accept: true, noticeVersion: 1 } })
        await f.api('owner', 'portal.admin', { portal: customer.id, identity: invitation.id })
        const title = `Portal induction ${width}`, partnerTitle = `Partner-only induction ${width}`
        const course = await f.course(title)
        await f.api('owner', 'portal.share', { portal: customer.id, revision: course.revision, confirm: true })
        const partnerCourse = await f.course(partnerTitle)
        await f.api('owner', 'portal.share', { portal: partner.id, revision: partnerCourse.revision, confirm: true })
        await page.getByRole('link', { name: 'Open shared catalog' }).click()
        await page.getByText(title, { exact: true }).waitFor()
        assert.ok(!(await page.locator('main').innerText()).includes('Perform the owned procedure.'))
        assert.equal(await page.getByText(partnerTitle, { exact: true }).count(), 0, 'Other portal courses are not rendered')
        await shot('catalog')
        const enrollment = await (await f.h.raw(`/api/beam/portal/${customer.id}/enroll`, { cookie, body: { identity: invitation.id, revision: course.revision } })).json()
        const partnerEnrollment = await (await f.h.raw(`/api/beam/portal/${partner.id}/enroll`, { cookie: f.cookies.owner, body: { identity: second.id, revision: partnerCourse.revision } })).json()
        await page.getByRole('link', { name: 'Progress report', exact: true }).click()
        await page.getByText(customerName, { exact: true }).waitFor()
        assert.equal(await page.getByText(partnerName, { exact: true }).count(), 0)
        await shot('report')
        const download = await context.request.get(f.h.origin + await page.getByRole('link', { name: 'Download progress report' }).getAttribute('href'))
        assert.equal(download.status(), 200)
        const csv = await download.text()
        const report = (await (await f.h.raw(`/api/beam/portal/${customer.id}/report`, { cookie })).json()).enrollments
        assert.deepEqual(report.map(row => [row.id, row.identity, row.revision, row.status, row.lessonsRead, row.attempts, row.completion]), [[enrollment.id, invitation.id, course.revision, 'planned', 0, 0, null]])
        assert.ok(csv.includes(`"${enrollment.id}","${invitation.id}","${course.revision}"`))
        assert.ok(csv.includes('"planned"') && csv.includes('"0","1","0"'))
        assert.ok(!csv.includes(partnerEnrollment.id))
        await page.getByRole('link', { name: 'Consenting learners', exact: true }).click()
        await page.getByText(customerName, { exact: true }).waitFor()
        assert.equal(await page.getByText(partnerName, { exact: true }).count(), 0)
        await shot('roster')
        await page.getByRole('link', { name: 'Your consent' }).click()
        await submit('Withdraw consent')
        assert.equal((await state()).accepted, false)
        for (const door of ['roster', 'report', 'report.csv']) assert.equal((await f.h.raw(`${base}/${door}`, { cookie })).status, 403, 'Withdrawal closes administration and downloads')
        const retained = await f.h.raw(`${base}/report.csv`, { cookie: f.cookies.owner })
        assert.equal(retained.status, 200)
        assert.ok(!(await retained.text()).includes(invitation.id), 'Ordinary owner exports hide withdrawn identities')
        assert.equal((await partnerState()).accepted, true, 'Withdrawal leaves other portal consent unchanged')
        await shot('withdrawn')
        const closed = await page.goto(`${f.h.origin}${base}/catalog`)
        assert.equal(closed.status(), 403)
        await shot('closed-catalog')
        await page.getByRole('link', { name: 'Review your consent' }).click()
        await page.getByRole('checkbox').check()
        await submit('Accept training notice')
        assert.equal((await f.h.raw(`/api/beam/portal/${customer.id}/roster`, { cookie })).status, 403, 'Renewal cannot revive administrator rights')
        assert.equal((await f.h.raw(base + '/report.csv', { cookie })).status, 403)
        // A stale rendered notice is refused after the operator publishes a new version.
        await submit('Withdraw consent')
        await f.api('owner', 'portal.notice', { portal: customer.id, version: 1, ...portalNotice, purpose: 'Updated learning purpose' })
        await page.getByRole('checkbox').check()
        await submit('Accept training notice', 409)
        assert.equal((await state()).accepted, false)
        await page.getByText('The training notice changed. Review the current notice before accepting.').waitFor()
        await shot('notice-changed')
        await page.getByRole('link', { name: 'Review your consent' }).click()
        await page.getByRole('checkbox').check()
        await submit('Accept training notice')
        assert.equal((await state()).decision.noticeVersion, 2)
        for (const door of ['download', 'admin', `catalog/${course.revision}`]) assert.equal((await f.h.raw(`${base}/${door}`, { cookie })).status, 404, 'Unknown external pages and downloads stay closed')
        const viewed = await f.h.raw('/api/beam/view.start', { cookie: f.cookies.owner, body: { learner: f.ids.learner } })
        const viewingCookie = `${f.cookies.owner}; beam_view=${(await viewed.json()).id}`
        assert.equal((await f.h.raw(base + '/consent', { cookie: viewingCookie })).status, 403)
        assert.equal((await f.h.fetch(base + '/consent', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ withdraw: true }) })).status, 403, 'Rendered writes still require exact Origin')
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
