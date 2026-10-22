import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPortability, readArchive } from '@runeditrun/rer/modules/portability'
import { exportArchive, fileRecords, importArchive } from '@runeditrun/rer/modules/portability/files'
import { migrationReplay } from '@runeditrun/rer/modules/portability/migration-history'
import policy, { WITHHELD } from '../../scripts/installer/portability-policy.mjs'
import { harness } from './harness.mjs'
const sha = value => createHash('sha256').update(value).digest('hex')
// The destination's applied migrations, as `rer import` replays them to recognise the rows they seed.
const root = fileURLToPath(new URL('../../', import.meta.url)), directory = join(root, 'migrations/core')
const { unstable_splitSqlQuery: splitSql } = createRequire(await realpath(join(root, 'node_modules/wrangler/package.json')))('wrangler')
const plan = await Promise.all((await readdir(directory)).filter(name => name.endsWith('.sql')).sort().map(async name => ({ name, statements: splitSql(await readFile(join(directory, name), 'utf8')) })))
const migrations = async () => migrationReplay(plan, policy)

// OPS-007 (ct 20 Oct 16:55Z): the installation archive `rer export` writes with Beam's archive policy carries no
// verifier hash for application credentials, certificate verification links or restricted report links, and keeps their
// decision lineage. Restored into an empty installation, each grant stays disabled until the owner reissues it: a
// rotated credential and a new link work, the restored token, link and key never do. An archive written without the
// withholding policy (as before it) still restores, and its grants come back disabled the same way.
export async function archiveCheck(f) {
  const { api, h, cookies, ids, course, assign, lessons } = f
  const app = await api('owner', 'app.issue', { name: 'Payroll report sync', audience: 'reports.read', expiresInDays: 30 })
  const bearer = (worker, token) => worker.fetch('/api/beam/v1/report', { headers: { authorization: `Bearer ${token}` } })
  assert.equal((await bearer(h, app.token)).status, 200)
  const c = await course('Archive certificate course')
  await lessons(await assign(c))
  const certificate = (await api('learner', 'records/me')).completions.find(row => row.course === c.id).certificate
  const link = await api('learner', 'certificate.link', { certificate })
  assert.equal((await h.fetch(link.path)).status, 200)
  const dashboard = await api('owner', 'dashboard.create', { name: 'Archive probe', course: c.id, team: ids.team, status: 'all', fields: ['name', 'status'] })
  const share = await api('owner', 'dashboard.link', { dashboard: dashboard.id, viewer: ids.owner, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() })
  const key = new URL(share.url, h.origin).searchParams.get('key')
  await api('owner', `dashboards/${dashboard.id}?key=${key}`)
  const verifiers = [sha(app.token.split('.')[2]), sha(link.id), sha(key)]

  const scratch = await mkdtemp(join(tmpdir(), 'beam-archive-'))
  try {
    const archive = join(scratch, 'withheld.rer'), legacy = join(scratch, 'legacy.rer')
    await exportArchive(await createPortability({ db: h.db, buckets: { files: h.files }, policy }), archive)
    const text = await readFile(archive, 'utf8')
    assert.ok(verifiers.every(value => !text.includes(value)), 'OPS-007: the archive carries no verifier hash')
    const rows = []
    for await (const record of fileRecords(archive, readArchive)) if (record.kind === 'part') rows.push(...record.items.filter(item => item.kind === 'row'))
    const row = (table, id) => rows.find(item => item.table === table && item.row.id === id).row
    const credential = row('beam_app_credentials', app.id)
    assert.deepEqual([credential.secret_sha256, credential.issued_by, credential.audience, credential.expires_at, credential.revoked_at], [WITHHELD, ids.owner, 'reports.read', app.expiresAt, null], 'OPS-007: the credential keeps its lineage without its hash')
    assert.deepEqual([row('beam_certificate_links', link.link).token_hash, row('beam_certificate_links', link.link).created_by], [`${WITHHELD}:${link.link}`, ids.learner])
    assert.deepEqual([row('beam_dashboard_shares', share.id).token_hash, row('beam_dashboard_shares', share.id).granted_by, row('beam_dashboard_shares', share.id).expires_at], [`${WITHHELD}:${share.id}`, ids.owner, share.expiresAt])
    // The archive Beam wrote before this policy: the same tables, verifier hashes included.
    const { exportRow, ...unwithheld } = policy
    await exportArchive(await createPortability({ db: h.db, buckets: { files: h.files }, policy: unwithheld }), legacy)
    const legacyText = await readFile(legacy, 'utf8')
    assert.ok(verifiers.every(value => legacyText.includes(value)), 'the legacy archive holds the hashes')

    for (const [path, withheld] of [[archive, true], [legacy, false]]) {
      const t = await harness()
      try {
        await importArchive(await createPortability({ db: t.db, buckets: { files: t.files }, policy, migrations }), path)
        assert.equal((await t.raw('/auth/bootstrap', { body: { token: t.vars.SETUP_TOKEN, displayName: 'Owner' } })).status, 303)
        const owner = await t.signIn('owner@example.test')
        // First-run confirmation belongs to the installation, not the archive.
        await t.raw('/setup', { cookie: owner, form: new URLSearchParams({ confirm: 'yes' }) })
        const restored = (await t.api('app-credentials', owner)).find(item => item.id === app.id)
        assert.deepEqual([restored.state, restored.audience, restored.issuedAt, restored.expiresAt, typeof restored.restoredAt], ['restored', 'reports.read', credential.issued_at, app.expiresAt, 'number'], `OPS-007: the restored credential is disabled with its lineage (${withheld ? 'withheld' : 'legacy'} archive)`)
        assert.ok((await (await t.raw('/app/access', { cookie: owner })).text()).includes('restored from an archive: disabled until you rotate it'))
        assert.equal((await bearer(t, app.token)).status, 401, 'OPS-007: the restored token never authenticates')
        assert.equal((await t.fetch(link.path)).status, 404, 'OPS-007: the restored verification link never verifies')
        assert.equal((await t.raw(`/api/beam/dashboards/${dashboard.id}?key=${key}`, { cookie: owner })).status, 404, 'OPS-007: the restored report link never opens')
        const links = (await t.api(`certificates/${certificate}`, owner)).links
        assert.deepEqual([links.length, links[0].revokedAt, typeof links[0].restoredAt], [1, null, 'number'])
        assert.ok((await (await t.raw(`/app/dashboards/${dashboard.id}`, { cookie: owner })).text()).includes('restored from an archive: no longer works, create a new link'))
        if (!withheld) continue
        // Reissue: the owner rotates the credential and creates a new report link; both work, the old token still does not.
        const rotated = await t.api('app.rotate', owner, { credential: app.id })
        assert.equal((await bearer(t, rotated.token)).status, 200, 'OPS-007: the rotated credential works')
        assert.equal((await bearer(t, app.token)).status, 401)
        assert.equal((await t.api('app-credentials', owner)).find(item => item.id === app.id).state, 'active')
        const renewed = await t.api('dashboard.link', owner, { dashboard: dashboard.id, viewer: (await t.api('me', owner)).id, expiresAt: new Date(Date.now() + 86_400_000).toISOString() })
        assert.equal((await t.raw(renewed.url.replace('/app/', '/api/beam/'), { cookie: owner })).status, 200, 'OPS-007: a new report link works')
      } finally { await t.close() }
    }
  } finally { await rm(scratch, { recursive: true, force: true }) }
}

