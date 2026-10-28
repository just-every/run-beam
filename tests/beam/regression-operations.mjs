import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './regression-fixture.mjs'
import { file } from './harness.mjs'

export async function operationsCheck() {
  const start = Date.UTC(2026, 9, 27, 12)
  const f = await fixture({ clock: start, bindings: { BEAM_WEBHOOK_HOSTS: 'synthetic-beam-1.example.test' } })
  const { api, h, cookies, ids } = f
  try {
    const read = () => api('owner', 'operations')
    const accessEvents = async () => (await api('owner', 'audit?category=access&q=access.operations')).events
    const beforeAccess = await accessEvents()
    const empty = await read()
    const afterJson = await accessEvents()
    assert.equal(afterJson.length, beforeAccess.length + 1, 'JSON diagnostics access appends one audit event')
    assert.equal((await h.raw('/app/business/health', { cookie: cookies.owner })).status, 200)
    const afterPage = await accessEvents()
    assert.equal(afterPage.length, afterJson.length + 1, 'page diagnostics access appends one audit event')
    assert.deepEqual(afterPage.slice(0, 2).map(event => [event.actor, event.action, event.subject, event.detail, event.via, event.at]), [
      [ids.owner, 'access.operations', 'installation', { door: 'page' }, null, start],
      [ids.owner, 'access.operations', 'installation', { door: 'json' }, null, start],
    ], 'access lineage contains only the actor, fixed door and observation time')
    assert.deepEqual(empty.readiness, { database: 'readable', files: 'readable', providers: 'not_probed' })
    assert.deepEqual(empty.jobs, [])
    assert.deepEqual(empty.feeds, [])
    assert.deepEqual(empty.providers.map(p => [p.kind, p.failures, p.unknownOutcomes, p.lastSuccessAt]), [['webhook', 0, 0, null], ['model', 0, 0, null], ['ocr', 0, 0, null]])
    // Ordinary managers, learning administrators, scoped preparation and signed-out callers cannot read installation diagnostics.
    const unit = (await api('owner', 'unit.create', { name: 'Synthetic operations unit' })).id
    await api('owner', 'admin.grant', { unit, member: ids.other })
    for (const role of ['learner', 'manager', 'other']) {
      await api(role, 'operations', undefined, 403)
      assert.equal((await h.raw('/app/business/health', { cookie: cookies[role] })).status, 403)
    }
    assert.equal((await h.raw('/api/beam/operations')).status, 401)
    const credential = await api('manager', 'agent.issue', { expiresInSeconds: 3600 })
    assert.equal((await f.request('/api/beam/operations', { token: credential.token })).status, 403)
    const ownerCredential = await api('owner', 'agent.issue', { expiresInSeconds: 3600 })
    assert.equal((await f.request('/api/beam/operations', { token: ownerCredential.token })).status, 403)
    assert.deepEqual(await accessEvents(), afterPage, 'refused reads produce no successful access event')
    // Feed receipts are preparation; only an applied batch is a successful synchronization.
    const feed = (await api('owner', 'roster-feed.create', { name: 'Synthetic daily roster', headers: ['Employee ID', 'Name'], mapping: ['employeeId', 'name'], intervalMinutes: 15, terminationLimit: 10 })).id
    const received = await api('owner', 'roster-feed.receive', { feed, file: file('synthetic-beam-1.csv', 'Employee ID,Name\nsynthetic-beam-1,Synthetic colleague') })
    const holding = await read()
    assert.deepEqual(holding.jobs.filter(job => job.kind === 'roster_review').map(job => [job.state, job.count]), [['preview', 1]])
    const held = holding.feeds[0]
    assert.deepEqual([held.id, held.stale, held.held, held.lastReceivedAt, held.lastAppliedAt], [feed, false, 1, start, null])
    await api('owner', 'people.batch.apply', { batch: received.batch })
    const synchronized = await read()
    assert.deepEqual(synchronized.jobs.filter(job => job.kind === 'roster_review').map(job => [job.state, job.count]), [['applied', 1]])
    const applied = synchronized.feeds[0]
    assert.deepEqual([applied.held, applied.lastAppliedAt], [0, start])
    // A real failed provider send appears as failed history and retry backlog, never healthy.
    const c = await f.course('Synthetic operations course')
    const sub = await api('owner', 'webhook.subscribe', { name: 'Synthetic receiver', endpoint: 'https://synthetic-beam-1.example.test/hooks', consent: true, teams: [ids.team], courses: [c.id], events: ['publication'] })
    await api('owner', 'webhook.state', { subscription: sub.id, enabled: true, consent: true })
    await f.publish(await f.nextRevision(c))
    h.edge.webhookStatus = 204
    await api('owner', 'webhook.run', {})
    const interrupted = (await api('owner', 'webhooks')).deliveries[0]
    assert.equal(interrupted.state, 'delivered')
    const execution = (await api('owner', 'automation-controls')).executions.find(event => event.input.delivery === interrupted.id)
    assert.ok(execution)
    // Reproduce receiver acceptance followed by Worker loss before its delivery transaction,
    // as in the committed interrupted-send qualification. Recovery uses public reads.
    await h.db.prepare("UPDATE beam_automation_executions SET state='running',outcome='reserved',failure=NULL WHERE id=?").bind(execution.id).run()
    await h.db.prepare('DELETE FROM beam_webhook_attempts WHERE delivery_id=?').bind(interrupted.id).run()
    await h.db.prepare("UPDATE beam_webhook_deliveries SET state='sending',tries=0,outcome=NULL,send_token='synthetic-beam-1',send_started_at=?,send_expires_at=? WHERE id=?")
      .bind(start + 15 * 60000, start + 15 * 60000, interrupted.id).run()
    await h.setClock(start + 15 * 60000)
    assert.equal((await read()).feeds[0].stale, false, 'fresh at the interval boundary')
    await h.setClock(start + 15 * 60000 + 1)
    assert.equal((await read()).feeds[0].stale, true, 'stale after the interval boundary')
    assert.equal((await api('owner', 'webhooks')).deliveries[0].outcome, 'outcome_unknown')
    const uncertain = await read()
    assert.deepEqual(uncertain.providers[0], { kind: 'webhook', failures: 0, unknownOutcomes: 1, lastSuccessAt: null }, 'receiver acceptance remains unknown, never a known failure')
    const uncertainPage = await h.raw('/app/business/health', { cookie: cookies.owner })
    assert.equal(uncertainPage.status, 200)
    const uncertainHtml = await uncertainPage.text()
    assert.ok(uncertainHtml.includes('webhook: 0 known unsuccessful attempts'))
    assert.ok(uncertainHtml.includes('1 unknown outcome'))
    assert.ok(uncertainHtml.includes('may have accepted'))
    if (process.argv.includes('--browser')) await operationsBrowser(f)
    await api('owner', 'webhook.replay', { delivery: interrupted.id, confirm: true })
    await f.publish(await f.nextRevision(c))
    h.edge.webhookStatus = 503
    await api('owner', 'webhook.run', {})
    let health = await read()
    assert.deepEqual(health.jobs.filter(job => job.kind === 'webhook').map(job => [job.state, job.count]), [['delivered', 1], ['retry', 1]])
    assert.deepEqual(health.providers[0], { kind: 'webhook', failures: 1, unknownOutcomes: 1, lastSuccessAt: start + 15 * 60000 + 1 })
    const calls = h.edge.webhooks.length
    await read(); await h.raw('/app/business/health', { cookie: cookies.owner })
    assert.equal(h.edge.webhooks.length, calls, 'diagnostic reads never retry a provider call')
    h.edge.webhookStatus = 204
    const delivery = (await api('owner', 'webhooks')).deliveries.find(item => item.state === 'retry')
    await h.setClock(start + 16 * 60000 + 2)
    await api('owner', 'webhook.replay', { delivery: delivery.id })
    health = await read()
    assert.deepEqual(health.jobs.filter(job => job.kind === 'webhook').map(job => [job.state, job.count]), [['delivered', 2]])
    assert.deepEqual(health.providers[0], { kind: 'webhook', failures: 1, unknownOutcomes: 1, lastSuccessAt: start + 16 * 60000 + 2 })
    // The aggregate projection never includes provider keys, session secrets, endpoint or employee payloads.
    const serialized = JSON.stringify(health)
    for (const secret of [sub.key, credential.token, ...Object.values(h.vars)]) if (typeof secret === 'string' && secret.length > 20) assert.equal(serialized.includes(secret), false, 'private configuration absent')
    assert.equal(serialized.includes('Synthetic colleague'), false)
    assert.equal(serialized.includes('https://synthetic-beam-1.example.test/hooks'), false)
    // Oversize source uploads fail whole through the form door, then a smaller replacement succeeds unchanged.
    const before = await api('owner', 'sources')
    const fields = { title: 'Synthetic limit recovery', licence: 'owned', licenceEvidence: 'Employer-authored synthetic fixture', reviewer: ids.reviewer, provenance: 'Synthetic capacity qualification' }
    const failed = await h.submit('source.create', cookies.owner, { ...fields, file: new File([Buffer.alloc(health.limits.sourceFileBytes + 1, 65)], 'synthetic-beam-limit.txt') }, '/app/business/health')
    assert.equal(failed.searchParams.get('error'), 'file_size')
    assert.deepEqual(await api('owner', 'sources'), before)
    const bytes = Buffer.from('Synthetic intact replacement.\n')
    const saved = await api('owner', 'source.create', { ...fields, file: file('synthetic-beam-small.txt', bytes) })
    assert.deepEqual(Buffer.from(await (await h.raw(`/api/beam/source-files/${saved.versionId}`, { cookie: cookies.owner })).arrayBuffer()), bytes)
    assert.equal((await read()).usage.sourceVersionBytes, bytes.length)
    const scheduledBefore = (await read()).scheduledJobs
    assert.ok(scheduledBefore.length && scheduledBefore.every(job => job.outcome === 'not_run' && job.lastSuccessAt === null))
    await h.scheduled()
    const scheduledAfter = (await read()).scheduledJobs
    assert.ok(scheduledAfter.every(job => job.outcome === 'succeeded' && job.lastSuccessAt >= start))
    const roster = await api('owner', 'people.batch.preview', { file: file('synthetic-beam-roster.csv', 'Employee ID,Name\nsynthetic-beam-301,First employee\nsynthetic-beam-302,Second employee\n') })
    await api('owner', 'people.batch.apply', { batch: roster.id, limit: 1 })
    assert.equal((await read()).backlog.rosterRows, 1)
    await api('owner', 'people.batch.apply', { batch: roster.id })
    assert.equal((await read()).backlog.rosterRows, 0)
    await api('owner', 'person.directory', { member: ids.learner, employeeId: 'synthetic-beam-303' })
    const mapping = await api('owner', 'gusto.language.configure', { member: ids.learner, employeeId: 'synthetic-beam-303', employeeUuid: 'synthetic-beam-304', companyUuid: 'synthetic-beam-305', fieldId: 'synthetic-beam-306', environment: 'demo', version: 0, consent: true })
    assert.equal((await api('owner', 'gusto.language.pull', { mapping: mapping.id, version: mapping.version })).outcome, 'gusto_token_missing')
    assert.deepEqual((({ configured, stale, failures, lastSuccessAt }) => [configured, stale, failures, lastSuccessAt])((await read()).synchronization), [1, 1, 1, null])
  } finally { await h.close() }
}

