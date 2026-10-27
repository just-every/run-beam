import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// The same public pages and real form decisions run at both viewport widths.
export async function portalPracticalBrowser(f, { portal, foreignPortal, course }) {
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const evidence = process.env.BEAM_EVIDENCE_DIR || 'test-results'
  await mkdir(evidence, { recursive: true })
  const browser = await chromium.launch({ ...(process.env.BEAM_BROWSER_EXECUTABLE ? { executablePath: process.env.BEAM_BROWSER_EXECUTABLE } : {}), headless: true, args: ['--use-mock-keychain', '--password-store=basic', '--ignore-certificate-errors'] })
  try {
    for (const [index, width] of [1440, 390].entries()) {
      const email = `synthetic-beam-${47 + index}@example.test`
      const invitation = await f.api('owner', 'portal.invite', { portal: portal.id, email, name: `Practical browser learner ${width}`, sendInvitation: true })
      const cookie = await f.h.signIn(email, { requested: true })
      const call = (door, body, status = 200) => f.h.api(`portal/${portal.id}/${door}`, cookie, body, status)
      await call('claim', { identity: invitation.id })
      await call('consent', { accept: true, noticeVersion: (await call('consent')).noticeVersion })
      const enrollment = await f.h.api(`portal/${portal.id}/enroll`, f.cookies.owner, { identity: invitation.id, revision: course.revision })
      const makeContext = async auth => {
        const context = await browser.newContext({ viewport: { width, height: 1000 }, ignoreHTTPSErrors: true })
        await context.addCookies(auth.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: f.h.origin })))
        return context
      }
      const learner = await makeContext(cookie), owner = await makeContext(f.cookies.owner)
      try {
        const page = await learner.newPage(), review = await owner.newPage(), base = `${f.h.origin}/portal/${portal.id}`
        const shot = async (target, name) => {
          assert.equal(await target.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Portal evidence pages fit the viewport')
          for (const control of await target.locator('button,a').all()) assert.ok((await control.innerText()).trim(), 'Every action has visible text')
          await target.screenshot({ path: join(evidence, `${width}-portal-practical-${name}.png`), fullPage: true })
        }
        await page.goto(`${base}/learning?enrollment=${enrollment.id}`)
        await page.getByRole('button', { name: 'Mark lesson read', exact: true }).click()
        await page.goto(`${base}/practical?enrollment=${enrollment.id}`)
        await page.getByRole('button', { name: 'Submit practical evidence', exact: true }).waitFor()
        await shot(page, 'ready')
        await page.getByLabel('Describe what you did', { exact: true }).fill('synthetic-beam-49: I inspected the guard and found a loose fastener.')
        await page.getByRole('button', { name: 'Submit practical evidence', exact: true }).click()
        await page.getByText('Awaiting the named assessor', { exact: true }).waitFor()
        await shot(page, 'pending')
        await review.goto(`${base}/practical-review?enrollment=${enrollment.id}`)
        await review.getByRole('button', { name: 'Request resubmission', exact: true }).waitFor()
        await shot(review, 'review')
        await review.getByLabel('Decision note', { exact: true }).fill('Secure the fastener and record the new inspection.')
        await review.getByRole('button', { name: 'Request resubmission', exact: true }).click()
        await review.getByText('Resubmission requested', { exact: true }).waitFor()
        await page.reload()
        await page.getByRole('button', { name: 'Submit practical evidence', exact: true }).waitFor()
        await shot(page, 'rejected')
        await page.getByLabel('Describe what you did', { exact: true }).fill('synthetic-beam-50: I secured the fastener, inspected again and recorded a safe station.')
        await page.getByRole('button', { name: 'Submit practical evidence', exact: true }).click()
        await page.getByText('Awaiting the named assessor', { exact: true }).waitFor()
        await shot(page, 'resubmitted')
        await review.reload()
        await review.getByLabel('Decision note', { exact: true }).fill('The corrected inspection meets the enrolled practical task.')
        await review.getByRole('button', { name: 'Accept evidence', exact: true }).click()
        await review.getByText('Evidence accepted', { exact: true }).waitFor()
        await page.reload()
        await page.getByText('Practical evidence accepted.', { exact: true }).waitFor()
        await shot(page, 'accepted')
        assert.equal((await call(`completion?enrollment=${enrollment.id}`)).qualified, false, 'Accepted practical evidence cannot substitute for the quiz')
        await page.goto(`${base}/assessment?enrollment=${enrollment.id}`)
        await page.getByRole('radio', { name: 'Inspect the station', exact: true }).check()
        await page.getByRole('button', { name: 'Submit assessment', exact: true }).click()
        await page.getByText('Assessment passed', { exact: true }).waitFor()
        const candidate = await call(`completion?enrollment=${enrollment.id}`)
        assert.equal(candidate.qualified, true)
        assert.equal(candidate.completion, null)
        await page.getByRole('link', { name: 'Review course completion', exact: true }).click()
        await page.getByRole('button', { name: 'Record course completion', exact: true }).click()
        await page.getByText('Course completed', { exact: true }).waitFor()
        await shot(page, 'earned')
        assert.equal((await f.h.raw(`/portal/${foreignPortal.id}/practical?enrollment=${enrollment.id}`, { cookie })).status, 404)
        assert.equal((await f.h.raw(`/portal/${foreignPortal.id}/practical-review?enrollment=${enrollment.id}`, { cookie: f.cookies.owner })).status, 404)
        assert.equal((await f.h.raw(`/portal/${portal.id}/practical-review?enrollment=${enrollment.id}`, { cookie: `${f.cookies.owner}; beam_view=synthetic-beam-51` })).status, 403)
      } finally { await learner.close(); await owner.close() }
    }
  } finally { await browser.close() }
}
