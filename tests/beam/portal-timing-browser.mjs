import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export async function portalTimingBrowser(f, { portal, course, foreignPortal }) {
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const evidence = process.env.BEAM_EVIDENCE_DIR || 'test-results'
  await mkdir(evidence, { recursive: true })
  const invitation = await f.api('owner', 'portal.invite', { portal: portal.id, email: 'synthetic-beam-31@example.test', name: 'Timed customer trainee', sendInvitation: true })
  const cookie = await f.h.signIn('synthetic-beam-31@example.test', { requested: true })
  const call = (door, body, status = 200) => f.h.api(`portal/${portal.id}/${door}`, cookie, body, status)
  await call('claim', { identity: invitation.id })
  await call('consent', { accept: true, noticeVersion: (await call('consent')).noticeVersion })
  const enrollment = await f.h.api(`portal/${portal.id}/enroll`, f.cookies.owner, { identity: invitation.id, revision: course.revision })
  const browser = await chromium.launch({ ...(process.env.BEAM_BROWSER_EXECUTABLE ? { executablePath: process.env.BEAM_BROWSER_EXECUTABLE } : {}), headless: true, args: ['--use-mock-keychain', '--password-store=basic', '--ignore-certificate-errors'] })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
    await context.addCookies(cookie.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: f.h.origin })))
    const page = await context.newPage(), base = `/portal/${portal.id}`
    const shot = async name => {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        for (const control of await page.locator('button,a').all()) assert.ok((await control.innerText()).trim())
        await page.screenshot({ path: join(evidence, `${width}-portal-timed-${name}.png`), fullPage: true })
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
    await page.goto(`${f.h.origin}${base}/learning?enrollment=${enrollment.id}`)
    await page.getByRole('button', { name: 'Mark lesson read', exact: true }).click()
    await page.getByRole('link', { name: 'Take assessment', exact: true }).click()
    await page.getByRole('button', { name: 'Start timed assessment', exact: true }).waitFor()
    await shot('ready')
    await page.getByRole('button', { name: 'Start timed assessment', exact: true }).click()
    await page.getByRole('button', { name: 'Save assessment answers', exact: true }).waitFor()
    let quiz = await call(`assessment?enrollment=${enrollment.id}`)
    const [choice, blank, order, match] = quiz.questions
    assert.equal(await page.locator(`[name="q_${choice.id}"]`).count(), 2)
    await shot('running')
    await page.locator(`[name="q_${choice.id}"][value="0"]`).check()
    await page.getByRole('button', { name: 'Save assessment answers', exact: true }).click()
    await page.reload()
    assert.equal(await page.locator(`[name="q_${choice.id}"][value="0"]`).isChecked(), true)
    const saved = await call(`assessment?enrollment=${enrollment.id}`)
    assert.deepEqual([saved.session.deadline, saved.session.version, saved.attempts.length], [quiz.session.deadline, 1, 0])
    await shot('saved')
    await f.h.setClock(quiz.session.deadline)
    await page.reload()
    await page.getByText('Attempt 1: 40% · Not passed', { exact: true }).waitFor()
    assert.equal((await call(`assessment?enrollment=${enrollment.id}`)).session, null)
    await shot('expired')
    await page.getByRole('button', { name: 'Start timed assessment', exact: true }).click()
    await page.getByRole('button', { name: 'Submit assessment', exact: true }).waitFor()
    await page.locator(`[name="q_${choice.id}"][value="0"]`).check()
    await page.locator(`[name="q_${blank.id}_0"]`).fill('synthetic-beam-14')
    for (const question of [order, match]) for (const part of [0, 1]) await page.locator(`[name="q_${question.id}_${part}"]`).selectOption(String(part))
    await page.getByRole('button', { name: 'Submit assessment', exact: true }).click()
    await page.getByText('Assessment passed', { exact: true }).waitFor()
    quiz = await call(`assessment?enrollment=${enrollment.id}`)
    assert.deepEqual(quiz.attempts.map(row => [row.percent, row.passed]), [[40, 0], [100, 1]])
    await shot('passed')
    await page.getByRole('link', { name: 'Review course completion', exact: true }).click()
    await page.getByRole('button', { name: 'Record course completion', exact: true }).click()
    await page.getByText('Course completed', { exact: true }).waitFor()
    assert.equal((await call(`completion?enrollment=${enrollment.id}`)).completion.attempt, quiz.attempts[1].id)
    await shot('earned')
    assert.equal((await f.h.raw(`/portal/${foreignPortal.id}/assessment?enrollment=${enrollment.id}`, { cookie })).status, 404)
    await context.close()
  } finally { await browser.close() }
}