// New integrations use the same real archive doors; no provider grant or signing secret revives on restore.
export async function integrationArchiveCheck(f, expected) {
  const directory = await mkdtemp(join(tmpdir(), 'beam-integration-archive-'))
  const target = await harness({ bindings: { BEAM_LTI_HOSTS: 'synthetic-beam-2.example.test', BEAM_WEBHOOK_HOSTS: 'synthetic-beam-1.example.test' } })
  try {
    const path = join(directory, 'integrations.rer'), before = await f.h.db.prepare('SELECT * FROM beam_completions WHERE id=?').bind(expected.completion).first()
    await exportArchive(await createPortability({ db: f.h.db, buckets: { files: f.h.files }, policy }), path)
    const records = []
    for await (const record of fileRecords(path, readArchive)) if (record.kind === 'part') records.push(...record.items.filter(item => item.kind === 'row'))
    const sub = records.find(item => item.table === 'beam_webhook_subscriptions' && item.row.id === expected.subscription).row
    assert.deepEqual([sub.key_cipher, sub.enabled], [WITHHELD, 0])
    assert.ok(records.filter(item => item.table === 'beam_lti_platform_keys').every(item => item.row.private_cipher === WITHHELD))
    assert.ok(!records.some(item => item.table === 'beam_lti_tokens'))
    const exported = await readFile(path, 'utf8')
    for (const secret of [expected.token, expected.key, f.h.vars.SESSION_SECRET, f.h.vars.MAIL_API_KEY]) assert.ok(!exported.includes(secret))
    await importArchive(await createPortability({ db: target.db, buckets: { files: target.files }, policy, migrations }), path)
    assert.equal((await target.raw('/auth/bootstrap', { body: { token: target.vars.SETUP_TOKEN, displayName: 'Owner' } })).status, 303)
    const owner = await target.signIn('owner@example.test')
    await target.raw('/setup', { cookie: owner, form: new URLSearchParams({ confirm: 'yes' }) })
    const restored = (await target.api('lti', owner)).tools.find(item => item.id === expected.tool)
    assert.ok(restored.revokedAt)
    await target.api('lti.deep-link', owner, { tool: expected.tool, course: before.course_id }, 403)
    await target.api('webhook.state', owner, { subscription: expected.subscription, enabled: true, consent: true }, 409)
    const held = (await target.api('webhooks', owner)).deliveries.find(row => row.subscription_id === expected.subscription)
    assert.deepEqual([held.state, held.outcome], ['held', 'restored'])
    const after = await target.db.prepare('SELECT * FROM beam_completions WHERE id=?').bind(expected.completion).first()
    assert.deepEqual(after, before, 'archiving and restoring preserve exact native and LTI completion lineage')
    const originalResults = await f.h.db.prepare('SELECT * FROM beam_lti_results ORDER BY id').all(), restoredResults = await target.db.prepare('SELECT * FROM beam_lti_results ORDER BY id').all()
    assert.deepEqual(restoredResults.results, originalResults.results)
    const rotated = await target.api('webhook.rotate', owner, { subscription: expected.subscription })
    assert.notEqual(rotated.key, expected.key)
    await target.api('webhook.state', owner, { subscription: expected.subscription, enabled: true, consent: true })
    await target.api('webhook.run', owner, {})
    assert.equal(target.edge.webhooks.length, 0, 'a restored delivery is not sent after rotation and re-enabling')
    await target.api('webhook.replay', owner, { delivery: held.id })
    assert.deepEqual(target.edge.webhooks.map(message => message.headers['x-beam-event-id']), [held.event_id], 'only the explicit replay sends it')
    console.log('PASS integration archives withhold keys/tokens, disable restored deployments and preserve result lineage')
  } finally { await target.close(); await rm(directory, { recursive: true, force: true }) }
}
