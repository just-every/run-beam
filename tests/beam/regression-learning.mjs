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
  await api('owner', 'person.roles', { member: ids.assessor, roles: ['learner'] })
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
  await api('owner', 'person.roles', { member: ids.assessor, roles: ['assessor', 'learner'] })
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
  const { api, course, ids, view } = f
  // Keep all attestations on one current day: an expired fixed date makes the next renewal overdue after 17:00 UTC.
  const heldOn = new Date().toISOString().slice(0, 10)
  const offline = (...args) => ({ ...f.offline(...args), heldOn })
  const prerequisite = await course('Renewal prerequisite'), c = await course('Recurring procedure')
  await api('manager', 'offline.record', offline(prerequisite))
  const team = await f.team('Renewing team', [ids.learner])
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
  const c = await api('author', 'course.create', { title: 'Resettable procedure', reviewer: ids.reviewer })
  let draftVersion = c.draftVersion
  const edit = async (action, fields) => { draftVersion = (await api('author', action, { course: c.id, draftVersion, ...fields })).draftVersion }
  await edit('course.lesson', { title: 'Prepare', body: 'Lay out the tools.', sources: [] })
  await edit('course.lesson', { title: 'Perform', body: 'Perform the procedure.', sources: [] })
  await edit('course.question', { prompt: 'First step?', choices: 'Lay out the tools\nStart', correct: '1' })
  await edit('course.assessment', { passPercent: 100, maxAttempts: 1, practicalInstructions: 'Demonstrate the procedure', assessor: ids.assessor })
  const revision = (await api('author', 'course.submit', { course: c.id, draftVersion })).id
  await publish(revision)
  const [assignment, outside] = (await api('owner', 'assignment.create', { course: c.id, learners: [ids.learner, ids.outsider], dueDate: '2030-10-01' })).created
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
// AUTO-009: windows from a course, a path and one assignment; closed lessons refused through the page, form and JSON
// doors with records kept; a manager's reasoned extension; a renewal's fresh window under the path's rule.
async function windows(f) {
  const { api, h, cookies, ids, course } = f
  const DAY = 86_400_000
  // Time passes for one assignment: its enrolment, due time and window move back together.
  const age = (assignment, ms) => h.db.prepare('UPDATE beam_assignments SET assigned_at = assigned_at - ?1, due_at = due_at - ?1, access_opens_at = access_opens_at - ?1, access_closes_at = access_closes_at - ?1 WHERE id = ?2').bind(ms, assignment).run()
  const relative = await course('Thirty-day access'), dated = await course('Dated access')
  await api('manager', 'access.rule', { scope: 'course', target: relative.id, kind: 'after_enrolment', closeDays: 30 }, 403)
  await api('owner', 'access.rule', { scope: 'course', target: relative.id, kind: 'after_enrolment', closeDays: 30 })
  await api('owner', 'access.rule', { scope: 'course', target: dated.id, kind: 'dates', openDate: '2030-03-08', closeDate: '2030-03-01' }, 400)
  await api('owner', 'access.rule', { scope: 'course', target: dated.id, kind: 'dates', openDate: '2030-03-01', closeDate: '2030-03-08' })
  const before = Date.now()
  const [a30, b30] = (await api('owner', 'assignment.create', { course: relative.id, learners: [ids.learner, ids.assessor], dueDate: '2030-10-01' })).created
  const [aDated] = (await api('manager', 'assignment.create', { course: dated.id, learners: [ids.learner], dueDate: '2030-10-01' })).created
  const open = await api('learner', `assignments/${a30}`)
  assert.equal(open.access.state, 'open')
  assert.ok(open.access.closesAt >= before + 30 * DAY && open.access.closesAt <= Date.now() + 30 * DAY)
  assert.ok(open.lessons[0].body)
  // Before the window opens the course is listed with its opening date but cannot be launched.
  const waiting = await api('learner', `assignments/${aDated}`)
  assert.deepEqual([waiting.access.state, waiting.access.opensAt, waiting.access.closesAt, waiting.lessons[0].body], ['not_open', Date.UTC(2030, 2, 1), Date.UTC(2030, 2, 9), undefined])
  const lesson = waiting.lessons[0].id
  assert.equal((await api('learner', 'lesson.complete', { assignment: aDated, lesson }, 403)).error, 'access_not_open')
  assert.equal((await h.submit('lesson.complete', cookies.learner, { assignment: aDated, lesson }, `/app/learn/${aDated}`)).searchParams.get('error'), 'access_not_open')
  assert.equal((await h.raw(`/app/learn/${aDated}/lessons/${lesson}`, { cookie: cookies.learner })).status, 403)
  const listed = await (await h.raw(`/app/learn/${aDated}`, { cookie: cookies.learner })).text()
  assert.ok(listed.includes('This course opens on') && !listed.includes('>Start<'))
  assert.ok((await (await h.raw('/app/learning', { cookie: cookies.learner })).text()).includes('opens '))
  // The second learner finishes inside the window and keeps the certificate after it closes.
  const finished = (await api('assessor', 'lesson.complete', { assignment: b30, lesson: (await api('assessor', `assignments/${b30}`)).lessons[0].id })).completion
  for (const id of [a30, b30]) await age(id, 31 * DAY)
  const ended = await api('learner', `assignments/${a30}`)
  assert.deepEqual([ended.access.state, ended.assignment.status, ended.lessons[0].body], ['ended', 'open', undefined])
  const closed = ended.lessons[0].id
  assert.equal((await api('learner', 'lesson.complete', { assignment: a30, lesson: closed }, 403)).error, 'access_ended')
  assert.equal((await h.submit('lesson.complete', cookies.learner, { assignment: a30, lesson: closed }, `/app/learn/${a30}`)).searchParams.get('error'), 'access_ended')
  assert.equal((await h.raw(`/app/learn/${a30}/lessons/${closed}`, { cookie: cookies.learner })).status, 403)
  assert.ok((await (await h.raw(`/app/learn/${a30}`, { cookie: cookies.learner })).text()).includes('Access ended on'))
  assert.equal((await api('assessor', `certificates/${finished.certificate}`)).course, 'Thirty-day access')
  assert.equal((await h.raw(`/app/certificates/${finished.certificate}`, { cookie: cookies.assessor })).status, 200)
  assert.ok((await api('assessor', 'records/me')).completions.some(row => row.id === finished.id))
  const reportRow = async () => (await api('manager', `report?course=${relative.id}`)).rows.find(row => row.assignment === a30)
  const stale = await reportRow()
  assert.deepEqual([stale.status, stale.accessClosesAt, stale.extension], ['open', ended.access.closesAt, null])
  // The fixed-date window closes too; the owner then sets this one assignment's own window, which reopens it.
  await age(aDated, waiting.access.closesAt - Date.now() + DAY)
  assert.equal((await api('learner', `assignments/${aDated}`)).access.state, 'ended')
  await api('manager', 'assignment.window', { assignment: aDated, kind: 'dates', openDate: '2026-01-01', closeDate: '2031-12-31' }, 403)
  await api('owner', 'assignment.window', { assignment: aDated, kind: 'dates', openDate: '2026-01-01', closeDate: '2031-12-31' })
  assert.deepEqual((await api('learner', `assignments/${aDated}`)).access.rule, { kind: 'dates', openDate: '2026-01-01', closeDate: '2031-12-31', timezone: 'UTC', source: 'assignment' })
  assert.ok((await api('learner', 'lesson.complete', { assignment: aDated, lesson })).completion)
  // A manager extends a learner in their team by seven days with a reason; the due date stays as it was.
  await api('manager', 'access.extend', { assignment: b30, days: 7, reason: 'Not my team' }, 403)
  const reason = 'Was on leave when the window closed.'
  const form = await h.submit('access.extend', cookies.manager, { assignment: a30, days: '7', reason }, `/app/learn/${a30}`)
  assert.equal(form.searchParams.get('error'), null)
  const extended = await api('learner', `assignments/${a30}`)
  assert.equal(extended.access.state, 'open')
  assert.ok(extended.access.closesAt > Date.now() + 6 * DAY && extended.access.closesAt <= Date.now() + 7 * DAY)
  assert.deepEqual(extended.access.extensions.map(row => [row.days, row.reason, row.extendedBy, row.previousClosesAt]), [[7, reason, ids.manager, ended.access.closesAt]])
  const row = await reportRow()
  assert.deepEqual([row.status, row.dueAt, row.extension], ['open', stale.dueAt, { days: 7, reason, by: 'manager', count: 1 }])
  assert.ok((await (await h.raw(`/app/reports.csv?course=${relative.id}`, { cookie: cookies.manager })).text()).includes(reason))
  assert.ok((await api('learner', 'lesson.complete', { assignment: a30, lesson: closed })).completion)
  // A path's rule wins over the course's, and its renewal gets a fresh window under that rule.
  const path = (await api('manager', 'path.create', { name: 'Window path', team: ids.team })).id
  await api('manager', 'path.revise', { path, courses: [relative.id], prerequisites: [''], dueDays: ['14'], renewalDays: ['1'] })
  await api('owner', 'access.rule', { scope: 'path', target: path, kind: 'after_enrolment', closeDays: 10 })
  await api('manager', 'path.assign', { path })
  const pathAssignment = (await api('learner', 'records/me')).assignments.find(row => row.course === relative.id && row.status === 'open').id
  const first = await api('learner', `assignments/${pathAssignment}`)
  assert.equal(first.access.rule.source, 'path')
  assert.ok(first.access.closesAt <= Date.now() + 10 * DAY)
  const done = (await api('learner', 'lesson.complete', { assignment: pathAssignment, lesson: first.lessons[0].id })).completion
  await age(pathAssignment, 20 * DAY)
  const renewalStart = Date.now()
  const [renewal] = (await api('manager', 'assignment.renewals', { completions: [done.id] })).created
  const renewed = await api('learner', `assignments/${renewal}`)
  assert.deepEqual([renewed.assignment.reason, renewed.access.state, renewed.access.rule.source], ['renewal', 'open', 'path'])
  assert.ok(renewed.access.closesAt >= renewalStart + 10 * DAY && renewed.access.closesAt <= Date.now() + 10 * DAY)
  return { a30, aDated, renewal, extension: extended.access.extensions[0] }
}
export const learningChecks = [['BEAM-08 live named assessor authority', assessor], ['BEAM-10 exact offline revision', offline], ['BEAM-12 recurring renewal provenance', renewal], ['LEARN-019 reset with history kept', reset], ['AUTO-009 access windows', windows]]
