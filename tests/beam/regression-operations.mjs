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
    const empty = await read()
    assert.deepEqual(empty.readiness, { database: 'readable', files: 'readable', providers: 'not_probed' })
    assert.deepEqual(empty.jobs, [])
    assert.deepEqual(empty.feeds, [])
    assert.deepEqual(empty.providers.map(p => [p.kind, p.failures, p.lastSuccessAt]), [['webhook', 0, null], ['model', 0, null], ['ocr', 0, null]])
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
    await h.setClock(start + 15 * 60000)
    assert.equal((await read()).feeds[0].stale, false, 'fresh at the interval boundary')
    await h.setClock(start + 15 * 60000 + 1)
    assert.equal((await read()).feeds[0].stale, true, 'stale after the interval boundary')
    // A real failed provider send appears as failed history and retry backlog, never healthy.
    const c = await f.course('Synthetic operations course')
    const sub = await api('owner', 'webhook.subscribe', { name: 'Synthetic receiver', endpoint: 'https://synthetic-beam-1.example.test/hooks', consent: true, teams: [ids.team], courses: [c.id], events: ['publication'] })
    await api('owner', 'webhook.state', { subscription: sub.id, enabled: true, consent: true })
    await f.publish(await f.nextRevision(c))
    h.edge.webhookStatus = 503
    await api('owner', 'webhook.run', {})
    let health = await read()
    assert.deepEqual(health.jobs.filter(job => job.kind === 'webhook').map(job => [job.state, job.count]), [['retry', 1]])
    assert.deepEqual(health.providers[0], { kind: 'webhook', failures: 1, lastSuccessAt: null })
    const calls = h.edge.webhooks.length
    await read(); await h.raw('/app/business/health', { cookie: cookies.owner })
    assert.equal(h.edge.webhooks.length, calls, 'diagnostic reads never retry a provider call')
    h.edge.webhookStatus = 204
    const delivery = (await api('owner', 'webhooks')).deliveries[0]
    await h.setClock(start + 16 * 60000 + 2)
    await api('owner', 'webhook.replay', { delivery: delivery.id })
    health = await read()
    assert.deepEqual(health.jobs.filter(job => job.kind === 'webhook').map(job => [job.state, job.count]), [['delivered', 1]])
    assert.deepEqual(health.providers[0], { kind: 'webhook', failures: 1, lastSuccessAt: start + 16 * 60000 + 2 })
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
    if (process.argv.includes('--browser')) await operationsBrowser(f)
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
      await expect(page.getByText('webhook: 1 unsuccessful attempts', { exact: true })).toBeVisible()
      await expect(page.getByText('webhook: delivered', { exact: true })).toBeVisible()
      await expect(page.getByText('Synthetic daily roster', { exact: true })).toBeVisible()
      await expect(page.getByText('Stale · 0 held previews · 0 failures', { exact: true })).toBeVisible()
      await expect(page.getByText(/Last applied: 2026-10-27T12:00:00.000Z/)).toBeVisible()
      // Both touched settings screens use text-labelled controls; the shared navigation retains visible labels.
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        for (const [path, name] of [['/app/business', 'settings'], ['/app/business/health', 'health']]) {
          await page.goto(`${f.h.origin}${path}`)
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: no horizontal overflow at ${width}`)
          await page.screenshot({ path: join(evidence, `${width}-operations-${name}.png`), fullPage: true })
        }
      }
    } finally { await context.close() }
  } finally { await browser.close() }
}
