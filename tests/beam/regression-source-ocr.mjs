import assert from 'node:assert/strict'
import { fixture } from './regression-fixture.mjs'
import { file } from './harness.mjs'
import { sourceProcedurePdf } from './source-fixtures.mjs'
import { sourceOcrProviderResponse } from './source-ocr-fixtures.mjs'
export async function sourceOcrCheck() {
  const requests = []
  let refuse = false
  const f = await fixture({ outboundService: async request => {
    if (request.url !== 'https://api.openai.com/v1/responses') return null
    requests.push(await request.json())
    return refuse ? Response.json({ error: { message: 'synthetic-beam-1 private provider detail' } }, { status: 403 }) : Response.json(sourceOcrProviderResponse())
  } })
  try {
    const { api, h, ids, cookies } = f
    const original = sourceProcedurePdf(true)
    const add = title => api('author', 'source.create', { title, reviewer: ids.reviewer, licence: 'owned', licenceEvidence: 'Employer-authored scanned procedure', provenance: 'Original procedure', file: file('synthetic-beam-1.pdf', original) })
    const source = await add('Scanned opening procedure')
    await api('author', 'source.ocr.configure', { operation: 'enable', apiKey: 'synthetic-beam-1', maxCostCents: 1000, consent: true }, 403)
    await api('owner', `sources/${source.versionId}/ocr-preview`, undefined, 409)
    await api('owner', 'source.ocr.configure', { operation: 'enable', apiKey: 'synthetic-beam-1', maxCostCents: 1000, consent: true })
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
    const audit = await api('owner', 'audit?category=all')
    const events = audit.events.filter(row => row.action.startsWith('source.ocr.'))
    assert.ok(events.length > 0)
    assert.ok(!JSON.stringify(events).includes('Inspect the work area') && !JSON.stringify(events).includes('synthetic-beam-1 private provider detail'))
    const next = await add('Scanned closing procedure')
    const oldApproval = await api('owner', `sources/${next.versionId}/ocr-preview`)
    await api('owner', 'source.ocr.configure', { operation: 'disable' })
    await api('owner', 'source.ocr.run', { ...oldApproval, consent: true }, 409)
    assert.equal(requests.length, 1)
    await api('owner', 'source.ocr.configure', { operation: 'enable', maxCostCents: 1000, consent: true })
    refuse = true
    const denied = await api('owner', `sources/${next.versionId}/ocr-preview`)
    await api('owner', 'source.ocr.run', { ...denied, consent: true }, 502)
    assert.equal(requests.length, 2)
    const config = await api('owner', 'source-ocr')
    assert.ok(config.runs.some(row => row.state === 'failed' && row.failure === 'source_ocr_provider_denied'))
    assert.ok(config.reservedEstimateCents > before.reservedEstimateCents)
    await api('owner', 'source.ocr.configure', { operation: 'revoke' })
    assert.equal((await api('owner', 'source-ocr')).hasKey, false)
  } finally { await f.h.close() }
}
