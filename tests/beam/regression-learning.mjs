import assert from 'node:assert/strict'
import { file } from './harness.mjs'

async function assessor(f) {
  const { api, h, cookies, course, assign, view, lessons, ids, request } = f
  const c = await course('Practical revocation', true), assignment = await assign(c)
  await lessons(assignment)
  const pending = await api('learner', 'practical.submit', { assignment, evidence: 'Demonstrated the whole procedure', file: file('evidence.txt', 'Observed evidence bytes') })
  const attachment = (await api('learner', `attempts/${pending.id}`)).attachment
  const paths = [`/api/beam/attempts/${pending.id}`, `/app/attempts/${pending.id}`, `/app/files/attachment/${attachment}`]
  const reads = async role => Promise.all(paths.map(async path => ({ path, status: (await request(path, { role })).status })))
  for (const role of ['assessor', 'manager', 'learner']) assert.ok((await reads(role)).every(r => r.status === 200))
  assert.ok((await reads('other')).every(r => r.status === 404))
  await api('other', 'practical.decide', { attempt: pending.id, decision: 'accepted', note: 'Not named' }, 403)
  await api('owner', 'person.roles', { email: 'assessor@example.test', roles: ['learner'] })
  const roles = (await api('assessor', 'me')).roles
  assert.deepEqual(roles, ['learner'])
  const revokedReads = await reads('assessor')
  const queued = (await api('assessor', 'queues')).assessments.some(a => a.id === pending.id)
  const json = await request('/api/beam/practical.decide', { role: 'assessor', body: { attempt: pending.id, decision: 'accepted', note: 'Revoked JSON decision' } })
  const form = await h.submit('practical.decide', cookies.assessor, { attempt: pending.id, decision: 'accepted', note: 'Revoked form decision' })
  const after = await view(assignment), attempt = await api('learner', `attempts/${pending.id}`)
  const completions = (await api('learner', 'records/me')).completions.filter(r => r.course === c.id)
  const result = { roles, revokedReads, queued, formError: form.searchParams.get('error'), jsonStatus: json.status, assignment: after.assignment, attemptState: attempt.state, completion: after.completion, completions }
  {
    assert.ok(revokedReads.every(r => r.status === 404)); assert.equal(queued, false)
    assert.ok(form.searchParams.get('error')); assert.equal(json.status, 403)
    assert.equal(attempt.state, 'awaiting_review'); assert.equal(after.assignment.status, 'open'); assert.equal(after.completion, null); assert.equal(completions.length, 0)
  }
  await api('owner', 'person.roles', { email: 'assessor@example.test', roles: ['assessor', 'learner'] })
  {
    const accepted = await api('assessor', 'practical.decide', { attempt: pending.id, decision: 'accepted', note: 'Role restored; observed demonstration' })
    assert.ok(accepted.completion)
    result.restored = await view(assignment)
    assert.equal(result.restored.completion.revision, c.revision)
  }
  return result
}

