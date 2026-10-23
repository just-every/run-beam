import { sourceDraftWithdrawalCheck } from './erasure-source-drafts.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPortability, readArchive } from '@runeditrun/rer/modules/portability'
import { exportArchive, importArchive, fileRecords } from '@runeditrun/rer/modules/portability/files'
import policy from '../../scripts/installer/portability-policy.mjs'
import { harness } from './harness.mjs'
import { migrations } from './regression-archive.mjs'
import { createHash } from 'node:crypto'
import { xapiFixture, sendXapi } from './xapi-fixture.mjs'
import { prepareXapi, xapiStatement } from './regression-xapi.mjs'
import { file } from './harness.mjs'
import { courseListCsv, courseReport } from './fixtures.mjs'
import { prepareMicrolearning } from './regression-collab.mjs'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export async function erasureCheck() {
  const f = await xapiFixture()
  const scratch = await mkdtemp(join(tmpdir(), 'beam-erasure-'))
  const old = join(scratch, 'before.rer'), later = join(scratch, 'after.rer')
  const portability = () => createPortability({ db: f.h.db, buckets: { files: f.h.files }, policy })
  const { api, h, ids, cookies } = f
  const ownerRequest = async (action, body, expected = 200) => {
    const response = await h.fetch(`/api/operator/import/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: h.origin, 'X-Import-Source': 'talentlms', cookie: cookies.owner }, body: JSON.stringify(body) })
    const result = await response.json()
    assert.ok([expected].flat().includes(response.status), `${action}: ${response.status} ${JSON.stringify(result).slice(0,200)}`)
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
    const external = await prepareXapi(f, 'erasure custody')
    const launch = await api('learner','xapi.launch',{assignment:external.assignment,activity:external.activity})
    const externalStatement = xapiStatement(launch)
    assert.equal((await sendXapi(f,external.activity,externalStatement)).status,200)
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
    // An accepted native edit after planning creates a real failed-apply custody fact.
    const conflictBundle = Buffer.from(JSON.stringify({ ...JSON.parse(bundle), reports: [{ course: '101', file: file('course-101.xlsx', courseReport({ learnerEmail: 'learner@example.test', score: 95 })) }], exportNote: 'Second reviewed snapshot' }))
    const conflictPlan = await ownerRequest('plan', { uploadId: await upload(conflictBundle), catchup: true })
    await api('owner', 'history.accept', { history: imported.find(row => row.score)?.id, note: 'Confirmed against the retained assessment.' })
    let refused = false
    for (let step = 0; step < 30; step++) {
      const result = await ownerRequest('apply', { planId: conflictPlan.planId, reviewedFingerprint: conflictPlan.fingerprint }, [200, 409])
      if (result.error) { assert.match(result.error, /^import_door_apply_/); refused = true; break }
      assert.notEqual(result.job?.state, 'completed', 'a target edited after review cannot complete apply')
    }
    assert.ok(refused, 'bounded apply reaches the edited row and records the refusal')
    const failed = await ownerRequest('status', { planId: conflictPlan.planId })
    assert.ok(failed.failureCode, 'a real failed apply is present before erasure')
    // Source erasure executes with import-door custody present too; a hold retains the original.
    const originalBytes = Buffer.from('Owner-approved obsolete source original')
    const source = await api('author', 'source.create', { title: 'Obsolete inspection procedure', reviewer: ids.reviewer, licence: 'owned', licenceEvidence: 'Employer-authored original', provenance: 'Original employer procedure', file: file('obsolete.txt', originalBytes) })
    const sourceHold = await api('owner', 'erasure.hold', { kind: 'source', subject: source.id, justification: 'Preserve the original for the open investigation.' })
    const eraseSource = async () => {
      const preview = await api('owner', 'erasure.preview', { kind: 'source', subject: source.id })
      assert.ok(preview.inventory.imports.some(row => row.table === 'ik_door_apply_failures'))
      const job = await api('owner', 'erasure.begin', { kind: 'source', subject: source.id, digest: preview.digest, justification: 'Approved obsolete-source erasure.', consent: true })
      let result
      for (let step = 0; step < 15; step++) { result = await api('owner', 'erasure.resume', { job: job.id }); assert.notEqual(result.state, 'failed', result.failure); if (result.state === 'complete') return result }
      assert.fail('source erasure converges')
    }
    assert.ok((await eraseSource()).files.every(row => row.state === 'retained_shared_or_held'))
    assert.ok(await h.files.head(`sha256/${hash(originalBytes)}`))
    await api('owner', 'erasure.hold.release', { hold: sourceHold.id, justification: 'Original is no longer required.' })
    assert.ok((await eraseSource()).files.every(row => row.state === 'deleted'))
    assert.equal(await h.files.head(`sha256/${hash(originalBytes)}`), null)
    assert.equal((await h.raw(`/api/beam/source-files/${source.versionId}`, { cookie: cookies.author })).status, 404)
    await api('author', 'source.create', { title: 'Reconnect erased original', reviewer: ids.reviewer, licence: 'owned', licenceEvidence: 'Employer-authored original', provenance: 'Same original', file: file('obsolete.txt', originalBytes) }, 409)
    const sourceWithdrawal = await sourceDraftWithdrawalCheck(f)
    // A complete saved dry run is withdrawn explicitly; its rule cannot use a stale approval.
    const followOn = await f.course('Follow-on equipment practice')
    const dryRule = await api('owner', 'automation.save', { name: 'Equipment follow-on', trigger: 'completion', sourceCourse: c.id, targetCourse: followOn.id, dueDays: 7 })
    await api('owner', 'automation.preview', { rule: dryRule.id })
    const snapshotPreview = await api('owner', 'erasure.preview', { kind: 'person', subject: ids.learner })
    assert.ok(snapshotPreview.inventory.unsupported.includes('beam_automation_rules.preview_json'))
    assert.equal(snapshotPreview.inventory.ruleSnapshots[0].id, dryRule.id)
    const withdraw = { kind: 'person', subject: ids.learner, digest: snapshotPreview.digest, justification: 'Withdraw shared operational previews for the approved privacy request.', consent: true }
    await api('owner', 'erasure.begin', withdraw, 409)
    await api('manager', 'erasure.snapshots.withdraw', withdraw, 403)
    await api('owner', 'erasure.snapshots.withdraw', { ...withdraw, consent: false }, 409)
    await api('owner', 'automation.state', { rule: dryRule.id, state: 'active' })
    assert.equal((await api('owner', 'erasure.snapshots.withdraw', withdraw, 409)).error, 'stale_erasure_preview')
    const freshSnapshot = await api('owner', 'erasure.preview', { kind: 'person', subject: ids.learner })
    await api('owner', 'erasure.snapshots.withdraw', { ...withdraw, digest: freshSnapshot.digest })
    const pausedRule = (await api('owner', 'automation')).rules.find(row => row.id === dryRule.id)
    assert.equal(pausedRule.state, 'paused')
    assert.equal(pausedRule.preview, null)
    assert.equal((await api('owner', 'automation.state', { rule: dryRule.id, state: 'active' }, 409)).error, 'dry_run_required')
    const proposalCanary = 'synthetic-beam-27-private-preparation'
    const proposalFields = { kind: 'assignment_plan', title: proposalCanary, inputs: [{ type: 'assignment', id: practice }], reasons: [proposalCanary],
      payload: { items: [{ learner: ids.learner, course: followOn.id, courseRevision: followOn.revision, dueDate: '2030-10-01', dueTime: '17:00', timezone: 'UTC' }] } }
    const pendingProposal = await api('manager', 'agent.propose', proposalFields)
    const declinedProposal = await api('manager', 'agent.propose', { ...proposalFields, title: `${proposalCanary}-declined` })
    await api('owner', 'agent.decide', { proposal: declinedProposal.id, sha256: declinedProposal.sha256, decision: 'decline' })
    const inspectProposals = async path => {
      const rows = []
      for await (const record of fileRecords(path, readArchive)) if (record.kind === 'part') for (const item of record.items) if (item.kind === 'row' && item.table === 'beam_agent_proposals') rows.push(item.row)
      return rows
    }
    const preparationArchive = join(scratch, 'preparations-before.rer')
    await exportArchive(await portability(), preparationArchive)
    assert.ok((await inspectProposals(preparationArchive)).some(row => row.id === pendingProposal.id && JSON.stringify(row).includes(proposalCanary)))
    const proposalPreview = await api('owner', 'erasure.preview', { kind: 'person', subject: ids.learner })
    assert.deepEqual(proposalPreview.inventory.proposalSnapshots.map(row => row.state).sort(), ['declined', 'waiting'])
    const proposalWithdrawal = { kind: 'person', subject: ids.learner, digest: proposalPreview.digest, justification: 'Remove complete saved preparations for the approved erasure request.', consent: true }
    await api('manager', 'erasure.proposals.withdraw', proposalWithdrawal, 403)
    await api('owner', 'erasure.proposals.withdraw', { ...proposalWithdrawal, consent: false }, 409)
    await api('owner', 'erasure.proposals.withdraw', proposalWithdrawal)
    assert.equal((await api('owner', 'agent.decide', { proposal: pendingProposal.id, sha256: pendingProposal.sha256, decision: 'approve' }, 409)).error, 'proposal_withdrawn')
    await api('owner', `proposals/${pendingProposal.id}`, undefined, 404)
    assert.ok(!(await api('owner', 'proposals')).some(row => row.id === pendingProposal.id))
    const withdrawnArchive = join(scratch, 'preparations-after.rer')
    await exportArchive(await portability(), withdrawnArchive)
    const withdrawnRows = await inspectProposals(withdrawnArchive)
    for (const [proposal, state] of [[pendingProposal, 'waiting'], [declinedProposal, 'declined']]) {
      const row = withdrawnRows.find(row => row.id === proposal.id)
      assert.ok(row.withdrawn_at && row.withdrawn_by === ids.owner)
      assert.equal(row.state, state, 'privacy withdrawal does not rewrite a human decision')
      assert.ok(!JSON.stringify(row).includes(proposalCanary), 'the installation archive physically withholds erased preparation text')
    }
    const auditBefore = (await api('owner','audit?q=learner%40example.test')).events.map(({id,at,action})=>({id,at,action}))
    assert.ok(auditBefore.length)
    await exportArchive(await portability(), old)
    const preview = await api('owner', 'erasure.preview', { kind: 'person', subject: ids.learner })
    assert.deepEqual(preview.inventory.unsupported, [], 'existing learner custody is covered')
    assert.ok(preview.inventory.rows.some(row => row.table === 'beam_sequence_answers'))
    assert.ok(preview.inventory.imports.some(row => row.table === 'ik_door_chunks'))
    assert.ok(preview.inventory.imports.some(row => row.table === 'ik_door_apply_failures'))
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
      assert.notEqual(report.state, 'failed', `${report.phase}: ${report.failure}`)
      if (report.state === 'complete') break
      assert.notEqual(i, 59, 'erasure converges')
    }
    assert.ok(report.outcomes.native.some(row => row.table === 'beam_sequence_answers' && row.removed > 0))
    assert.ok(report.providers.some(row => row.state === 'failed'), 'provider deletion remains visibly unresolved')
    assert.ok(report.providers.some(row=>row.connection_id===external.connection && row.state==='failed' && row.failure==='connected_lrs_erasure_api_required'))
    assert.ok(f.lrs.records.has(externalStatement.id), 'external statements are not falsely reported erased')
    assert.equal(f.lrs.edge.writes,1,'erasure never fabricates an LRS destructive API or sends a replacement statement')
    const auditAfter = (await api('owner','audit')).events
    for (const original of auditBefore) {
      const event = auditAfter.find(row=>row.id===original.id)
      assert.ok(event, 'erasure retains the decision event')
      assert.deepEqual({id:event.id,at:event.at,action:event.action},original)
      assert.ok(!JSON.stringify(event.detail).includes('learner@example.test'),'personal audit payload is erased while event identity and time survive')
    }
    await exportArchive(await portability(), later)
    const target = await harness()
    try {
      const restored = await createPortability({ db: target.db, buckets: { files: target.files }, policy, migrations })
      await assert.rejects(importArchive(restored, old, undefined, later), /erasure_epoch/)
      await importArchive(restored, later)
      const restoredOwner = await target.signIn('owner@example.test')
      assert.equal((await target.raw(`/api/beam/source-files/${sourceWithdrawal.source.versionId}`, { cookie: restoredOwner })).status, 404)
      assert.deepEqual((await target.api(`courses/${sourceWithdrawal.course.id}`, restoredOwner)).draft.lessons, sourceWithdrawal.kept)

    } finally { await target.close() }
    const exported = await (await h.raw('/app/data-export.json', { cookie: cookies.owner })).json()
    assert.equal(exported.records.beam_sequence_answers.rows.filter(row => row.assignment_id === practice).length, 0)
    assert.ok(exported.records.beam_completions.rows.some(row => row.id === completion.id), 'held assessment remains')
    assert.ok(exported.records.beam_attempts.rows.some(row => row.id === evidence.id))
    assert.ok(exported.records.beam_imported_history.rows.some(row => JSON.stringify(row.payload).includes('learner@example.test')), 'the hold retains imported assessment evidence too')
    const person = exported.records.beam_members.rows.find(row => row.id === ids.learner)
    assert.deepEqual([person.email, person.name], [null, 'Erased person'])
    assert.equal((await api('owner', `directory/${ids.learner}`)).signIn, null)
    await api('owner', 'person.invite', { email: 'learner@example.test', name: 'Resurrected person', roles: ['learner'] }, 409)
    const withdrawn = await ownerRequest('plan', { uploadId: await upload(bundle, 'reconnect.json') }, 410)
    assert.equal(withdrawn.error, 'snapshot_withdrawn', 'the exact retired import cannot be reopened')
    const freshBundle = Buffer.from(JSON.stringify({ ...JSON.parse(bundle), exportNote: 'A new delivery after approved erasure' }))
    const retainedHistory = await api('owner', 'history')
    // Base deliberately exposes only its fixed parser refusal, never the refused source value.
    const fenced = await ownerRequest('plan', { uploadId: await upload(freshBundle, 'fresh-reconnect.json') }, 422)
    assert.equal(fenced.error, 'source_parser_failed', 'a changed source cannot evade the identity tombstone')
    assert.ok(!JSON.stringify(fenced).includes('learner@example.test'))
    assert.deepEqual(await api('owner', 'history'), retainedHistory, 'refused reconnect cannot recreate or alter retained history')
    assert.deepEqual(await api('owner', 'import-settings'), importSettings, 'permanent settings and key revocations survive')
    assert.ok((await api('owner', 'erasure-settings')).holds.some(row => row.id === hold.id && !row.released_at))
    await api('owner', 'erasure.hold.release', { hold: hold.id, justification: 'Investigation closed.' })
    const next = await api('owner', 'erasure.preview', { kind: 'person', subject: ids.learner })
    const erase = await api('owner', 'erasure.begin', { kind: 'person', subject: ids.learner, digest: next.digest, justification: 'Retention released.', consent: true })
    for (let i = 0; i < 60; i++) { report = await api('owner', 'erasure.resume', { job: erase.id }); assert.notEqual(report.state, 'failed', `${report.phase}: ${report.failure}`); if (report.state === 'complete') break; assert.notEqual(i, 59) }
    const final = await (await h.raw('/app/data-export.json', { cookie: cookies.owner })).json()
    assert.ok(!final.records.beam_completions.rows.some(row => row.id === completion.id))
    assert.ok(!final.records.beam_attempts.rows.some(row => row.id === evidence.id))
    assert.ok(!final.records.beam_imported_history.rows.some(row => JSON.stringify(row.payload).includes('learner@example.test')), 'releasing retention permits erasure of the held imported evidence')
    assert.equal(await h.files.head(`sha256/${hash(Buffer.from('Observed equipment evidence'))}`), null)
  } finally { await h.close(); await rm(scratch, { recursive: true, force: true }) }
}
