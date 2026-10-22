import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { fixture } from './regression-fixture.mjs'
import { file } from './harness.mjs'
import { workbook } from './fixtures.mjs'

// Folded into renewalCheck: imported evidence enters through the incumbent import door.
export async function creditRenewalCheck() {
  const f = await fixture(), { api, h, cookies, ids } = f
  const date = days => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
  try {
    const course = await f.course('Historical credit renewal')
    const bundle = Buffer.from(JSON.stringify({ courseList: file('courses.csv', 'ID,Course,Code,Category\r\n301,Historical credit renewal,CREDIT,Operations\r\n'), dateFormat: 'YMD', mappings: { 301: course.id }, reports: [{ course: '301', file: file('synthetic-beam-1.xlsx', workbook([['Users', [
      ['User', 'Email', 'Completion date', 'Score'],
      ['Learner', 'learner@example.test', date(-728), 90],
      ['Assessor', 'assessor@example.test', date(-640), 90],
      ['Other', 'other@example.test', date(-729), 90],
    ]]])) }] }))
    const door = async (action, body) => {
      const response = await h.fetch(`/api/operator/import/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: h.origin, 'X-Import-Source': 'talentlms', cookie: cookies.owner }, body: JSON.stringify(body) })
      assert.equal(response.status, 200, `credit import ${action}`)
      return response.json()
    }
    const sha = createHash('sha256').update(bundle).digest('hex')
    const { uploadId } = await door('uploads', { name: 'synthetic-beam-1.json', bundleSha256: sha, totalBytes: bundle.length, totalChunks: 1, index: 0, chunkSha256: sha, base64: bundle.toString('base64') })
    const plan = await door('plan', { uploadId })
    let state
    for (let batch = 0; batch < 50 && state !== 'completed'; batch++) state = (await door('apply', { planId: plan.planId, reviewedFingerprint: plan.fingerprint })).job.state
    assert.equal(state, 'completed')
    const imported = await api('owner', 'history')
    const approve = () => api('owner', 'credit.approve', { course: course.id, intervalDays: 730, reason: 'Reviewed TalentLMS training edition and interval' })
    const first = await approve()
    const rule = (await api('owner', 'renewal.save', { course: course.id, basis: 'expiry', leadDays: 2, graceDays: 3 })).id
    const preview = await api('owner', 'renewal.preview', { rule })
    assert.deepEqual(preview.items.map(row => [row.learner, row.outcome]).sort(), [[ids.learner, 'would_assign'], [ids.assessor, 'not_due'], [ids.other, 'would_assign']].sort())
    assert.ok(preview.items.every(row => row.source === 'history_credit' && row.dueDate === row.expiryDate))
    await api('owner', 'renewal.state', { rule, state: 'active' })
    const configure = async paused => {
      const { policy } = await api('owner', 'automation-controls')
      await api('owner', 'automation.policy', { version: policy.version, paused, quietStart: 0, quietEnd: 0, dailyLimit: 100 })
    }
    const tick = async () => assert.equal((await h.scheduled()).outcome, 'ok')
    const read = () => api('owner', 'renewals')
    const assignments = async member => (await api('owner', `records/${member}`)).assignments.filter(row => row.course === course.id)
    await configure(true); await tick()
    assert.ok((await api('owner', 'automation-controls')).executions.some(row => row.input.credit === first.id && row.outcome === 'paused'))
    await api('owner', 'credit.undo', { credit: first.id, reason: 'Recheck before enrollment' })
    await configure(false)
    await api('owner', 'renewal.replay', { rule })
    assert.deepEqual(await assignments(ids.learner), [], 'undo before replay prevents enrollment')
    const credit = await approve()
    const revision = await f.nextRevision(course); await f.publish(revision)
    await tick()
    let cycles = (await read()).cycles.filter(row => row.credit_id === credit.id)
    assert.equal(cycles.length, 2)
    assert.deepEqual(await assignments(ids.assessor), [], 'far-future credit is not renewed early')
    for (const cycle of cycles) {
      const assignment = await api('owner', `assignments/${cycle.assignment_id}`)
      const source = credit.credit.find(row => row.member === cycle.member_id)
      assert.equal(cycle.history_id, source.history)
      assert.equal(cycle.expires_at, source.expiresAt)
      assert.deepEqual([assignment.assignment.revision, assignment.assignment.dueDate, assignment.assignment.dueTime, assignment.assignment.timezone], [revision, source.expiresOn, '17:00', 'UTC'])
      assert.equal((await api('owner', `records/${cycle.member_id}`)).completions.filter(row => row.course === course.id).length, 0, 'a credit renewal issues no completion or certificate')
    }
    await tick(); await Promise.all([api('owner', 'renewal.replay', { rule }), api('owner', 'renewal.replay', { rule })])
    assert.equal((await read()).cycles.filter(row => row.credit_id === credit.id).length, 2)
    const native = (await api('owner', 'assignment.create', { course: course.id, learners: [ids.assessor], dueDate: '2030-10-01', dueTime: '17:00', timezone: 'UTC' })).created[0]
    for (const lesson of (await api('assessor', `assignments/${native}`)).lessons) await api('assessor', 'lesson.complete', { assignment: native, lesson: lesson.id })
    const completion = (await api('assessor', `assignments/${native}`)).completion
    const certificate = await api('owner', `certificates/${completion.certificate}`)
    assert.equal((await read()).rules.find(row => row.id === rule).items.find(row => row.learner === ids.assessor && row.source === 'history_credit').outcome, 'native_current')
    const learnerCycle = cycles.find(row => row.member_id === ids.learner)
    await api('owner', 'assignment.cancel', { assignment: learnerCycle.assignment_id, reason: 'Reviewed this renewal separately' })
    const replacement = (await api('owner', 'renewal.save', { course: course.id, basis: 'expiry', leadDays: 30, graceDays: 7 })).id
    await api('owner', 'renewal.preview', { rule: replacement })
    await api('owner', 'renewal.state', { rule: replacement, state: 'active' }); await tick()
    assert.equal((await assignments(ids.learner)).length, 1, 'replacement policy retains the already-used credit cycle')
    assert.equal((await assignments(ids.other)).length, 1)
    if (process.env.BEAM_RENEWAL_BROWSER === '1') await renewalBrowser(f)
    const retainedAssignments = await assignments(ids.other)
    await api('owner', 'credit.undo', { credit: credit.id, reason: 'Withdraw imported credit after assignment' })
    await tick()
    assert.deepEqual(await assignments(ids.other), retainedAssignments, 'undo after renewal preserves the real assignment')
    assert.deepEqual(await api('owner', `certificates/${completion.certificate}`), certificate)
    assert.deepEqual(await api('owner', 'history'), imported, 'renewal and undo preserve every imported source row')
  } finally { await h.close() }
}

export async function renewalBrowser(f, { course = 'Historical credit renewal', notices = false, prefix = notices ? 'renewal-notice' : 'credit-renewal' } = {}) {
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const { mkdir } = await import('node:fs/promises'), { join } = await import('node:path')
  const evidence = process.env.BEAM_EVIDENCE_DIR || 'test-results'
  await mkdir(evidence, { recursive: true })
  const browser = await chromium.launch({ ...(process.env.BEAM_BROWSER_EXECUTABLE ? { executablePath: process.env.BEAM_BROWSER_EXECUTABLE } : {}), headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true })
      await context.addCookies(f.cookies.owner.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: f.h.origin })))
      const page = await context.newPage(); await page.goto(f.h.origin + '/app/automation')
      for (const [name, heading] of [['settings', 'Scheduled renewals'], ['credit', `${course} · renewal`], ['cycles', 'Retained renewal cycles'], ...(notices ? [['notices', 'Renewal email history']] : [])]) {
        await page.getByRole('heading', { name: heading, exact: true }).first().scrollIntoViewIfNeeded()
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `credit renewal ${width}`)
        await page.screenshot({ path: join(evidence, `${width}-${prefix}-${name}.png`) })
      }
      if (notices) {
        await page.getByRole('heading', { name: 'Automation policy', exact: true }).scrollIntoViewIfNeeded()
        await page.screenshot({ path: join(evidence, `${width}-${prefix}-policy.png`) })
        await page.goto(f.h.origin + '/app/business')
        await page.getByRole('heading', { name: 'Provider costs (USD)', exact: true }).scrollIntoViewIfNeeded()
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        await page.screenshot({ path: join(evidence, `${width}-${prefix}-costs.png`) })
      }
      await context.close(); console.log(`PASS credit renewal settings/source/cycles ${width}`)
    }
  } finally { await browser.close() }
}