async function offline(f) {
  const { api, h, cookies, course, nextRevision, publish, assign, view, offline, request } = f
  const c = await course('Exact offline revision'), assignment = await assign(c)
  const revisionB = await nextRevision(c)
  await publish(revisionB, { reassignment: 'none' })
  await api('manager', 'offline.record', offline(c, revisionB))
  const afterB = await view(assignment)
  const completionB = (await api('learner', 'records/me')).completions.find(r => r.course === c.id)
  const certificateB = await api('learner', `certificates/${completionB.certificate}`)
  const result = { revisionA: c.revision, revisionB, afterB, completionB, certificateB }
  {
    assert.equal(afterB.assignment.status, 'open'); assert.equal(afterB.completion, null); assert.equal(completionB.revision, revisionB); assert.equal(certificateB.revision, 2)
    // A form opened while B was current keeps B, even after another publication.
    const html = await (await h.raw('/app/manage', { cookie: cookies.manager })).text()
    assert.ok(html.includes(`value="${c.revision}"`) && html.includes(`value="${revisionB}"`))
    const revisionC = await nextRevision(c)
    const invalid = { ...offline(c, revisionC), file: file('refused.txt', 'Must not be stored') }
    result.unpublished = (await request('/api/beam/offline.record', { role: 'manager', body: invalid })).status
    const other = await course('Different course')
    result.wrongCourse = (await request('/api/beam/offline.record', { role: 'manager', body: { ...invalid, revision: other.revision } })).status
    result.missingRevision = (await request('/api/beam/offline.record', { role: 'manager', body: { ...invalid, revision: undefined } })).status
    assert.deepEqual([result.unpublished, result.wrongCourse, result.missingRevision], [409, 409, 400])
    assert.equal((await api('learner', 'records/me')).completions.filter(r => r.course === c.id).length, 1)
    await publish(revisionC)
    const form = await h.submit('offline.record', cookies.manager, offline(c, revisionB))
    assert.equal(form.searchParams.get('error'), null)
    assert.equal((await view(assignment)).assignment.status, 'open')
    assert.equal((await api('learner', 'records/me')).completions.filter(r => r.course === c.id && r.revision === revisionB).length, 2)
    await api('manager', 'offline.record', offline(c))
    result.afterA = await view(assignment)
    result.certificateA = await api('learner', `certificates/${result.afterA.completion.certificate}`)
    assert.equal(result.afterA.assignment.status, 'completed'); assert.equal(result.afterA.completion.revision, c.revision); assert.equal(result.certificateA.revision, 1)
  }
  return result
}

async function renewal(f) {
  const { api, course, ids, view, offline } = f
  const prerequisite = await course('Renewal prerequisite'), c = await course('Recurring procedure')
  await api('manager', 'offline.record', offline(prerequisite))
  const team = (await api('manager', 'team.create', { name: 'Renewing team' })).id
  await api('manager', 'team.members', { team, members: [ids.learner] })
  const path = (await api('manager', 'path.create', { name: 'Recurring path', team })).id
  const requirements = { path, courses: [prerequisite.id, c.id], prerequisites: ['', prerequisite.id], dueDays: ['1', '1'], renewalDays: ['', '7'] }
  const origin = (await api('manager', 'path.revise', requirements)).id
  await api('manager', 'path.assign', { path })
  let assignment = (await api('learner', 'records/me')).assignments.find(a => a.course === c.id && a.status === 'open').id
  const cycles = []
  const queue = async () => (await api('manager', 'queues')).renewals.filter(r => r.course === c.id)
  for (let cycle = 0; cycle < 3; cycle++) {
    const prior = await view(assignment)
    // Same date on every attestation exercises equal completed_at ordering.
    const completed = (await api('manager', 'offline.record', offline(c))).completions[0]
    const certificate = await api('learner', `certificates/${completed.certificate}`)
    const due = await queue()
    cycles.push({ assignment: prior.assignment, prerequisite: prior.prerequisite, completed, certificate, due })
    assert.equal(certificate.expiresAt - certificate.completedAt, 7 * 86_400_000)
    assert.equal(prior.assignment.pathRevision, origin); assert.equal(prior.prerequisite, prerequisite.id); assert.equal(due.length, 1); assert.equal(due[0].completion, completed.id)
    if (cycle === 2) break
    if (cycle === 0) await api('manager', 'path.revise', { ...requirements, renewalDays: ['', '90'], prerequisites: ['', ''] })
    const renewed = await api('manager', 'assignment.renewals', { completions: [completed.id] })
    assert.equal(renewed.created.length, 1)
    assignment = renewed.created[0]
    assert.equal((await queue()).length, 0)
    assert.equal((await api('manager', 'assignment.renewals', {})).created.length, 0)
  }
  return { path, origin, cycles }
}
export const learningChecks = [['BEAM-08 live named assessor authority', assessor], ['BEAM-10 exact offline revision', offline], ['BEAM-12 recurring renewal provenance', renewal]]
