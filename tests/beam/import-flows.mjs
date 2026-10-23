// Import conformance uses the actual migrated Worker and native public reads.
import assert from 'node:assert/strict'
import {createHash, generateKeyPairSync, randomUUID, sign} from 'node:crypto'
import {courseListCsv, courseReport, workbook} from './fixtures.mjs'
import {file, harness} from './harness.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export function importTrust() {
  const keys = Object.fromEntries(['business-a', 'business-b'].map(kid => [kid, generateKeyPairSync('ec', {namedCurve: 'prime256v1'})]))
  return {keys, bindings: {RER_OWNER_CLAIM_ISSUER: 'https://business.example.test', RER_OWNER_CLAIM_INSTALLATION_ID: 'beam-http-tests',
    RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify(Object.fromEntries(Object.entries(keys).map(([kid, key]) => [kid, key.publicKey.export({format: 'jwk'})])))}}
}

export async function importFlows({h, people, ids, trust}) {
  const nativeSnapshot = async () => (await h.api('history', people.owner)).sort((a, b) => a.id.localeCompare(b.id))
  const progressForm = async (action, fields) => {
    const response = await h.raw(`/app/import/${action}`, {cookie: people.owner, form: new URLSearchParams(fields)})
    assert.equal(response.status, 303, `${action} redirects to retained import history`)
    const target = response.headers.get('location')
    const history = await nativeSnapshot(), jobs = await h.api('imports', people.owner)
    for (let read = 0; read < 2; read++) assert.equal((await h.raw(target, {cookie: people.owner})).status, 200, 'opening and reloading import progress is a read')
    assert.deepEqual(await nativeSnapshot(), history, 'refresh does not replay the import write')
    assert.deepEqual(await h.api('imports', people.owner), jobs, 'refresh does not advance apply or undo')
  }
  const ownerRequest = (action, body, _review, cookie = people.owner, extra = {}) => h.fetch(`/api/operator/import/${action}`, {
    method: 'POST', headers: {'content-type': 'application/json', origin: h.origin, 'X-Import-Source': 'talentlms', ...(cookie ? {cookie} : {}), ...extra}, body: JSON.stringify(body),
  })
  const grant = (action, review, {kid = 'business-a', namespace = 'talentlms'} = {}) => {
    const iat = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({alg: 'ES256', typ: 'rer-import-grant+jwt', kid})).toString('base64url')
    const payload = Buffer.from(JSON.stringify({v: 1, iss: h.vars.RER_OWNER_CLAIM_ISSUER, aud: h.origin,
      installationId: h.vars.RER_OWNER_CLAIM_INSTALLATION_ID, email: h.vars.OWNER_EMAIL, jti: randomUUID(), iat, exp: iat + 300,
      action, namespace, maxBytes: 64 * 1024 * 1024, maxChunks: 1024, maxRecords: 100_000,
      ...(action === 'apply' ? review : {})})).toString('base64url')
    const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {key: trust.keys[kid].privateKey, dsaEncoding: 'ieee-p1363'}).toString('base64url')
    return `${header}.${payload}.${signature}`
  }
  const businessRequest = (action, body, review, options) => h.fetch(`/api/rer/import/${action}`, {
    method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${grant(action, review, options)}`}, body: JSON.stringify(body),
  })
  const json = async (request, action, body, review, expected = 200) => {
    const response = await request(action, body, review), value = await response.json()
    assert.equal(response.status, expected, `${action}: ${response.status} ${value.error ?? ''}`)
    return value
  }
  const until = async (request, action, body, review, state) => {
    for (let batch = 0; batch < 100; batch++) {
      const result = await json(request, action, body, review)
      if (result.job?.state === state) return result.job
      assert.ok(['queued', 'applying', 'undoing'].includes(result.job?.state), `${action} stopped at ${result.job?.state}`)
    }
    assert.fail(`${action} did not finish`)
  }
  const upload = async (request, bytes) => {
    const bundleSha256 = hash(bytes), totalChunks = Math.ceil(bytes.length / 65536)
    let uploadId
    for (let index = 0; index < totalChunks; index++) {
      const chunk = bytes.subarray(index * 65536, (index + 1) * 65536)
      uploadId = (await json(request, 'uploads', {uploadId, name: 'talentlms.json', bundleSha256,
        totalBytes: bytes.length, totalChunks, index, chunkSha256: hash(chunk), base64: chunk.toString('base64')})).uploadId
    }
    const inventory = await json(request, 'uploads', {uploadId})
    assert.equal(inventory.complete, true)
    assert.equal(inventory.bundleSha256, bundleSha256)
    assert.equal(inventory.received.reduce((n, chunk) => n + chunk.size, 0), bytes.length)
    return uploadId
  }
  const bytes = Buffer.from(JSON.stringify({courseList: file('courses.csv', courseListCsv), reports: [{course: '101', file: file('course-101.xlsx', courseReport({learnerEmail: 'sam@example.test'}))}], dateFormat: 'DMY', mappings: {'101': ids.opening}}))
  const assertApplied = async () => {
    const history = await nativeSnapshot()
    assert.equal(history.length, 5)
    const completions = history.filter(row => row.kind === 'completion')
    assert.deepEqual(completions.map(row => [row.email, row.completedOn]).sort(), [['jo.former@example.test', '2025-03-24'], ['sam@example.test', '2024-02-02'], ['sam@example.test', '2025-03-14']])
    assert.ok(completions.every(row => row.historical && row.source === 'TalentLMS'))
    assert.equal(history.find(row => row.sourceId === '101').mappedCourse, ids.opening)
    const sam = await h.api('records/me', people.sam)
    assert.equal(sam.history.length, 2)
    assert.equal(sam.completions.length, 1, 'imports never satisfy current assignments')
    // OPS-002: interchange retains labelled source history and IDs, independently readable without Beam.
    const exported = await (await h.raw('/app/data-export.json', { cookie: people.owner })).json()
    const records = exported.records.beam_imported_history
    assert.equal(records.count, history.length)
    assert.deepEqual(records.rows.map(row => ({ id: row.id, kind: row.kind, revision: row.revision, ...JSON.parse(row.payload) })).sort((a, b) => a.id.localeCompare(b.id)), history)
    assert.ok(records.rows.filter(row => row.kind === 'completion').every(row => JSON.parse(row.payload).historical))
    assert.equal(records.sha256, hash(Buffer.from(JSON.stringify(records.rows))))
    console.log('OPS-002 labelled imported history and source lineage passed')
  }
  const conformance = async request => {
    const before = await nativeSnapshot(), uploadId = await upload(request, bytes)
    const plan = await json(request, 'plan', {uploadId})
    assert.equal(plan.bundleSha256, hash(bytes))
    assert.ok(plan.summary.sourceRecords > 0)
    assert.ok(plan.rejected.some(row => row.reason.includes('31/31/2025')))
    assert.deepEqual(await nativeSnapshot(), before, 'planning writes no native records')
    if (request === ownerRequest) {
      const screen = await h.raw('/app/import/preview', {cookie: people.owner, form: new URLSearchParams({uploadId})})
      assert.equal(screen.status, 200)
      assert.ok((await screen.text()).includes(plan.fingerprint), 'the screen reviews the retained public-door plan')
      assert.deepEqual(await nativeSnapshot(), before)
    }
    const review = {fingerprint: plan.fingerprint, approvalRecordId: randomUUID(), approvedAt: new Date().toISOString()}
    const wrong = (plan.fingerprint[0] === '0' ? '1' : '0') + plan.fingerprint.slice(1)
    await json(request, 'apply', {planId: plan.planId, reviewedFingerprint: wrong}, review, 403)
    assert.deepEqual(await nativeSnapshot(), before)
    const job = await until(request, 'apply', {planId: plan.planId, reviewedFingerprint: plan.fingerprint}, review, 'completed')
    const status = await json(request, 'status', {planId: plan.planId})
    assert.equal(status.job.id, job.id)
    assert.equal(status.job.state, 'completed')
    const report = await json(request, 'reconcile', {planId: plan.planId})
    assert.equal(report.ok, true)
    assert.equal(report.fingerprint, plan.fingerprint)
    assert.equal(report.bundleSha256, hash(bytes))
    assert.equal(report.counts.sourceRecords, plan.summary.sourceRecords)
    assert.equal(report.counts.present + report.counts.explained, report.counts.sourceRecords)
    assert.equal(report.sourceIds.length, report.counts.sourceRecords)
    await assertApplied()
    // A completed apply is a true replay: the same receipt and no additional native effects.
    const completedHistory = await nativeSnapshot()
    const replay = await json(request,'apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint},review)
    assert.deepEqual(replay.job,job)
    assert.deepEqual(await nativeSnapshot(),completedHistory)
    await until(request, 'undo', {planId: plan.planId}, undefined, 'undone')
    assert.deepEqual(await nativeSnapshot(), before)
  }

  // Removed importer routes cannot create a second path behind the screen.
  for (const old of ['import.preview', 'import.apply', 'import.job']) await h.api(old, people.owner, {}, 404)
  assert.equal((await ownerRequest('uploads', {}, undefined, '')).status, 401)
  assert.equal((await ownerRequest('uploads', {}, undefined, people.manager)).status, 401)
  assert.equal((await ownerRequest('uploads', {}, undefined, people.owner, {origin: 'https://elsewhere.example.test'})).status, 403)
  assert.equal((await ownerRequest('uploads', {}, undefined, people.owner, {'X-Import-Source': 'unknown'})).status, 400)
  await h.api('import.settings', people.manager, {enabled: true}, 403)
  const screen = await h.raw('/app/import', {cookie: people.owner})
  assert.equal(screen.status, 200)
  assert.match(screen.headers.get('content-security-policy'), /script-src 'self'/)
  assert.match(screen.headers.get('content-security-policy'), /connect-src 'self'/)
  assert.ok((await screen.text()).includes('/app/import/client.js'))
  const browser = await h.raw('/app/import/client.js', {cookie: people.owner})
  assert.equal(browser.status, 200)
  assert.match(browser.headers.get('content-type'), /javascript/)
  const settings = await h.api('import-settings', people.owner)
  assert.equal(settings.enabled, false)
  assert.equal((await businessRequest('uploads', {})).status, 404)
  await conformance(ownerRequest)
  assert.ok((await h.api('imports', people.owner)).some(job => job.reviewer === 'operator' && !job.caption.includes('via Business')))

  await h.api('import.settings', people.owner, {enabled: true})
  assert.equal((await businessRequest('uploads', {}, undefined, {namespace: 'unknown'})).status, 403)
  await conformance(businessRequest)
  assert.ok((await h.api('imports', people.owner)).some(job => job.caption.includes('via Business')))

  // Disabled Business and permanent revocation never strand owner history/undo.
  const grantUpload = await upload(businessRequest, bytes)
  const grantPlan = await json(businessRequest, 'plan', {uploadId: grantUpload})
  const approval = {fingerprint: grantPlan.fingerprint, approvalRecordId: randomUUID(), approvedAt: new Date().toISOString()}
  await until(businessRequest, 'apply', {planId: grantPlan.planId, reviewedFingerprint: grantPlan.fingerprint}, approval, 'completed')
  await h.api('import.settings', people.owner, {enabled: false, revokeKey: 'business-a'})
  assert.equal((await businessRequest('status', {planId: grantPlan.planId})).status, 404)
  await until(ownerRequest, 'undo', {planId: grantPlan.planId}, undefined, 'undone')
  assert.deepEqual(await nativeSnapshot(), [])
  await h.api('import.settings', people.owner, {enabled: true})
  assert.deepEqual((await h.api('import-settings', people.owner)).revokedKeys, ['business-a'])
  assert.equal((await businessRequest('status', {planId: grantPlan.planId})).status, 403)
  assert.equal((await businessRequest('status', {planId: grantPlan.planId}, undefined, {kid: 'business-b'})).status, 200)
  await h.api('import.settings', people.owner, {enabled: false})

  // Largest fixture: original multi-chunk transport, bounded apply, fixed-query
  // reconcile and catch-up replacing an imported target through its real writer.
  const largeBundle = score => Buffer.from(JSON.stringify({
    courseList: file('courses.csv', 'ID,Course,Code,Category\r\n201,Safety,SAFE,Operations\r\n'),
    reports: [{course: '201', file: file('large.xlsx', workbook([['Users', [
      ['User', 'Email', 'Completion date', 'Score'],
      ...Array.from({length: 124}, (_, i) => [`Person ${i}`, `person${i}@example.test`, '2025-01-01', i === 0 ? score : 90]),
    ]]]))}], dateFormat: 'YMD',
    // A harmless export note ensures the original envelope spans upload chunks.
    exportNote: 'Documented synthetic export. '.repeat(3000),
  }))
  const largeUpload = await upload(ownerRequest, largeBundle(70))
  const large = await json(ownerRequest, 'plan', {uploadId: largeUpload})
  const transientSession = await h.signIn(h.vars.OWNER_EMAIL)
  const transientRequest = (action, body, review) => ownerRequest(action, body, review, transientSession)
  const first = await json(transientRequest, 'apply', {planId: large.planId, reviewedFingerprint: large.fingerprint})
  assert.ok(['queued', 'applying'].includes(first.job.state), 'the first batch is bounded')
  assert.equal((await h.raw('/auth/signout', {cookie: transientSession, body: {}})).status, 204)
  const afterRevocation = await nativeSnapshot()
  assert.equal((await transientRequest('apply', {planId: large.planId, reviewedFingerprint: large.fingerprint})).status, 401)
  assert.deepEqual(await nativeSnapshot(), afterRevocation, 'revoked session cannot continue a mutation')
  await until(ownerRequest, 'apply', {planId: large.planId, reviewedFingerprint: large.fingerprint}, undefined, 'completed')
  assert.equal((await json(ownerRequest, 'reconcile', {planId: large.planId})).ok, true)
  const changedUpload = await upload(ownerRequest, largeBundle(95))
  const changed = await json(ownerRequest, 'plan', {uploadId: changedUpload, catchup: true})
  assert.equal(changed.summary.updated, 1)
  await until(ownerRequest, 'apply', {planId: changed.planId, reviewedFingerprint: changed.fingerprint}, undefined, 'completed')
  assert.equal((await nativeSnapshot()).find(row => row.email === 'person0@example.test').score, '95')
  assert.equal((await json(ownerRequest, 'reconcile', {planId: changed.planId})).ok, true)
  await until(ownerRequest, 'undo', {planId: changed.planId}, undefined, 'undone')
  assert.equal((await nativeSnapshot()).find(row => row.email === 'person0@example.test').score, '70')
  await until(ownerRequest, 'undo', {planId: large.planId}, undefined, 'undone')
  assert.deepEqual(await nativeSnapshot(), [])

  // Public native review is a protected edit. Reconcile reports it; undo keeps it.
  const lastUpload = await upload(ownerRequest, bytes)
  const last = await json(ownerRequest, 'plan', {uploadId: lastUpload})
  await progressForm('apply', {planId: last.planId, reviewedFingerprint: last.fingerprint})
  await until(ownerRequest, 'apply', {planId: last.planId, reviewedFingerprint: last.fingerprint}, undefined, 'completed')
  const jo = (await nativeSnapshot()).find(row => row.email === 'jo.former@example.test')
  await h.api('history.accept', people.manager, {history: jo.id, note: 'Matches our 2025 paper records.'})
  assert.equal((await json(ownerRequest, 'reconcile', {planId: last.planId})).ok, false)
  const nativeCheck = await h.raw('/app/import/reconcile', {cookie: people.owner, form: new URLSearchParams({planId: last.planId})})
  assert.equal(nativeCheck.status, 200)
  assert.ok((await nativeCheck.text()).includes(jo.id))
  await progressForm('undo', {planId: last.planId})
  await until(ownerRequest, 'undo', {planId: last.planId}, undefined, 'undone')
  const left = await nativeSnapshot()
  assert.deepEqual(left.map(row => row.id), [jo.id])
  assert.equal(left[0].accepted.note, 'Matches our 2025 paper records.')
  assert.ok((await h.api('imports', people.owner)).some(job => job.retained.some(item => item.target === jo.id && item.reason === 'edited')))
  const provisioned = await harness({bindings: {...trust.bindings, RER_IMPORT_DOOR: 'on'}})
  try {
    assert.equal((await provisioned.raw('/auth/bootstrap', {body: {token: provisioned.vars.SETUP_TOKEN, displayName: 'Provisioned owner'}})).status, 303)
    let cookie = await provisioned.signIn(provisioned.vars.OWNER_EMAIL)
    assert.equal((await provisioned.api('import-settings', cookie)).enabled, true)
    await provisioned.api('import.settings', cookie, {enabled: false, revokeKey: 'business-a'})
    // An initialized claim and later session starts never reopen a door the owner disabled.
    await provisioned.raw('/auth/bootstrap', {body: {token: provisioned.vars.SETUP_TOKEN, displayName: 'Same owner'}})
    cookie = await provisioned.signIn(provisioned.vars.OWNER_EMAIL)
    assert.deepEqual((await provisioned.api('import-settings', cookie)).revokedKeys, ['business-a'])
    assert.equal((await provisioned.api('import-settings', cookie)).enabled, false)
  } finally { await provisioned.close() }

}
