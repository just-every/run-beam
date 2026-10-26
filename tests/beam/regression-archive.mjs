import assert from 'node:assert/strict'
import { portalNotice } from './regression-portals.mjs'
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
export const migrations = async () => migrationReplay(plan, policy)

// OPS-007 (ct 20 Oct 16:55Z): the installation archive `rer export` writes with Beam's archive policy carries no
// verifier hash for application credentials, certificate verification links or restricted report links, and keeps their
// decision lineage. Restored into an empty installation, each grant stays disabled until the owner reissues it: a
// rotated credential and a new link work, the restored token, link and key never do. An archive written without the
// withholding policy (as before it) still restores, and its grants come back disabled the same way.
export async function archiveCheck(f) {
  const { api, h, cookies, ids, course, assign, lessons } = f
  await api('owner', 'source.ocr.configure', { operation: 'enable', apiKey: 'synthetic-beam-1', maxCostCents: 1000, consent: true })
  await api('owner', 'model.configure', { operation: 'enable', apiKey: 'synthetic-beam-2', maxCostCents: 1000, consent: true })
  const modelCipher = (await h.db.prepare('SELECT key_cipher FROM beam_model_config WHERE singleton=1').first()).key_cipher
  const ocrCipher = (await h.db.prepare('SELECT key_cipher FROM beam_source_ocr_config WHERE singleton=1').first()).key_cipher
  await api('owner', 'person.directory', { member: ids.learner, employeeId: 'synthetic-beam-1' })
  const frontline = await api('owner', 'frontline.issue', { member: ids.learner, username: 'synthetic-beam-1' })
  await api('owner', 'frontline.policy', { enabled: true })
  cookies.learner = await h.signIn('learner@example.test')
  const verifier = await h.db.prepare('SELECT hash,salt FROM beam_frontline_credentials WHERE member_id=?').bind(ids.learner).first()
  const app = await api('owner', 'app.issue', { name: 'Payroll report sync', audience: 'reports.read', expiresInDays: 30 })
  const bearer = (worker, token) => worker.fetch('/api/beam/v1/report', { headers: { authorization: `Bearer ${token}` } })
  assert.equal((await bearer(h, app.token)).status, 200)
  const c = await course('Archive certificate course')
  await api('owner', 'theme.save', { primary: '#173f5f', accent: '#325f8b', signinHeading: 'Training', signinText: 'Welcome', senderName: 'Training' })
  const portal = await api('owner', 'portal.create', { kind: 'partner', name: 'Archive partner', consentText: 'Partner training', confirm: true })
  await api('owner', 'portal.notice', { portal: portal.id, version: 0, ...portalNotice })
  const portalIdentity = await api('owner', 'portal.invite', { portal: portal.id, email: 'synthetic-beam-3@example.test', name: 'Partner learner', sendInvitation: true })
  const portalCookie = await h.signIn('synthetic-beam-3@example.test', { requested: true })
  await h.api(`portal/${portal.id}/claim`, portalCookie, { identity: portalIdentity.id })
  await h.api(`portal/${portal.id}/consent`, portalCookie, { accept: true, noticeVersion: 1 })
  await api('owner', 'portal.admin', { portal: portal.id, identity: portalIdentity.id })
  await lessons(await assign(c))
  const certificate = (await api('learner', 'records/me')).completions.find(row => row.course === c.id).certificate
  const link = await api('learner', 'certificate.link', { certificate })
  assert.equal((await h.fetch(link.path)).status, 200)
  const dashboard = await api('owner', 'dashboard.create', { name: 'Archive probe', course: c.id, team: ids.team, status: 'all', fields: ['name', 'status'] })
  const share = await api('owner', 'dashboard.link', { dashboard: dashboard.id, viewer: ids.owner, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() })
  const key = new URL(share.url, h.origin).searchParams.get('key')
  await api('owner', `dashboards/${dashboard.id}?key=${key}`)
  const verifiers = [sha(app.token.split('.')[2]), sha(link.id), sha(key), ocrCipher, modelCipher]

  const scratch = await mkdtemp(join(tmpdir(), 'beam-archive-'))
  try {
    const archive = join(scratch, 'withheld.rer'), legacy = join(scratch, 'legacy.rer')
    await exportArchive(await createPortability({ db: h.db, buckets: { files: h.files }, policy }), archive)
    const text = await readFile(archive, 'utf8')
    assert.ok(!text.includes(verifier.hash) && !text.includes(verifier.salt) && !text.includes(frontline.initialSecret), 'frontline authentication secrets never travel in an installation archive')
    assert.ok(verifiers.every(value => !text.includes(value)), 'OPS-007: the archive carries no verifier hash')
    const rows = []
    for await (const record of fileRecords(archive, readArchive)) if (record.kind === 'part') rows.push(...record.items.filter(item => item.kind === 'row'))
    assert.ok(!rows.some(item => ['beam_frontline_credentials', 'beam_frontline_policy'].includes(item.table)), 'archives omit both frontline credential rows and method activation')
    const row = (table, id) => rows.find(item => item.table === table && item.row.id === id).row
    const portalRow = row('beam_portal_identities', portalIdentity.id)
    assert.deepEqual([portalRow.operator_id, portalRow.invited_operator_id, portalRow.bound_at, portalRow.consent_at, typeof portalRow.revoked_at], [null, null, null, null, 'number'])
    assert.ok(rows.filter(item => item.table === 'beam_portal_consent_events').every(item => item.row.operator_id === null))
    assert.equal(typeof rows.find(item => item.table === 'beam_portal_administrators' && item.row.identity_id === portalIdentity.id).row.revoked_at, 'number')
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
        assert.equal((await t.raw('/auth/frontline', { body: { username: frontline.username, secret: frontline.initialSecret, newPassword: 'synthetic-beam-2-password' } })).status, 403, 'restored installs require explicit fresh authentication provisioning')
        const model = await t.api('model-account', owner)
        assert.deepEqual([model.enabled, model.hasKey], [false, false], 'archives cannot restore model custody or spending consent')
        const ocr = await t.api('source-ocr', owner)
        assert.deepEqual([ocr.enabled, ocr.hasKey], [false, false], 'an archive cannot reactivate OCR or restore its provider credential')
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
        const portalRoster = await t.api(`portal/${portal.id}/roster`, owner)
        assert.deepEqual(portalRoster.identities, [], 'restored portal identities cannot retain consent or account bindings')
        const freshInvitation = await t.api('portal.invite', owner, { portal: portal.id, email: 'synthetic-beam-3@example.test', name: 'Fresh portal admission', sendInvitation: true })
        assert.notEqual(freshInvitation.id, portalIdentity.id)
        const freshCookie = await t.signIn('synthetic-beam-3@example.test', { requested: true })
        await t.api(`portal/${portal.id}/claim`, freshCookie, { identity: portalIdentity.id }, 404)
        await t.api(`portal/${portal.id}/consent`, freshCookie, undefined, 404)
        await t.api(`portal/${portal.id}/claim`, freshCookie, { identity: freshInvitation.id })
        await t.api(`portal/${portal.id}/roster`, freshCookie, undefined, 403)
        await t.api(`portal/${portal.id}/consent`, freshCookie, { accept: true, noticeVersion: 1 })
        await t.api(`portal/${portal.id}/roster`, freshCookie, undefined, 403)
        assert.deepEqual((await t.api(`portal/${portal.id}/report`, owner)).enrollments, [])
        await t.api('portal.admin', owner, { portal: portal.id, identity: freshInvitation.id })
        assert.deepEqual((await t.api(`portal/${portal.id}/roster`, freshCookie)).identities.map(row => row.id), [freshInvitation.id])
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
    for (const secret of [expected.token, expected.key, f.h.vars.SESSION_SECRET, f.h.vars.MAIL_API_KEY, expected.cmi5Credential, expected.cmi5Fetch]) assert.ok(!exported.includes(secret))
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

// AUTO-004: the real portability archive retains notices but never restores permission to send them.
export async function renewalNoticeArchiveCheck(f, rule) {
  const scratch = await mkdtemp(join(tmpdir(), 'beam-renewal-archive-'))
  try {
    const archive = join(scratch, 'renewals.rer')
    await exportArchive(await createPortability({ db: f.h.db, buckets: { files: f.h.files }, policy }), archive)
    const t = await harness()
    try {
      await importArchive(await createPortability({ db: t.db, buckets: { files: t.files }, policy, migrations }), archive)
      assert.equal((await t.raw('/auth/bootstrap', { body: { token: t.vars.SETUP_TOKEN, displayName: 'Owner' } })).status, 303)
      const owner = await t.signIn('owner@example.test')
      await t.raw('/setup', { cookie: owner, form: new URLSearchParams({ confirm: 'yes' }) })
      let view = await t.api('renewals', owner)
      const restoredRule = view.rules.find(row => row.id === rule)
      assert.equal(restoredRule.notice_enabled, 0)
      assert.ok(view.notices.some(row => row.outcome === 'restored'))
      assert.ok(view.notices.some(row => row.outcome === 'outcome_unknown'))
      const before = t.edge.attempts.length
      await t.scheduled()
      await t.api('renewal.notice-consent', owner, { rule, version: restoredRule.notice_version, enabled: true, consent: true, costCents: 1 })
      for (const n of view.notices.filter(row => row.outcome === 'restored')) await t.api('renewal.notice-replay', owner, { notice: n.id })
      view = await t.api('renewals', owner)
      assert.ok(view.notices.filter(row => row.outcome !== 'outcome_unknown' && row.state !== 'accepted').every(row => ['suppressed','held'].includes(row.state)))
      assert.equal(t.edge.attempts.length, before, 'fresh consent cannot reactivate any archived mail cycle')
      assert.ok(view.cycles.length > 0, 'real renewal assignments and policy history survive')
      if (process.env.BEAM_RENEWAL_BROWSER === '1') {
        const { renewalBrowser } = await import('./regression-credit-renewals.mjs')
        await renewalBrowser({ h: t, cookies: { owner } }, { course: 'Notice renewal', notices: true, prefix: 'restored-renewal' })
      }
    } finally { await t.close() }
  } finally { await rm(scratch, { recursive: true, force: true }) }
}

// PACK-001/003 inherit OPS-007: learning evidence travels; playback and LRS
// authority do not. Call once with a combined SCORM/xAPI fixture, or omit the
// xAPI fields for a package-only qualification. Fixtures are created through
// the existing public package and xAPI HTTP doors by the caller.
// expected: { packageAssignment?, packageSession?, xapiAssignment?,
//             xapiConnection?, xapiActivity?, xapiStatement?, completion? }
export async function packageArchiveCheck(f, expected) {
  // Archive import may allocate different SQLite rowids; compare complete records by stable content.
  const stable = rows => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  const retained = ['beam_packages', 'beam_package_assets', 'beam_revision_packages', 'beam_package_runs',
    'beam_cmi5_packages', 'beam_cmi5_registrations', 'beam_cmi5_state', 'beam_revision_xapi', 'beam_xapi_actors', 'beam_xapi_statements', 'beam_xapi_attachments', 'beam_completions']
  const authority = ['beam_cmi5_sessions', 'beam_cmi5_statements', 'beam_package_sessions', 'beam_package_events', 'beam_xapi_connections', 'beam_xapi_activities', 'beam_xapi_launches']
  const source = Object.fromEntries(await Promise.all([...retained, ...authority].map(async table => [table, (await f.h.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results])))
  assert.ok(source.beam_package_sessions.length, 'archive qualification needs a real package launch')
  if (expected.packageSession) assert.ok(source.beam_package_sessions.some(row => row.id === expected.packageSession))
  if (expected.xapiStatement) assert.ok(source.beam_xapi_statements.some(row => row.id === expected.xapiStatement && row.status === 'accepted'))
  if (expected.completion) assert.ok(source.beam_completions.some(row => row.id === expected.completion))
  const packageEvidence = expected.packageAssignment ? await f.api('owner', `package-evidence/${expected.packageAssignment}`) : null
  const xapiEvidence = expected.xapiAssignment ? await f.api('owner', `xapi-evidence/${expected.xapiAssignment}`) : null
  const assignments = [...new Set([expected.packageAssignment, expected.xapiAssignment, expected.cmi5Assignment].filter(Boolean))]
  const completions = new Map(await Promise.all(assignments.map(async id => [id, (await f.api('owner', `assignments/${id}`)).completion])))
  const scratch = await mkdtemp(join(tmpdir(), 'beam-package-archive-'))
  try {
    const archive = join(scratch, 'packages.rer'), legacy = join(scratch, 'legacy-packages.rer')
    await exportArchive(await createPortability({ db: f.h.db, buckets: { files: f.h.files }, policy }), archive)
    const records = []
    for await (const record of fileRecords(archive, readArchive)) if (record.kind === 'part') records.push(...record.items.filter(item => item.kind === 'row'))
    const archived = table => records.filter(item => item.table === table).map(item => item.row)
    const text = await readFile(archive, 'utf8')
    const secrets = [...source.beam_package_sessions.flatMap(row => [row.id, row.auth_session_id]),
      ...source.beam_xapi_launches.map(row => row.auth_session_id),
      ...source.beam_xapi_connections.map(row => row.authorization_sealed),
      ...source.beam_xapi_activities.map(row => row.producer_sealed), f.h.vars.SESSION_SECRET, f.h.vars.MAIL_API_KEY, expected.cmi5Credential, expected.cmi5Fetch]
    assert.ok(secrets.filter(value => value && value !== WITHHELD).every(value => !text.includes(value)), 'archive contains no playback capability, parent session id, sealed producer/LRS credential or installation secret')
    const remapped = new Map(source.beam_package_events.map(event => [event.session_id, archived('beam_package_events').find(row => row.id === event.id)?.session_id]))
    for (const cmi5 of source.beam_cmi5_sessions) remapped.set(cmi5.session_id, archived('beam_cmi5_sessions').find(row => row.session_uuid === cmi5.session_uuid)?.session_id)
    for (const session of source.beam_package_sessions) {
      const id = remapped.get(session.id)
      assert.ok(id?.startsWith('withheld:') && id !== session.id, 'playback capability becomes an irreversible evidence identity')
      assert.ok(archived('beam_package_sessions').some(row => row.id === id), 'event foreign keys retain their session lineage')
    }
    const { exportRow, ...unwithheld } = policy
    await exportArchive(await createPortability({ db: f.h.db, buckets: { files: f.h.files }, policy: unwithheld }), legacy)
    for (const [path, modern] of [[archive, true], [legacy, false]]) {
      const target = await harness({ bindings: { BEAM_XAPI_HOSTS: f.h.vars.BEAM_XAPI_HOSTS ?? 'synthetic-beam-1.example.test' } })
      try {
        await importArchive(await createPortability({ db: target.db, buckets: { files: target.files }, policy, migrations }), path)
        assert.equal((await target.raw('/auth/bootstrap', { body: { token: target.vars.SETUP_TOKEN, displayName: 'Owner' } })).status, 303)
        const owner = await target.signIn('owner@example.test')
        await target.raw('/setup', { cookie: owner, form: new URLSearchParams({ confirm: 'yes' }) })
        // This database read is the same archive-fidelity check used by the
        // existing integration archive proof; live behavior is asserted below.
        for (const table of retained) assert.deepEqual(stable((await target.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results), stable(source[table]), `${table}: exact evidence survives ${modern ? 'withheld' : 'legacy'} restore`)
        const sessions = (await target.db.prepare('SELECT * FROM beam_package_sessions ORDER BY rowid').all()).results
        assert.equal(sessions.length, source.beam_package_sessions.length)
        for (const session of sessions) {
          const original = source.beam_package_sessions.find(row => (modern ? remapped.get(row.id) : row.id) === session.id)
          assert.ok(original)
          const { id, auth_session_id, expires_at, ended_at, initial_json, ...lineage } = session
          const { id: oldId, auth_session_id: oldAuth, expires_at: oldExpiry, ended_at: oldEnd, initial_json: oldInitial, ...originalLineage } = original
          assert.deepEqual(lineage, originalLineage)
          assert.equal(initial_json, source.beam_cmi5_sessions.some(c => c.session_id === oldId) ? '{}' : oldInitial)
          assert.ok(auth_session_id === WITHHELD && ended_at !== null && expires_at <= Date.now(), 'restored playback sessions are terminal')
          assert.equal(id, modern ? remapped.get(oldId) : oldId, 'restored session retains the archive evidence identity')
          const asset = (await target.raw(`/beam-package/${encodeURIComponent(id)}/index.html`)).status
          assert.ok([403, 404].includes(asset), 'restored session cannot serve a package asset')
          assert.ok([403, 404].includes((await target.raw(`/beam-package/${oldId}/index.html`)).status), 'the original capability cannot serve an asset')
        }
        const events = (await target.db.prepare('SELECT * FROM beam_package_events ORDER BY rowid').all()).results
        assert.deepEqual(stable(events), stable(source.beam_package_events.map(row => ({ ...row, session_id: modern ? remapped.get(row.session_id) : row.session_id }))), 'all runtime events retain their linked session, values and timing')
        if (packageEvidence) {
          const restored = await target.api(`package-evidence/${expected.packageAssignment}`, owner)
          assert.deepEqual(stable(restored.runs), stable(packageEvidence.runs))
          assert.deepEqual(stable(restored.events), stable(packageEvidence.events), 'restored package evidence remains publicly readable')
        }
        for (const assignment of assignments) assert.deepEqual((await target.api(`assignments/${assignment}`, owner)).completion, completions.get(assignment), 'restored native completion keeps its exact revision and evidence')
        const exported = await target.raw('/app/data-export.json', { cookie: owner }).then(response => response.json())
        for (const pkg of source.beam_packages.filter(row => !row.export_restriction)) {
          const original = exported.files.find(item => item.id === pkg.id)
          assert.ok(original, 'restored package originals remain in learning-data export')
          const bytes = await target.raw(original.href, { cookie: owner })
          assert.equal(bytes.status, 200)
          assert.equal(sha(Buffer.from(await bytes.arrayBuffer())), pkg.original_sha256, 'restored original package bytes are intact')
        }
        if (expected.cmi5Assignment) {
          const original = await f.api('owner', `cmi5-evidence/${expected.cmi5Assignment}`)
          const restored = await target.api(`cmi5-evidence/${expected.cmi5Assignment}`, owner)
          assert.deepEqual(restored.statements.map(s => s.statement), original.statements.map(s => s.statement), 'original cmi5 statements survive modern and legacy restore')
          assert.deepEqual(restored.sessions.map(s => s.session_uuid), original.sessions.map(s => s.session_uuid))
          assert.ok(restored.sessions.every(s => s.lifecycle === 'restored'))
          assert.equal((await target.raw(expected.cmi5Fetch, { method: 'POST' })).status, 403, 'restored one-time fetch is terminal')
          const rows = (await target.db.prepare('SELECT * FROM beam_cmi5_sessions').all()).results
          assert.ok(rows.every(s => s.fetch_hash === 'withheld' && s.auth_hash === null && s.active_registration === null))
        }
        if (!expected.xapiActivity) continue
        const configuration = await target.api('xapi', owner)
        assert.ok(configuration.connections.find(row => row.id === expected.xapiConnection)?.revoked_at, 'restored LRS consent is terminal')
        assert.ok(configuration.activities.find(row => row.id === expected.xapiActivity)?.revoked_at, 'restored producer consent is terminal')
        const ciphers = (await target.db.prepare('SELECT authorization_sealed FROM beam_xapi_connections UNION ALL SELECT producer_sealed FROM beam_xapi_activities').all()).results
        assert.ok(ciphers.every(row => row.authorization_sealed === WITHHELD), 'legacy restore erases credential ciphers as well as revoking them')
        const launches = (await target.db.prepare('SELECT * FROM beam_xapi_launches ORDER BY rowid').all()).results
        assert.equal(launches.length, source.beam_xapi_launches.length)
        for (const launch of launches) {
          const { auth_session_id, expires_at, ended_at, ...lineage } = launch
          const { auth_session_id: oldAuth, expires_at: oldExpiry, ended_at: oldEnd, ...originalLineage } = source.beam_xapi_launches.find(row => row.id === launch.id)
          assert.deepEqual(lineage, originalLineage, 'launch ids, registrations and outcomes remain exact evidence')
          assert.ok(auth_session_id === WITHHELD && ended_at !== null && expires_at <= Date.now(), 'restored xAPI launches are terminal')
        }
        if (xapiEvidence) {
          const evidence = await target.api(`xapi-evidence/${expected.xapiAssignment}`, owner)
          assert.deepEqual(stable(evidence.statements), stable(xapiEvidence.statements))
          assert.deepEqual(stable(evidence.attachments), stable(xapiEvidence.attachments))
          for (const attachment of evidence.attachments) {
            const response = await target.raw(`/app/xapi/attachments/${attachment.statement_id}/${attachment.sha256}`, { cookie: owner })
            assert.equal(response.status, 200)
            assert.equal(sha(Buffer.from(await response.arrayBuffer())), attachment.sha256, 'restored statement attachment bytes survive')
          }
        }
        const actor = await target.api('me', owner), activity = source.beam_xapi_activities.find(row => row.id === expected.xapiActivity)
        const assigned = await target.api('assignment.create', owner, { course: activity.course_id, learners: [actor.id], dueDate: '2030-10-01' })
        const refused = await target.api('xapi.launch', owner, { assignment: assigned.created[0] ?? assigned.kept[0], activity: activity.id }, 403)
        assert.equal(refused.error, 'xapi_activity_not_assigned', 'a fresh owner session cannot launch a revoked restored producer')
      } finally { await target.close() }
    }
    console.log('PASS package archives withhold capabilities and credentials, fence legacy access and preserve exact learning evidence')
  } finally { await rm(scratch, { recursive: true, force: true }) }
}
