import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPortability } from '@runeditrun/rer/modules/portability'
import { exportArchive, importArchive } from '@runeditrun/rer/modules/portability/files'
import policy from '../../scripts/installer/portability-policy.mjs'
import { harness } from './harness.mjs'
import { createHash } from 'node:crypto'
import { fixture } from './regression-fixture.mjs'
import { file } from './harness.mjs'
import { courseListCsv, courseReport } from './fixtures.mjs'
import { prepareMicrolearning } from './regression-collab.mjs'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export async function erasureCheck() {
  const f = await fixture()
  const scratch = await mkdtemp(join(tmpdir(), 'beam-erasure-'))
  const old = join(scratch, 'before.rer'), later = join(scratch, 'after.rer')
  const portability = () => createPortability({ db: f.h.db, buckets: { files: f.h.files }, policy })
  const { api, h, ids, cookies } = f
  const ownerRequest = async (action, body, expected = 200) => {
    const response = await h.fetch(`/api/operator/import/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: h.origin, 'X-Import-Source': 'talentlms', cookie: cookies.owner }, body: JSON.stringify(body) })
    const result = await response.json()
    assert.equal(response.status, expected, `${action}: ${JSON.stringify(result).slice(0,200)}`)
    return result
  }
  const upload = async (bytes, name = 'talentlms.json') => {
    const sha = hash(bytes)
    return (await ownerRequest('uploads', { name, bundleSha256: sha, totalBytes: bytes.length, totalChunks: 1, index: 0, chunkSha256: sha, base64: bytes.toString('base64') })).uploadId
  }
  try {
    await api('learner', 'erasure.policy', { assessmentDays: 0, justification: 'Employer-approved deletion policy', consent: true }, 403)
    await api('owner', 'erasure.preview', { kind: 'person', subject: ids.learner }, 409)
    await api('owner', 'import.settings', { enabled: true, revokeKey: 'synthetic-beam-1' })
    const importSettings = await api('owner', 'import-settings')
    await api('owner', 'erasure.policy', { assessmentDays: 0, justification: 'Keep only explicitly held learning evidence.', consent: true })
    await api('owner', 'erasure.preview', { kind: 'person', subject: ids.owner }, 409)
    const c = await f.course('Held observed equipment check', true), assigned = await f.assign(c)
    await f.lessons(assigned)
    const evidence = await api('learner', 'practical.submit', { assignment: assigned, evidence: 'Observed pressure check.', file: file('synthetic-beam-1.txt', 'Observed equipment evidence') })
    await api('assessor', 'practical.decide', { attempt: evidence.id, decision: 'accepted', note: 'Observed and accepted.' })
    const completion = (await api('learner', 'records/me')).completions.find(row => row.course === c.id)
    const hold = await api('owner', 'erasure.hold', { kind: 'person', subject: ids.learner, justification: 'Open workplace investigation; preserve assessed evidence.' })
    const sequence = await prepareMicrolearning(f, 'erasure')
    const revision = (await api('author', 'course.submit', { course: sequence.id, draftVersion: sequence.draftVersion })).id
    await f.publish(revision)
    const practice = await f.assign(sequence)
    const sequenceView = await api('learner', `sequences/${practice}`)
    await api('learner', 'sequence.answer', { assignment: practice, day: 1, choice: 1, version: sequenceView.version })
    // A real reviewed import creates originals, snapshots, bindings and a rejected-row fact.
    const bundle = Buffer.from(JSON.stringify({ courseList: file('courses.csv', courseListCsv), reports: [{ course: '101', file: file('course-101.xlsx', courseReport({ learnerEmail: 'learner@example.test' })) }], dateFormat: 'DMY', mappings: { '101': c.id } }))
    const uploadId = await upload(bundle), plan = await ownerRequest('plan', { uploadId })
    for (let i = 0; i < 30; i++) { const result = await ownerRequest('apply', { planId: plan.planId, reviewedFingerprint: plan.fingerprint }); if (result.job?.state === 'completed') break; assert.notEqual(i, 29) }
    await upload(bundle, 'unfinished.json')
    const imported = (await api('owner', 'history')).filter(row => row.email === 'learner@example.test')
    assert.ok(imported.length > 0)
    await exportArchive(await portability(), old)
    const preview = await api('owner', 'erasure.preview', { kind: 'person', subject: ids.learner })
    assert.deepEqual(preview.inventory.unsupported, [], 'existing learner custody is covered')
    assert.ok(preview.inventory.rows.some(row => row.table === 'beam_sequence_answers'))
    assert.ok(preview.inventory.imports.some(row => row.table === 'ik_door_chunks'))
    assert.equal(preview.retention.holds[0].id, hold.id)
    await api('owner', 'erasure.begin', { kind: 'person', subject: ids.learner, digest: 'stale', justification: 'Approved request', consent: true }, 409)
    const job = await api('owner', 'erasure.begin', { kind: 'person', subject: ids.learner, digest: preview.digest, justification: 'Employer approved erasure with investigation hold.', consent: true })
    await api('learner', 'me', undefined, 401)
    // Read/refresh never advances a destructive step. A fresh HTTP request resumes durable work.
    const before = await api('owner', `erasure/${job.id}`)
    assert.equal((await api('owner', `erasure/${job.id}`)).phase, before.phase)
    let report
    for (let i = 0; i < 60; i++) {
      report = await api('owner', 'erasure.resume', { job: job.id })
      assert.notEqual(report.state, 'failed', report.failure)
      if (report.state === 'complete') break
      assert.notEqual(i, 59, 'erasure converges')
    }
    assert.ok(report.outcomes.native.some(row => row.table === 'beam_sequence_answers' && row.removed > 0))
    assert.ok(report.providers.some(row => row.state === 'failed'), 'provider deletion remains visibly unresolved')
    await exportArchive(await portability(), later)
    const target = await harness()
    try {
      await assert.rejects(importArchive(await createPortability({ db: target.db, buckets: { files: target.files }, policy }), old, { journal: later }), /erasure_epoch/)
    } finally { await target.close() }
    const exported = await (await h.raw('/app/data-export.json', { cookie: cookies.owner })).json()
    assert.equal(exported.records.beam_sequence_answers.rows.filter(row => row.assignment_id === practice).length, 0)
    assert.ok(exported.records.beam_completions.rows.some(row => row.id === completion.id), 'held assessment remains')
    assert.ok(exported.records.beam_attempts.rows.some(row => row.id === evidence.id))
    const person = exported.records.beam_members.rows.find(row => row.id === ids.learner)
    assert.deepEqual([person.email, person.name], [null, 'Erased person'])
    assert.equal((await api('owner', `directory/${ids.learner}`)).signIn, null)
    await api('owner', 'person.invite', { email: 'learner@example.test', name: 'Resurrected person', roles: ['learner'] }, 409)
    await ownerRequest('plan', { uploadId: await upload(bundle, 'reconnect.json') }, 409)
    assert.deepEqual(await api('owner', 'import-settings'), importSettings, 'permanent settings and key revocations survive')
    assert.ok((await api('owner', 'erasure-settings')).holds.some(row => row.id === hold.id && !row.released_at))
    await api('owner', 'erasure.hold.release', { hold: hold.id, justification: 'Investigation closed.' })
    const next = await api('owner', 'erasure.preview', { kind: 'person', subject: ids.learner })
    const erase = await api('owner', 'erasure.begin', { kind: 'person', subject: ids.learner, digest: next.digest, justification: 'Retention released.', consent: true })
    for (let i = 0; i < 60; i++) { report = await api('owner', 'erasure.resume', { job: erase.id }); assert.notEqual(report.state, 'failed', report.failure); if (report.state === 'complete') break; assert.notEqual(i, 59) }
    const final = await (await h.raw('/app/data-export.json', { cookie: cookies.owner })).json()
    assert.ok(!final.records.beam_completions.rows.some(row => row.id === completion.id))
    assert.ok(!final.records.beam_attempts.rows.some(row => row.id === evidence.id))
    assert.equal(await h.files.head(`sha256/${hash(Buffer.from('Observed equipment evidence'))}`), null)
  } finally { await h.close(); await rm(scratch, { recursive: true, force: true }) }
}