async function operationsBrowser(f) {
  const { chromium, expect } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const evidence = process.env.BEAM_EVIDENCE_DIR || 'test-results'
  await mkdir(evidence, { recursive: true })
  const browser = await chromium.launch({ headless: true, ...(process.env.BEAM_BROWSER_EXECUTABLE ? { executablePath: process.env.BEAM_BROWSER_EXECUTABLE } : {}), args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
    try {
      await context.addCookies(f.cookies.owner.split('; ').map(cookie => { const at = cookie.indexOf('='); return { name: cookie.slice(0, at), value: cookie.slice(at + 1), url: f.h.origin } }))
      const page = await context.newPage()
      await page.goto(`${f.h.origin}/app/business`)
      await page.getByRole('link', { name: 'Readiness, jobs, roster synchronization, limits and ownership costs' }).click()
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Service health and capacity')
      await expect(page.getByText('webhook: 0 known unsuccessful attempts', { exact: true })).toBeVisible()
      await expect(page.getByText(/1 unknown outcome/)).toBeVisible()
      await expect(page.getByText('webhook: held', { exact: true })).toBeVisible()
      await expect(page.getByText('Synthetic daily roster', { exact: true })).toBeVisible()
      await expect(page.getByText('Stale · 0 held previews · 0 failures', { exact: true })).toBeVisible()
      await expect(page.getByText(/Last applied: 2026-10-27T12:00:00.000Z/)).toBeVisible()
      // Both touched settings screens use text-labelled controls; the shared navigation retains visible labels.
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        for (const [path, name] of [['/app/business', 'settings'], ['/app/business/health', 'health']]) {
          await page.goto(`${f.h.origin}${path}`)
          if (width === 1440) assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: no horizontal overflow`)
          await page.screenshot({ path: join(evidence, `${width}-operations-${name}.png`), fullPage: true })
        }
      }
    } finally { await context.close() }
  } finally { await browser.close() }
}
