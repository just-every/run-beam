import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fixture } from './regression-fixture.mjs'
import { file } from './harness.mjs'
import { sourceProcedurePdf } from './source-fixtures.mjs'
import { sourceOcrProviderResponse } from './source-ocr-fixtures.mjs'
export async function sourceOcrCheck() {
  const requests = [], authorizations = []
  let refuse = false, echoSecret = null
  const f = await fixture({ outboundService: async request => {
    if (request.url !== 'https://api.openai.com/v1/responses') return null
    authorizations.push(request.headers.get('authorization'))
    requests.push(await request.json())
    if(echoSecret==='metadata')return Response.json(sourceOcrProviderResponse(undefined,{id:'synthetic-beam-1002'}))
    if(echoSecret==='passage')return Response.json(sourceOcrProviderResponse([{page:1,passages:[{text:'synthetic-beam-1002',uncertainties:[]}],uncertainties:[]}]))
    return refuse ? Response.json({ error: { message: 'synthetic-beam-1 private provider detail' } }, { status: 403 }) : Response.json(sourceOcrProviderResponse())
  } })
  try {
    const { api, h, ids, cookies } = f
    const original = sourceProcedurePdf(true)
    const add = title => api('author', 'source.create', { title, reviewer: ids.reviewer, licence: 'owned', licenceEvidence: 'Employer-authored scanned procedure', provenance: 'Original procedure', file: file('synthetic-beam-1.pdf', original) })
    const source = await add('Scanned opening procedure')
    await api('author', 'source.ocr.configure', { operation: 'enable', accountMode: 'sandbox', agreementConfirmed: true, totalBudgetCents: 10000, apiKey: 'synthetic-beam-1001', maxCostCents: 1000, consent: true }, 403)
    await api('owner', `sources/${source.versionId}/ocr-preview`, undefined, 409)
    const configured = await h.submit('source.ocr.configure', cookies.owner, { operation: 'enable', accountMode: 'sandbox', agreementConfirmed: 'yes', totalBudgetCents: 10000, apiKey: 'synthetic-beam-1001', maxCostCents: 1000, consent: 'yes' }, '/app/sources/ocr')
    assert.equal(configured.searchParams.get('error'), null)
    const before = await api('owner', 'source-ocr')
    assert.equal('key_cipher' in before, false)
    const preview = await api('owner', `sources/${source.versionId}/ocr-preview`)
    assert.equal(requests.length, 0, 'GET never sends original bytes or spends')
    await api('owner', 'source.ocr.run', { ...preview, consent: false }, 409)
    await api('owner', 'source.ocr.run', { ...preview, sha256: 'altered', consent: true }, 409)
    assert.equal(requests.length, 0)
    await api('owner', 'source.ocr.run', { ...preview, consent: true })
    assert.equal(requests.length, 1)
    assert.deepEqual(Buffer.from(requests[0].input[0].content[0].file_data.split(',')[1], 'base64'), original)
    assert.equal(requests[0].store, false)
    await api('owner', 'source.ocr.run', { ...preview, consent: true }, 409)
    assert.equal(requests.length, 1, 'one-use approval does not repeat provider work')
    const extraction = await api('author', `sources/${source.versionId}/extraction`)
    assert.match(extraction.lessons[0].body, /Inspect the work area/)
    assert.ok(extraction.uncertainties.length > 0 && extraction.uncertainties.every(row => !row.requiresOcr))
    const c = await api('author', 'course.create', { title: 'Reviewed scanned procedure', reviewer: ids.reviewer })
    const corrected = extraction.lessons.map(row => ({ ...row, body: row.body.replace('starting', 'starting the equipment') }))
    const conversion = { course: c.id, draftVersion: 1, sourceVersion: source.versionId, reviewed: true, lessons: corrected }
    await api('author', 'source.convert', conversion, 409)
    const saved = await api('author', 'source.convert', { ...conversion, resolvedUncertainties: extraction.uncertainties.map(row => row.id) })
    assert.equal((await api('author', `courses/${c.id}`)).publishedRevision, null)
    const revision = (await api('author', 'course.submit', { course: c.id, draftVersion: saved.draftVersion })).id
    await f.publish(revision)
    assert.match((await api('reviewer', `revisions/${revision}`)).lessons[0].body, /starting the equipment/)
    assert.deepEqual(Buffer.from(await (await h.raw(`/api/beam/source-files/${source.versionId}`, { cookie: cookies.author })).arrayBuffer()), original)
    const audit = await api('owner', 'audit?category=content')
    const events = audit.events.filter(row => row.action.startsWith('source.ocr.'))
    assert.ok(events.length > 0)
    assert.ok(!JSON.stringify(events).includes('Inspect the work area') && !JSON.stringify(events).includes('synthetic-beam-1 private provider detail'))
    const next = await add('Scanned closing procedure')
    const oldApproval = await api('owner', `sources/${next.versionId}/ocr-preview`)
    await api('owner', 'source.ocr.configure', { operation: 'disable' })
    await api('owner', 'source.ocr.run', { ...oldApproval, consent: true }, 409)
    assert.equal(requests.length, 1)
    await api('owner', 'source.ocr.configure', { operation: 'enable', accountMode: 'sandbox', agreementConfirmed: true, totalBudgetCents: 10000, maxCostCents: 1000, consent: true })
    refuse = true
    const denied = await api('owner', `sources/${next.versionId}/ocr-preview`)
    await api('owner', 'source.ocr.run', { ...denied, consent: true }, 502)
    assert.equal(requests.length, 2)
    const config = await api('owner', 'source-ocr')
    assert.ok(config.runs.some(row => row.state === 'failed' && row.failure === 'source_ocr_provider_denied'))
    assert.ok(config.reservedEstimateCents > before.reservedEstimateCents)
    const costs = await api('owner', 'costs')
    assert.ok(costs.providers.some(row => row.kind === 'source_ocr' && row.billing === 'employer_account'))
    assert.equal(costs.ocr.reservedEstimateCents, config.reservedEstimateCents)
    assert.equal(costs.ocr.invoice, false)
    // Budget refusal is a durable job receipt and leaves all prior outcomes intact.
    const budgetSource = await add('Budget-bound scanned procedure')
    const options = { accountMode: 'sandbox', agreementConfirmed: true, maxCostCents: 1000, consent: true }
    await api('owner', 'source.ocr.configure', { operation: 'enable', ...options, totalBudgetCents: 0 })
    const over = await api('owner', `sources/${budgetSource.versionId}/ocr-preview`)
    await api('owner', 'source.ocr.run', { ...over, consent: true }, 409)
    const exhausted = await api('owner', 'source-ocr')
    assert.equal(requests.length, 2, 'zero budget refuses actual model work at the provider boundary')
    assert.equal(exhausted.reservedEstimateCents, config.reservedEstimateCents)
    assert.ok(exhausted.runs.some(row => row.source_version_id === budgetSource.versionId && row.state === 'failed' && row.failure === 'source_ocr_budget_exhausted' && row.provider_attempted === 0))
    // Rotation invalidates outstanding approvals and requires explicit re-enabling.
    const stale = await api('owner', `sources/${budgetSource.versionId}/ocr-preview`)
    const rotated = await h.submit('source.ocr.configure', cookies.owner, { operation: 'rotate', ...options, consent: 'yes', agreementConfirmed: 'yes', apiKey: 'synthetic-beam-1002', totalBudgetCents: config.reservedEstimateCents + before.estimateCents }, '/app/sources/ocr')
    assert.equal(rotated.searchParams.get('error'), null)
    await api('owner', 'source.ocr.run', { ...stale, consent: true }, 409)
    assert.equal((await api('owner', 'source-ocr')).enabled, false)
    await api('owner', 'source.ocr.configure', { operation: 'enable', ...options, totalBudgetCents: config.reservedEstimateCents + before.estimateCents })
    const concurrentSource = await add('Concurrent budget-bound procedure')
    const approvals = await Promise.all([budgetSource, concurrentSource].map(source => api('owner', `sources/${source.versionId}/ocr-preview`)))
    refuse = false
    const results = await Promise.all(approvals.map(approval => h.raw('/api/beam/source.ocr.run', { cookie: cookies.owner, body: { ...approval, consent: true } })))
    assert.deepEqual(results.map(row => row.status).sort(), [200, 409], 'concurrent jobs share one atomic remaining reservation')
    assert.equal(requests.length, 3)
    assert.equal(authorizations.at(-1), 'Bearer synthetic-beam-1002', 'only the rotated key reaches the provider')
    const final = await api('owner', 'source-ocr')
    assert.equal(final.reservedEstimateCents, config.reservedEstimateCents + before.estimateCents)
    // Untrusted provider output cannot smuggle the server credential into author passages or job metadata.
    await api('owner','source.ocr.configure',{operation:'enable',...options,totalBudgetCents:final.reservedEstimateCents+2*before.estimateCents})
    for(const kind of ['metadata','passage']){
      echoSecret=kind
      const original=await add(`Provider echo refusal ${kind}`)
      const approved=await api('owner',`sources/${original.versionId}/ocr-preview`)
      const refused=await api('owner','source.ocr.run',{...approved,consent:true},502)
      assert.equal(refused.error,'source_ocr_secret_in_result')
    }
    echoSecret=null
    const afterLeaks=await api('owner','source-ocr')
    assert.equal(afterLeaks.runs.filter(row=>row.failure==='source_ocr_secret_in_result').length,2)
    assert.equal(afterLeaks.reservedEstimateCents,final.reservedEstimateCents+2*before.estimateCents)
    const safe = JSON.stringify([afterLeaks, await api('owner','costs'), await api('owner','audit?category=content'), await (await h.raw('/app/data-export.json',{cookie:cookies.owner})).json()])
    for (const secret of ['synthetic-beam-1001', 'synthetic-beam-1002']) assert.ok(!safe.includes(secret), 'public views and learning exports withhold planted provider secrets')
    const page = await (await h.raw('/app/sources/ocr', {cookie:cookies.owner})).text()
    assert.ok(page.includes('source_ocr_budget_exhausted') && !page.includes('synthetic-beam-1001') && !page.includes('synthetic-beam-1002'))
    const diagnostic = spawnSync(process.execPath, ['scripts/diagnose-configuration.mjs'], { input: JSON.stringify({MAIL_PROVIDER:'resend',MAIL_API_KEY:'synthetic-beam-1001',OPENAI_API_KEY:'synthetic-beam-1002'}), encoding:'utf8' })
    assert.ok([0,1].includes(diagnostic.status))
    for (const secret of ['synthetic-beam-1001','synthetic-beam-1002']) assert.ok(!(diagnostic.stdout + diagnostic.stderr).includes(secret), 'configuration diagnostics do not echo planted secrets')
    const revoked = await h.submit('source.ocr.configure', cookies.owner, { operation: 'revoke' }, '/app/sources/ocr')
    assert.equal(revoked.searchParams.get('error'), null)
    assert.equal((await api('owner', 'source-ocr')).hasKey, false)
    // A stale Settings tab must not restore a revoked key or replace a later budget decision.
    const retiredVersion = afterLeaks.version
    const staleSave = await h.submit('source.ocr.configure', cookies.owner, {
      operation: 'enable', version: retiredVersion, ...options, consent: 'yes', agreementConfirmed: 'yes',
      apiKey: 'synthetic-beam-1001', totalBudgetCents: 10000,
    }, '/app/sources/ocr')
    assert.equal(staleSave.searchParams.get('error'), 'source_ocr_config_changed')
    assert.equal((await api('owner', 'source-ocr')).hasKey, false)
    const latest = await api('owner', 'source-ocr')
    const changes = await Promise.all(['enable', 'rotate'].map(operation => f.request('/api/beam/source.ocr.configure', {
      role: 'owner', body: { operation, version: latest.version, ...options, apiKey: 'synthetic-beam-1002', totalBudgetCents: 10000 },
    })))
    assert.deepEqual(changes.map(row => row.status).sort(), [200, 409], 'only one concurrent save consumes the reviewed configuration version')
    const winner = await api('owner', 'source-ocr')
    assert.equal(winner.version, latest.version + 1)
    assert.equal(winner.reservedEstimateCents, latest.reservedEstimateCents, 'account changes retain every provider reservation')
    const pending = await h.submit('source.ocr.configure', cookies.owner, { operation: 'revoke', version: winner.version }, '/app/sources/ocr')
    assert.equal(pending.searchParams.get('error'), null)
    assert.equal((await api('owner', 'source-ocr')).hasKey, false)
  } finally { await f.h.close() }
}
