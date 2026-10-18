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
async function reset(f) {
  const { api, h, cookies, ids, publish } = f
  ids.outsider = (await api('owner', 'person.invite', { email: 'outsider@example.test', name: 'outsider', roles: ['learner'] })).id
  cookies.outsider = await h.signIn('outsider@example.test', { requested: true })
  const team = (await api('manager', 'team.create', { name: 'Reset team' })).id
  await api('manager', 'team.members', { team, members: [ids.manager, ids.learner] })
  const c = await api('author', 'course.create', { title: 'Resettable procedure', reviewer: ids.reviewer })
  let draftVersion = c.draftVersion
  const edit = async (action, fields) => { draftVersion = (await api('author', action, { course: c.id, draftVersion, ...fields })).draftVersion }
  await edit('course.lesson', { title: 'Prepare', body: 'Lay out the tools.', sources: [] })
  await edit('course.lesson', { title: 'Perform', body: 'Perform the procedure.', sources: [] })
  await edit('course.question', { prompt: 'First step?', choices: 'Lay out the tools\nStart', correct: '1' })
  await edit('course.assessment', { passPercent: 100, maxAttempts: 1, practicalInstructions: 'Demonstrate the procedure', assessor: ids.assessor })
  const revision = (await api('author', 'course.submit', { course: c.id, draftVersion })).id
  await publish(revision)
  const [assignment, outside] = (await api('manager', 'assignment.create', { course: c.id, learners: [ids.learner, ids.outsider], dueDate: '2030-10-01' })).created
  const learn = async () => { const view = await api('learner', `assignments/${assignment}`); for (const lesson of view.lessons) await api('learner', 'lesson.complete', { assignment, lesson: lesson.id }); return view.quiz.questions[0] }
  // The learner fails the quiz, has a practical returned and resubmits it.
  const question = await learn()
  const failed = await api('learner', 'quiz.submit', { assignment, [`q_${question.id}`]: ['1'] })
  const rejected = await api('learner', 'practical.submit', { assignment, evidence: 'Skipped the tool check', file: file('first.txt', 'first evidence') })
  await api('assessor', 'practical.decide', { attempt: rejected.id, decision: 'rejected', note: 'Tools were not laid out.' })
  const pending = await api('learner', 'practical.submit', { assignment, evidence: 'Second try' })
  assert.equal((await api('learner', `assignments/${assignment}`)).quiz.attemptsLeft, 0)
  // Only managers reset, only for their own team's people; the owner resets anyone.
  await api('learner', 'assignment.reset', { assignment, reason: 'Self' }, 403)
  await api('manager', 'assignment.reset', { assignment: outside, reason: 'Not my team' }, 403)
  const reason = 'Failed the practical twice; retrained on the tool check.'
  const form = await h.submit('assignment.reset', cookies.manager, { assignment, reason }, `/app/learn/${assignment}`)
  assert.equal(form.searchParams.get('error'), null)
  const after = await api('learner', `assignments/${assignment}`)
  assert.deepEqual([after.resumeLesson, after.lessons.map(lesson => lesson.completed), after.quiz.attemptsLeft, after.attempts, after.practical.pending], [after.lessons[0].id, [false, false], 1, [], false])
  const [history] = after.resets
  assert.deepEqual([history.reason, history.resetBy, history.lessons.map(row => row.lesson)], [reason, ids.manager, after.lessons.map(lesson => lesson.id)])
  assert.deepEqual(history.attempts.map(row => [row.id, row.kind, row.state, row.closedByReset]), [[failed.id, 'quiz', 'scored', false], [rejected.id, 'practical', 'rejected', false], [pending.id, 'practical', 'awaiting_review', true]])
  const earlier = await api('manager', `attempts/${rejected.id}`)
  assert.deepEqual([earlier.reset.reason, earlier.decision.note, earlier.evidence], [reason, 'Tools were not laid out.', 'Skipped the tool check'])
  assert.equal((await h.raw(`/app/files/attachment/${earlier.attachment}`, { cookie: cookies.learner })).status, 200)
  // The unfinished practical was closed by the reset: its assessor can no longer decide it.
  assert.ok(!(await api('assessor', 'queues')).assessments.some(row => row.id === pending.id))
  await api('assessor', 'practical.decide', { attempt: pending.id, decision: 'accepted', note: 'Late' }, 409)
  const page = await (await h.raw(`/app/learn/${assignment}`, { cookie: cookies.learner })).text()
  assert.ok(page.includes('Your progress on this course was reset') && page.includes(reason))
  // A fresh run completes; numbering continues after the history.
  await learn()
  const passed = await api('learner', 'quiz.submit', { assignment, [`q_${question.id}`]: ['0'] })
  assert.deepEqual([passed.number, passed.passed], [2, true])
  const fresh = await api('learner', 'practical.submit', { assignment, evidence: 'Laid out the tools first' })
  assert.equal(fresh.number, 3)
  assert.ok((await api('assessor', 'practical.decide', { attempt: fresh.id, decision: 'accepted', note: 'Correct order.' })).completion)
  const completion = (await api('learner', 'records/me')).completions.find(row => row.course === c.id)
  assert.deepEqual([completion.evidence.quizAttempt, completion.evidence.practicalAttempt], [passed.id, fresh.id])
  // A completed assignment is not reset; the manager assigns the course again and the old completion stays.
  const refused = await h.raw('/api/beam/assignment.reset', { cookie: cookies.manager, body: { assignment, reason: 'Again' } })
  assert.equal(refused.status, 409)
  assert.deepEqual(await refused.json(), { error: 'completed_assignment_not_reset', detail: { createAssignment: { course: c.id, learners: [ids.learner] } } })
  const offer = await (await h.raw(`/app/learn/${assignment}`, { cookie: cookies.manager })).text()
  assert.ok(offer.includes('Assign the course again'))
  const again = await api('manager', 'assignment.create', { course: c.id, learners: [ids.learner], dueDate: '2031-10-01' })
  assert.equal(again.created.length, 1)
  const kept = (await api('learner', 'records/me')).completions.find(row => row.course === c.id)
  assert.deepEqual(kept, completion)
  assert.equal((await api('learner', `certificates/${kept.certificate}`)).revision, 1)
  assert.equal((await api('learner', `assignments/${assignment}`)).assignment.status, 'completed')
  await api('owner', 'assignment.reset', { assignment: outside, reason: 'Owner restart' })
  return { assignment, history }
}
export const learningChecks = [['BEAM-08 live named assessor authority', assessor], ['BEAM-10 exact offline revision', offline], ['BEAM-12 recurring renewal provenance', renewal], ['LEARN-019 reset with history kept', reset]]
