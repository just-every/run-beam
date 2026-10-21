// OPS-007: a real older producer writes the archive; today's rer import upgrades it.
// Usage: BEAM_TEST_CHECKOUT=1 pnpm run test:legacy-restore -- /absolute/fresh/pre-0070-checkout
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { readArchive } from '@runeditrun/rer/modules/portability'
import { command, enter, serving } from './cli.mjs'
import { client, createLegacyData, digest } from './legacy-archive-data.mjs'

assert.equal(process.env.BEAM_TEST_CHECKOUT, '1', 'Use disposable fresh producer and destination checkouts')
const producer = resolve(process.argv.at(-1)), root = process.cwd()
assert.notEqual(producer, root, 'The historical producer is separate from the candidate')
await access(join(producer, 'migrations/core/0070_beam_restored_grants.sql')).then(() => assert.fail('OPS-007: producer must predate restored-grant columns'), error => { if (error.code !== 'ENOENT') throw error })
await access(join(producer, '.dev.vars')).then(() => assert.fail('Use a fresh unconfigured producer'), error => { if (error.code !== 'ENOENT') throw error })
const scratch = await mkdtemp(join(tmpdir(), 'beam-legacy-restore-')), target = join(scratch, 'target')
const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
const port = socket.address().port; await new Promise(resolve => socket.close(resolve))
const origin = `http://127.0.0.1:${port}`
let server, browser
async function setup(path) {
  await mkdir(join(path, 'exports'), { recursive: true })
  await writeFile(join(path, 'exports/answers.json'), JSON.stringify({ OWNER_EMAIL: 'owner@example.test' }), { mode: 0o600 })
  await command(path, ['setup', '--answers', 'exports/answers.json', '--non-interactive', '--port', String(port)])
}
async function records(path) {
  const data = await readFile(path), out = []
  for await (const record of readArchive(new ReadableStream({ start(controller) { controller.enqueue(data); controller.close() } }))) out.push(record)
  return out
}
const rows = records => records.filter(record => record.kind === 'part').flatMap(record => record.items).filter(item => item.kind === 'row')
try {
  await command(producer, ['install'])
  await setup(producer)
  server = await serving(producer, 'dev', port)
  const data = await createLegacyData(producer, origin)
  await server.stop(); server = null
  await command(producer, ['build'])
  const before = spawn(process.execPath, [join(root, 'tests/email-link.mjs')], { cwd: root, stdio: 'inherit', env: { ...process.env, BEAM_WORKER_CHECKOUT: producer } })
  assert.equal(await new Promise(resolve => before.once('exit', resolve)), 0, 'OPS-007: identical ordinary auth/mail/session qualification passes before replacement')
  await command(producer, ['export', '--output', 'exports/pre-change.rer'])
  const original = await records(join(producer, 'exports/pre-change.rer'))
  const oldRows = rows(original)
  assert.ok(!original[0].tables.find(table => table.name === 'beam_app_credentials').columns.some(column => (typeof column === 'string' ? column : column.name) === 'restored_at'), 'OPS-007: the producer exported its actual pre-change schema')
  const text = await readFile(join(producer, 'exports/pre-change.rer'), 'utf8')
  assert.ok(data.digests.every(hash => text.includes(hash)), 'OPS-007: the genuine old archive contains all three verifiers')
  const clone = spawn('git', ['clone', '--quiet', '--no-local', root, target], { stdio: 'ignore' })
  assert.equal(await new Promise(resolve => clone.once('exit', resolve)), 0)
  await command(target, ['install'])
  await mkdir(join(target, 'exports'), { recursive: true })
  await copyFile(join(producer, 'exports/pre-change.rer'), join(target, 'exports/pre-change.rer'))
  await command(target, ['import', '--input', 'exports/pre-change.rer', '--yes'])
  await command(target, ['export', '--output', 'exports/after-import.rer'])
  const restoredText = await readFile(join(target, 'exports/after-import.rer'), 'utf8')
  assert.ok(data.digests.every(hash => !restoredText.includes(hash)), 'OPS-007: re-export withholds every old verifier')
  const restored = rows(await records(join(target, 'exports/after-import.rer')))
  for (const table of ['beam_sources', 'beam_source_versions', 'beam_courses', 'beam_course_revisions', 'beam_assignments', 'beam_completions', 'beam_certificates']) {
    assert.deepEqual(restored.filter(row => row.table === table).map(row => row.row), oldRows.filter(row => row.table === table).map(row => row.row), `OPS-007: ${table} survives unchanged`)
  }
  for (const table of ['beam_app_credentials', 'beam_certificate_links', 'beam_dashboard_shares']) {
    const before = oldRows.filter(row => row.table === table).map(row => row.row)
    const after = restored.filter(row => row.table === table).map(row => row.row)
    for (const row of before) {
      const next = after.find(item => item.id === row.id)
      assert.ok(next && typeof next.restored_at === 'number', 'OPS-007: restored grant is marked disabled')
      const { restored_at, ...lineage } = next
      const hashColumn = table === 'beam_app_credentials' ? 'secret_sha256' : 'token_hash'
      delete lineage[hashColumn]
      const expected = { ...row }; delete expected[hashColumn]
      assert.deepEqual(lineage, expected, 'OPS-007: every decision-lineage column survives the real CLI upgrade')
    }
  }
  await setup(target)
  server = await serving(target, 'dev', port)
  const c = await client(target, origin)
  const bearer = token => fetch(`${origin}/api/beam/v1/report`, { headers: { authorization: `Bearer ${token}` } })
  assert.equal((await bearer(data.app.token)).status, 401, 'OPS-007: original app token is refused after legacy restore')
  assert.equal((await c.request(data.link.path)).status, 404, 'OPS-007: original certificate verifier is refused')
  assert.equal((await c.request(`/api/beam/dashboards/${data.dashboard.id}?key=${data.key}`, c.owner.cookie)).status, 404, 'OPS-007: original report key is refused')
  const download = await c.request(`/app/files/source/${data.source.versionId}?download=1`, c.owner.cookie)
  assert.equal(download.status, 200)
  assert.equal(digest(Buffer.from(await download.arrayBuffer())), data.sourceDigest, 'OPS-007: source bytes retain their independent digest')
  assert.deepEqual((await c.api(`records/${data.learnerId}`)).completions.find(row => row.id === data.completion.id), data.completion, 'OPS-007: exact completion remains readable')
  const app = (await c.api('app-credentials')).find(row => row.id === data.app.id)
  assert.equal(app.state, 'restored')
  assert.equal(app.issuedAt, data.app.issuedAt ?? oldRows.find(row => row.table === 'beam_app_credentials' && row.row.id === data.app.id).row.issued_at)
  assert.ok((await (await c.request('/app/access', c.owner.cookie)).text()).includes('disabled until you rotate it'))
  assert.ok((await (await c.request(`/app/dashboards/${data.dashboard.id}`, c.owner.cookie)).text()).includes('no longer works, create a new link'))
  if (process.env.BEAM_EVIDENCE_DIR) {
    const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
    browser = await chromium.launch({ headless: true, ...(process.env.BEAM_BROWSER_EXECUTABLE ? { executablePath: process.env.BEAM_BROWSER_EXECUTABLE } : {}), args: ['--use-mock-keychain', '--password-store=basic'] })
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } })
      await context.addCookies(c.owner.cookie.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: origin })))
      const page = await context.newPage()
      for (const [path, name] of [['/app/access', 'restored-access'], [`/app/dashboards/${data.dashboard.id}`, 'restored-report']]) {
        await page.goto(origin + path)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        await page.screenshot({ path: join(process.env.BEAM_EVIDENCE_DIR, `${width}-${name}.png`), fullPage: true })
      }
      await context.close()
    }
    await browser.close(); browser = null
  }
  const rotated = await c.api('app.rotate', { credential: data.app.id })
  assert.equal((await bearer(rotated.token)).status, 200, 'OPS-007: owner rotation restores the application integration')
  assert.equal((await bearer(data.app.token)).status, 401)
  const shared = await c.api('dashboard.link', { dashboard: data.dashboard.id, viewer: data.ownerId, expiresAt: new Date(Date.now() + 86_400_000).toISOString() })
  await c.api(shared.url.replace('/app/', ''))
  await c.api('person.access', { member: data.learnerId, status: 'active' })
  const learner = await enter(origin, c.key, 'learner')
  assert.equal(learner.status, 303)
  const link = await c.api('certificate.link', { certificate: data.completion.certificate }, learner.cookie)
  assert.equal((await c.request(link.path)).status, 200, 'OPS-007: a newly issued certificate verifier works')
  assert.equal((await c.request(data.link.path)).status, 404)
  const after = spawn(process.execPath, [join(root, 'tests/email-link.mjs')], { cwd: root, stdio: 'inherit', env: { ...process.env, BEAM_WORKER_CHECKOUT: root } })
  assert.equal(await new Promise(resolve => after.once('exit', resolve)), 0, 'OPS-007: identical ordinary auth/mail/session qualification passes after replacement')
  console.log('PASS OPS-007 genuine pre-change archive: public rer export/import, unchanged learning/files/lineage, disabled old grants, explicit owner reissue')
} finally {
  await browser?.close()
  await server?.stop().catch(() => {})
  await rm(scratch, { recursive: true, force: true })
}
