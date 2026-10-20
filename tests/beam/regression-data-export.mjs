import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { file } from './harness.mjs'
const sha = value => createHash('sha256').update(value).digest('hex')

// OPS-002: independently read the owner's open-format estate and original bytes.
export async function dataExportCheck(f) {
  const { api, h, cookies, ids, course, lessons } = f
  const original = 'Check the loading bay before opening.\n'
  const source = await api('author', 'source.create', { title: 'Loading procedure', licence: 'licensed', licenceEvidence: 'Employer holds a transferable procedure licence.', provenance: 'Employer procedure vault', reviewer: ids.reviewer, file: file('loading.txt', original) })
  const c = await course('Loading bay induction')
  const assignment = await f.assign(c)
  await lessons(assignment)
  await f.publish(await f.nextRevision(c))
  const practical = await course('Observed loading practice', true)
  const draft = await api('author', `courses/${practical.id}`)
  let version = (await api('author', 'course.question', { course: practical.id, draftVersion: draft.draftVersion, prompt: 'First step?', choices: 'Check the bay\nSkip the check', correct: '1' })).draftVersion
  version = (await api('author', 'course.assessment', { course: practical.id, draftVersion: version, passPercent: 100, maxAttempts: 3, practicalInstructions: 'Demonstrate safe loading', assessor: ids.assessor })).draftVersion
  await f.publish((await api('author', 'course.submit', { course: practical.id, draftVersion: version })).id)
  const practicalAssignment = await f.assign(practical)
  await lessons(practicalAssignment)
  const question = (await f.view(practicalAssignment)).quiz.questions[0]
  const failed = await api('learner', 'quiz.submit', { assignment: practicalAssignment, [`q_${question.id}`]: ['1'] })
  const passed = await api('learner', 'quiz.submit', { assignment: practicalAssignment, [`q_${question.id}`]: ['0'] })
  const attempt = await api('learner', 'practical.submit', { assignment: practicalAssignment, evidence: 'Observed safe loading', file: file('observation.txt', 'Observed safe loading at the bay.') })
  await api('assessor', 'practical.decide', { attempt: attempt.id, decision: 'accepted', note: 'Observed every step.' })
  const path = await api('manager', 'path.create', { name: 'Loading role requirements', team: ids.team })
  await api('manager', 'path.revise', { path: path.id, courses: [c.id], dueDays: ['30'], renewalDays: ['365'] })
  const request = await api('owner', 'acknowledgment.request', { source: source.id, kind: 'signature', learners: [ids.learner, ids.assessor] })
  const signature = (await api('learner', 'acknowledgments')).mine.find(row => row.sourceVersion === source.versionId)
  assert.ok(signature)
  const document = await h.raw(`/app/acknowledgments/${signature.id}/document`, { cookie: cookies.learner })
  assert.equal(document.status, 200)
  await api('learner', 'acknowledgment.decide', { acknowledgment: signature.id, decision: 'sign', agree: 'yes', signature: 'learner' })
  const decline = (await api('assessor', 'acknowledgments')).mine.find(row => row.sourceVersion === source.versionId)
  await api('assessor', 'acknowledgment.decide', { acknowledgment: decline.id, decision: 'decline', reason: 'Need the accessible source.' })
  const requirement = await api('owner', 'external.requirement', { name: 'Food handler credential', teams: [ids.team], reviewer: 'manager', reminderDays: 30, expires: 'yes' })
  const external = await api('learner', 'external.upload', { requirement: requirement.id, issuer: 'County Health', number: 'FH-100', issuedOn: '2026-01-01', expiresOn: '2030-01-01', file: file('food-handler.pdf', '%PDF-1.4\nEmployer-held card copy') })
  await api('manager', 'external.decide', { certificate: external.id, decision: 'approve' })
  const replacement = await api('author', 'source.version', { source: source.id, provenance: 'Employer procedure vault, revision 2', file: file('loading-v2.txt', 'Check the loading bay and dock doors before opening.\n') })
  const app = await api('owner', 'app.issue', { name: 'Export exclusion probe', audience: 'reports.read', expiresInDays: 1 })
  const preparation = await api('owner', 'agent.issue', {})
  const response = await h.raw('/app/data-export.json', { cookie: cookies.owner })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-disposition'), /^attachment/)
  assert.match(response.headers.get('cache-control'), /no-store/)
  const text = await response.text(), exported = JSON.parse(text)
  assert.ok(exported.exportedAt && exported.format && exported.documentation)
  for (const record of Object.values(exported.records)) {
    assert.equal(record.count, record.rows.length)
    assert.equal(record.sha256, sha(JSON.stringify(record.rows)))
  }
  const records = name => exported.records[name].rows
  assert.ok(records('beam_source_versions').some(row => row.id === replacement.id && row.source_id === source.id))
  assert.ok(records('beam_source_versions').some(row => row.id === source.versionId && row.sha256 === sha(original)))
  assert.ok(records('beam_acknowledgments').some(row => row.source_version_id === replacement.id && row.state === 'open'))
  assert.ok(records('beam_members').some(row => row.id === ids.learner))
  assert.ok(records('beam_course_revisions').some(row => row.id === c.revision && row.course_id === c.id))
  assert.ok(records('beam_assignments').some(row => row.id === assignment && row.course_revision_id === c.revision))
  assert.ok(records('beam_completions').some(row => row.assignment_id === assignment))
  assert.ok(records('beam_acknowledgments').some(row => row.id === signature.id && row.signature === 'learner' && row.intent && row.identity_method && row.decided_at))
  assert.ok(records('beam_acknowledgments').some(row => row.id === decline.id && row.state === 'declined' && row.decline_reason))
  const exportedFile = exported.files.find(row => row.id === source.versionId)
  assert.equal(exportedFile.licence, 'licensed')
  assert.equal(exportedFile.sha256, sha(original))
  assert.ok(records('beam_external_certificates').some(row => row.id === external.id && row.state === 'approved'))
  for (const asset of exported.files) {
    const response = await h.raw(asset.href, { cookie: cookies.owner })
    assert.equal(response.status, 200)
    const bytes = Buffer.from(await response.arrayBuffer())
    assert.equal(bytes.length, asset.size)
    assert.equal(sha(bytes), asset.sha256)
  }
  const download = await h.raw(exportedFile.href, { cookie: cookies.owner })
  const bytes = Buffer.from(await download.arrayBuffer())
  assert.equal(download.status, 200)
  assert.equal(bytes.length, exportedFile.size)
  assert.equal(sha(bytes), exportedFile.sha256)
  assert.equal(bytes.toString(), original)
  assert.ok(exported.certificates.length)
  for (const cert of exported.certificates) {
    const pdf = await h.raw(cert.href, { cookie: cookies.owner })
    assert.equal(pdf.status, 200)
    const bytes = Buffer.from(await pdf.arrayBuffer())
    assert.ok(bytes.subarray(0, 5).equals(Buffer.from('%PDF-')))
    assert.equal(bytes.length, cert.size)
    assert.equal(sha(bytes), cert.sha256)
    assert.ok(records('beam_certificates').some(row => row.id === cert.id))
  }
  assert.ok(records('beam_attempts').some(row => row.id === failed.id && row.passed === 0))
  assert.ok(records('beam_attempts').some(row => row.id === passed.id && row.passed === 1))
  assert.ok(records('beam_responses').some(row => row.attempt_id === failed.id))
  assert.ok(records('beam_attempts').some(row => row.id === attempt.id && row.state === 'accepted'))
  assert.ok(records('beam_review_decisions').some(row => row.attempt_id === attempt.id))
  assert.ok(records('beam_path_requirements').some(row => row.course_id === c.id))
  assert.ok(records('beam_course_revisions').filter(row => row.course_id === c.id).length === 2)
  assert.ok(exported.files.some(row => row.filename === 'observation.txt'))
  for (const signature of exported.signatures) {
    const bytes = Buffer.from(await (await h.raw(signature.href, { cookie: cookies.owner })).arrayBuffer())
    assert.equal(sha(bytes), signature.sha256)
    assert.equal(bytes.length, signature.size)
  }
  // Employer-held licensed bytes are retained, never silently excluded or guessed from prose.
  assert.deepEqual(exported.exclusions, [])
  for (const secret of [h.vars.SESSION_SECRET, h.vars.SETUP_TOKEN, h.vars.MAIL_API_KEY, app.token, preparation.token, cookies.owner]) {
    assert.ok(secret && !text.includes(secret), 'credentials stay out of learning interchange')
  }
  assert.ok(!Object.keys(exported.records).some(name => /^(oa_|ik_)|credential|dashboard_share|certificate_link|view_session/.test(name)))
  for (const role of ['learner', 'manager', 'author']) {
    assert.equal((await h.raw('/app/data-export.json', { cookie: cookies[role] })).status, 403)
    assert.equal((await h.raw(exportedFile.href, { cookie: cookies[role] })).status, 403)
  }
  assert.equal((await h.raw('/app/data-export.json')).status, 303)
  const agent = await h.fetch('/app/data-export.json', { headers: { authorization: `Bearer ${preparation.token}` } })
  assert.equal(agent.status, 403)
  assert.equal((await h.raw(`/app/data-export/files/${'0'.repeat(64)}`, { cookie: cookies.owner })).status, 404)
  // Integrity failure remains visible rather than exporting corrupt source bytes.
  await h.files.put(`sha256/${source.sha256}`, 'changed')
  assert.equal((await h.raw(exportedFile.href, { cookie: cookies.owner })).status, 503)
  await h.files.put(`sha256/${source.sha256}`, original)
  const second = await (await h.raw('/app/data-export.json', { cookie: cookies.owner })).json()
  assert.equal(second.records.beam_course_revisions.sha256, exported.records.beam_course_revisions.sha256)
  assert.equal(request.created.length, 2)
  const disposableOwner = await h.signIn(h.vars.OWNER_EMAIL)
  assert.equal((await h.raw('/app/data-export.json', { cookie: disposableOwner })).status, 200)
  assert.equal((await h.raw('/auth/signout', { cookie: disposableOwner, body: {} })).status, 204)
  assert.equal((await h.raw('/app/data-export.json', { cookie: disposableOwner })).status, 303)
  assert.equal((await h.raw(exportedFile.href, { cookie: disposableOwner })).status, 303)
}
