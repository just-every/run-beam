import { languageBrowserCheck } from './regression-language-browser.mjs'
import assert from 'node:assert/strict'
import { file } from './harness.mjs'
import { randomUUID } from 'node:crypto'

// LEARN-003: retries represent one learner action even when the successful response was lost.
async function learningReliabilityCheck(f) {
  const c = await f.course('synthetic-beam-1', true), assignment = await f.assign(c)
  const lesson = (await f.view(assignment)).lessons[0].id
  const progress = { assignment, lesson, submission: randomUUID() }
  await f.api('learner', 'lesson.complete', progress)
  await f.api('learner', 'lesson.complete', progress)
  assert.equal((await f.view(assignment)).lessons.filter(item => item.completed).length, 1)
  const evidence = { assignment, submission: randomUUID(), evidence: 'synthetic-beam-2 observed demonstration', file: file('synthetic-beam-3.txt', 'synthetic-beam-4 evidence bytes') }
  const first = await f.api('learner', 'practical.submit', evidence)
  const repeated = await f.api('learner', 'practical.submit', evidence)
  assert.equal(repeated.id, first.id)
  assert.equal((await f.view(assignment)).attempts.filter(item => item.kind === 'practical').length, 1)
  const attempt = await f.api('learner', `attempts/${first.id}`)
  assert.equal(attempt.evidence, evidence.evidence)
  const attachment = await f.h.raw(`/app/files/attachment/${attempt.attachment}`, { cookie: f.cookies.learner })
  assert.equal(await attachment.text(), 'synthetic-beam-4 evidence bytes')
  await f.api('other', 'practical.submit', evidence, 404)
  await f.api('learner', 'practical.submit', { ...evidence, submission: randomUUID() }, 409)
  await f.api('assessor', 'practical.decide', { attempt: first.id, decision: 'accepted', note: 'synthetic-beam-5 observed and accepted' })
  assert.equal((await f.api('learner', 'practical.submit', evidence)).id, first.id)
  const records = await f.api('learner', 'records/me')
  assert.equal(records.completions.filter(item => item.course === c.id).length, 1)
  assert.equal((await f.view(assignment)).completion.revision, c.revision)
}

export async function assessorCheck(f) {
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

export async function offlineCheck(f) {
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

export async function renewalCheck(f) {
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
  // The seven days are added to the closing day the window had, which had passed a day earlier.
  assert.equal(extended.access.closesAt, ended.access.closesAt + 7 * DAY)
  assert.deepEqual(extended.access.extensions.map(row => [row.days, row.reason, row.extendedBy, row.previousClosesAt]), [[7, reason, ids.manager, ended.access.closesAt]])
  const row = await reportRow()
  assert.deepEqual([row.status, row.dueAt, row.extension], ['open', stale.dueAt, { days: 7, reason, by: 'manager', count: 1 }])
  assert.ok((await (await h.raw(`/app/reports.csv?course=${relative.id}`, { cookie: cookies.manager })).text()).includes(reason))
  assert.ok((await api('learner', 'lesson.complete', { assignment: a30, lesson: closed })).completion)
  // Changing a course's rule leaves existing assignments' windows alone.
  const kept = (await api('assessor', `assignments/${b30}`)).access.closesAt
  await api('owner', 'access.rule', { scope: 'course', target: relative.id, kind: 'after_enrolment', closeDays: 5 })
  assert.equal((await api('learner', `assignments/${a30}`)).access.closesAt, extended.access.closesAt)
  assert.equal((await api('assessor', `assignments/${b30}`)).access.closesAt, kept)
  // Fixed dates are the employer's local days: the opening day from 00:00 to the end of the closing day, here in Sydney.
  const business = (await api('owner', 'me')).business
  await api('owner', 'business.configure', { name: business.name, timezone: 'Australia/Sydney' })
  const sydney = await course('Sydney access')
  await api('owner', 'access.rule', { scope: 'course', target: sydney.id, kind: 'dates', openDate: '2030-03-01', closeDate: '2030-03-08' })
  await api('owner', 'business.configure', { name: business.name, timezone: business.timezone })
  const [local] = (await api('owner', 'assignment.create', { course: sydney.id, learners: [ids.learner], dueDate: '2030-10-01' })).created
  const localWindow = (await api('learner', `assignments/${local}`)).access
  assert.deepEqual([localWindow.opensAt, localWindow.closesAt, localWindow.rule.timezone], [Date.UTC(2030, 1, 28, 13), Date.UTC(2030, 2, 8, 13), 'Australia/Sydney'])
  // Assessments close with the lessons: the practical and quiz page, form and JSON doors refuse once the window ends.
  const practical = await course('Closed practical', true)
  const quizzed = await api('author', 'course.create', { title: 'Closed quiz', reviewer: ids.reviewer })
  let draft = (await api('author', 'course.lesson', { course: quizzed.id, draftVersion: quizzed.draftVersion, title: 'Procedure', body: 'Perform the owned procedure.', sources: [] })).draftVersion
  draft = (await api('author', 'course.question', { course: quizzed.id, draftVersion: draft, prompt: 'First step?', choices: 'Check\nSkip', correct: '1' })).draftVersion
  draft = (await api('author', 'course.assessment', { course: quizzed.id, draftVersion: draft, passPercent: 100, maxAttempts: 2 })).draftVersion
  await f.publish((await api('author', 'course.submit', { course: quizzed.id, draftVersion: draft })).id)
  for (const target of [practical.id, quizzed.id]) await api('owner', 'access.rule', { scope: 'course', target, kind: 'after_enrolment', closeDays: 30 })
  const [gated] = (await api('owner', 'assignment.create', { course: practical.id, learners: [ids.learner], dueDate: '2030-10-01' })).created
  const [quiz] = (await api('owner', 'assignment.create', { course: quizzed.id, learners: [ids.learner], dueDate: '2030-10-01' })).created
  for (const id of [gated, quiz]) for (const lesson of (await api('learner', `assignments/${id}`)).lessons) await api('learner', 'lesson.complete', { assignment: id, lesson: lesson.id })
  await age(gated, 41 * DAY); await age(quiz, 31 * DAY)
  assert.equal((await api('learner', 'practical.submit', { assignment: gated, evidence: 'Too late', file: file('late.txt', 'Late evidence') }, 403)).error, 'access_ended')
  assert.equal((await h.submit('practical.submit', cookies.learner, { assignment: gated, evidence: 'Too late' }, `/app/learn/${gated}`)).searchParams.get('error'), 'access_ended')
  assert.equal((await h.raw(`/app/learn/${gated}/practical`, { cookie: cookies.learner })).status, 403)
  assert.equal((await api('learner', 'quiz.start', { assignment: quiz }, 403)).error, 'access_ended')
  assert.equal((await h.submit('quiz.submit', cookies.learner, { assignment: quiz }, `/app/learn/${quiz}`)).searchParams.get('error'), 'access_ended')
  assert.equal((await h.raw(`/app/learn/${quiz}/quiz`, { cookie: cookies.learner })).status, 403)
  // A window that closed eleven days ago is still closed after seven more days, and open once the second seven are added.
  const closedAt = (await api('learner', `assignments/${gated}`)).access.closesAt
  assert.equal((await api('manager', 'access.extend', { assignment: gated, days: 7, reason: 'First week' })).closesAt, closedAt + 7 * DAY)
  assert.equal((await api('learner', `assignments/${gated}`)).access.state, 'ended')
  assert.equal((await api('learner', 'practical.submit', { assignment: gated, evidence: 'Still late', file: file('late.txt', 'Late evidence') }, 403)).error, 'access_ended')
  assert.equal((await api('manager', 'access.extend', { assignment: gated, days: 7, reason: 'Second week' })).closesAt, closedAt + 14 * DAY)
  assert.equal((await api('learner', `assignments/${gated}`)).access.state, 'open')
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
  // Changing the path's rule moves neither the first assignment's window nor the renewal's.
  await api('owner', 'access.rule', { scope: 'path', target: path, kind: 'after_enrolment', closeDays: 3 })
  assert.equal((await api('learner', `assignments/${pathAssignment}`)).access.closesAt, first.access.closesAt - 20 * DAY)
  assert.equal((await api('learner', `assignments/${renewal}`)).access.closesAt, renewed.access.closesAt)
  return { a30, aDated, renewal, extension: extended.access.extensions[0] }
}
export const learningChecks = [['LEARN-003 retry without duplicate learning or evidence', learningReliabilityCheck], ['LEARN-019 reset with history kept', reset], ['AUTO-009 access windows', windows]]

// LEARN-017's implemented language slice; other surfaces stay named in the contract Gap.
export async function languageCheck() {
  const { courseLocaleCheck } = await import('./regression-course-locales.mjs')
  await courseLocaleCheck()
  const { hrisLanguageCheck } = await import('./regression-hris-language.mjs')
  await hrisLanguageCheck()
  const { fixture } = await import('./regression-fixture.mjs')
  const f = await fixture(), { api, h, ids, cookies, assign } = f
  try {
    const language = () => api('learner', 'language')
    const defaults = (kind, scope, language) => api('owner', 'language.default', { kind, scope, language })
    assert.deepEqual(await language(), { language: 'en-US', source: 'installation' })
    await api('manager', 'language.default', { kind: 'installation', language: 'es-US' }, 403)
    await defaults('installation', '', 'es-US')
    assert.equal((await language()).language, 'es-US')
    await defaults('team', ids.team, 'en-US')
    assert.deepEqual(await language(), { language: 'en-US', source: 'team' })
    await api('owner', 'person.directory', { member: ids.learner, location: 'Packing' })
    await defaults('location', 'Packing', 'es-US')
    assert.deepEqual(await language(), { language: 'es-US', source: 'location' })
    await api('owner', 'person.directory', { member: ids.learner, language: 'en' })
    assert.deepEqual(await language(), { language: 'en-US', source: 'person' })
    // HRIS/importers inherit the existing directory preference; no unheld connector is simulated.
    await api('owner', 'person.directory', { member: ids.learner, language: 'es-US' })
    assert.deepEqual(await language(), { language: 'es-US', source: 'person' })
    const { languageErrorCheck } = await import('./regression-language-errors.mjs')
    await languageErrorCheck(f)
    const c = await api('author', 'course.create', { title: 'English safety course', reviewer: ids.reviewer })
    const lesson = await api('author', 'course.lesson', { course: c.id, draftVersion: c.draftVersion, title: 'English procedure', body: 'USER CONTENT: My learning. Use clean tools.', sources: [] })
    const block = await api('author', 'course.block', { course: c.id, draftVersion: lesson.draftVersion, lesson: lesson.draft.lessons[0].id, content: { kind: 'check', text: 'USER PRACTICE CHECK', choices: ['USER CHECK CHOICE', 'USER OTHER CHECK'], answer: 0, feedback: 'USER CHECK FEEDBACK' } })
    const question = await api('author', 'course.question', { course: c.id, draftVersion: block.draftVersion, prompt: 'USER QUESTION: Choose clean', choices: 'Clean\nDirty', correct: '1' })
    const rules = await api('author', 'course.assessment', { course: c.id, draftVersion: question.draftVersion, passPercent: 80, maxAttempts: 3 })
    await f.publish((await api('author', 'course.submit', { course: c.id, draftVersion: rules.draftVersion })).id)
    const assignment = await assign(c)
    const page = async path => { const response = await h.raw(path, { cookie: cookies.learner }); assert.equal(response.status, 200, path); return response.text() }
    let dashboard = await page('/app/learning')
    assert.match(dashboard, /<html lang="es-US">/)
    for (const label of ['Mi aprendizaje', 'Mis asignaciones', 'Guardar idioma', 'English safety course']) assert.ok(dashboard.includes(label), label)
    const overview = await page(`/app/learn/${assignment}`)
    assert.ok(overview.includes('No hay una versión revisada en español') && overview.includes('idioma original (en)'))
    const view = await api('learner', `assignments/${assignment}`), lessonId = view.lessons[0].id
    const lessonHtml = await page(`/app/learn/${assignment}/lessons/${lessonId}`)
    assert.ok(lessonHtml.includes('Lectura de la lección') && lessonHtml.includes('Marcar como completada'))
    assert.ok(lessonHtml.includes('Comprobar tu respuesta') && lessonHtml.includes('USER PRACTICE CHECK'))
    assert.ok(lessonHtml.includes('USER CONTENT: My learning. Use clean tools.'), 'authored English is never translated by string coincidence')
    const peripheral = await languagePeripheralFixture(f, { assignment, lesson: lessonId, course: c.id })
    if (process.env.BEAM_LANGUAGE_BROWSER === '1') await languageBrowserCheck(f, { assignment, lesson: lessonId, course: c.id, peripheral })
    else {
      await api('learner', 'quiz.start', { assignment: peripheral.timed })
      const timedHtml = await page(`/app/learn/${peripheral.timed}/quiz`)
      assert.ok(timedHtml.includes('Guardar respuestas') && timedHtml.includes('respuesta escrita') && timedHtml.includes('completa el espacio') && timedHtml.includes('ordena los elementos') && timedHtml.includes('relaciona cada elemento'))
      assert.ok(timedHtml.includes('data-warning-five="Quedan cinco minutos.') && timedHtml.includes('USER WRITTEN QUESTION'))
      const timedView = await api('learner', `assignments/${peripheral.timed}`)
      const written = timedView.quiz.questions.find(question => question.kind === 'text')
      await api('learner', 'quiz.save', { assignment: peripheral.timed, [`q_${written.id}`]: 'USER WRITTEN ANSWER' })
      assert.ok((await page(`/app/learn/${peripheral.timed}/quiz`)).includes('USER WRITTEN ANSWER'))
      await api('learner', 'lesson.complete', { assignment, lesson: lessonId })
      const quiz = await page(`/app/learn/${assignment}/quiz`)
      assert.ok(quiz.includes('Calificación mínima') && quiz.includes('Enviar respuestas') && quiz.includes('USER QUESTION: Choose clean'))
      await api('learner', 'quiz.submit', { assignment, [`q_${view.quiz.questions[0].id}`]: ['0'] })
    }
    const record = await api('learner', 'records/me'), certificate = record.completions.find(row => row.course === c.id).certificate
    assert.match(await page(`/app/certificates/${certificate}`), /Certificado de finalización/)
    const completedView = await api('learner', `assignments/${assignment}`)
    assert.match(await page(`/app/attempts/${completedView.attempts[0].id}`), /Puntuación/)
    for (const [name, path, spanish] of peripheral.pages) {
      const html = await page(path)
      assert.ok(html.includes(spanish), `${name} uses Spanish interface controls`)
      assert.match(html, /<html lang="es-US">/)
    }
    const acknowledgmentPath = peripheral.pages.find(([name]) => name === 'acknowledgment')[1]
    const acknowledgmentId = acknowledgmentPath.split('/').at(-1)
    const declaration = await api('learner', `acknowledgments/${acknowledgmentId}`)
    assert.equal(declaration.intentLocale, 'es-US')
    assert.ok(declaration.intent.startsWith('Firmo'))
    await api('learner', 'acknowledgment.decide', { acknowledgment: acknowledgmentId, decision: 'sign', agree: 'yes', signature: 'learner', intentLocale: 'en-US', intent: declaration.intent }, 409)
    const signed = await h.submit('acknowledgment.decide', cookies.learner, { acknowledgment: acknowledgmentId, decision: 'sign', agree: 'yes', signature: 'learner', intentLocale: declaration.intentLocale, intent: declaration.intent }, acknowledgmentPath)
    assert.equal(signed.searchParams.get('error'), null)
    const signatureEvidence = await (await h.raw(acknowledgmentPath + '/evidence', { cookie: cookies.learner })).text()
    assert.ok(signatureEvidence.includes(declaration.intent) && signatureEvidence.includes('es-US'))
    if (process.env.BEAM_LANGUAGE_BROWSER === '1') await languageBrowserCheck(f, { signedPath: acknowledgmentPath })
    const link = await api('learner', 'certificate.link', { certificate })
    const linksPage = await page(`/app/certificates/${certificate}?link=${link.id}`)
    assert.ok(linksPage.includes('Enlace de verificación') && linksPage.includes('Revocar'))
    const verification = await h.raw(`/verify/${link.id}?lang=es-US`)
    assert.equal(verification.status, 200)
    const verified = await verification.text()
    assert.ok(verified.includes('<html lang="es-US">') && verified.includes('Certificado verificado') && verified.includes('English safety course'))
    assert.ok((await (await h.raw(`/verify/${link.id}?lang=en-US`)).text()).includes('Certificate verified'))
    const pdf = await h.raw(`/app/certificates/${certificate}.pdf`, { cookie: cookies.learner }), pdfText = Buffer.from(await pdf.arrayBuffer()).toString('latin1')
    assert.ok(pdfText.includes('/Lang (es-US)') && pdfText.includes('Certificado de finalizaci') && pdfText.includes('ha completado'))
    // Actually invoke Beam's existing mail door; the provider edge only captures its request/receipt.
    const overdue = await f.course('Language reminder'), overdueAssignment = await assign(overdue)
    await h.db.prepare('UPDATE beam_assignments SET due_at=? WHERE id=?').bind(Date.now() - 3_600_000, overdueAssignment).run()
    let policy = await api('owner', 'escalation-policy')
    await api('owner', 'escalation.policy', { version: policy?.version ?? 0, enabled: true, reminderHours: 0, managerHours: 48, fallbackHours: 72 })
    await api('owner', 'escalation.run', {})
    const learnerMail = () => h.mails.filter(m => m.to.includes('learner@example.test') && m.text?.includes('Language reminder'))
    assert.equal(learnerMail().at(-1).subject, 'Tienes una capacitación vencida')
    assert.ok(learnerMail().at(-1).text.includes(`/app/learn/${overdueAssignment}`))
    const change = await h.submit('language.change', cookies.learner, { language: 'en-US' }, '/app/learning')
    assert.equal(change.searchParams.get('error'), null)
    assert.deepEqual(await language(), { language: 'en-US', source: 'person' })
    assert.ok((await page('/app/learning')).includes('<h1>My learning</h1>'))
    assert.equal((await api('learner', `acknowledgments/${acknowledgmentId}`)).intent, declaration.intent, 'a language switch never rewrites the signed declaration')
    const second = await f.course('Language reminder 2'), secondAssignment = await assign(second)
    await h.db.prepare('UPDATE beam_assignments SET due_at=? WHERE id=?').bind(Date.now() - 3_600_000, secondAssignment).run()
    await api('owner', 'escalation.run', {})
    assert.equal(learnerMail().at(-1).subject, 'Overdue learning needs attention')
    await api('learner', 'language.change', { language: 'fr-FR' }, 400)
    await api('learner', 'language.change', { language: 'default', member: ids.owner })
    assert.deepEqual(await language(), { language: 'es-US', source: 'location' })
    assert.equal((await api('owner', 'language')).source, 'installation', 'self switch cannot change another member')
    // ORG-012 inherits the learner's effective language while refusing the setting itself.
    const start = await h.raw('/app/view/start', { cookie: cookies.owner, form: new URLSearchParams({ learner: ids.learner }) })
    const viewCookie = [cookies.owner, ...start.headers.getSetCookie().map(line => line.split(';')[0])].join('; ')
    const asHtml = await (await h.raw('/app/learning', { cookie: viewCookie })).text()
    assert.ok(asHtml.includes('Mi aprendizaje') && !asHtml.includes('action="/app/do/language.change"'))
    await h.api('language.change', viewCookie, { language: 'en-US' }, 403)
    assert.equal((await language()).language, 'es-US')
  } finally { await h.close() }
}

async function languagePeripheralFixture(f, item) {
  const { api, ids, h, cookies } = f
  await api('owner', 'course.enrollment', { course: item.course, mode: 'open' })
  const notification = await api('owner', 'notification.save', { name: 'synthetic-beam-1', recipient: 'learner', course: item.course, subject: 'USER ENGLISH NOTICE', body: 'USER DEFAULT {course_name}', variantLanguage: 'es', variantSubject: 'AVISO EN ESPAÑOL', variantBody: 'USER SPANISH VARIANT {course_name}' })
  await api('owner', 'notification.test', { rule: notification.id })
  await api('owner', 'notification.state', { rule: notification.id, enabled: true })
  await api('learner', 'catalog.favorite', { course: item.course, favorite: 'true' })
  await api('manager', 'announcement.send', { audience: `team:${ids.team}`, title: 'USER ANNOUNCEMENT', body: 'USER MESSAGE: My learning remains authored English.' })
  await api('learner', 'feedback.send', { assignment: item.assignment, lesson: item.lesson, kind: 'feedback', body: 'USER FEEDBACK: Keep these words.' })
  const asked = await api('learner', 'discussion.ask', { course: item.course, lesson: item.lesson, kind: 'question', title: 'USER DISCUSSION', body: 'USER QUESTION: What should I check?' })
  const answer = await api('reviewer', 'discussion.reply', { thread: asked.id, body: 'USER ANSWER: Check the tools.' })
  await api('reviewer', 'discussion.resolve', { thread: asked.id, answer: answer.post })
  await api('owner', 'recognition.points', { lessonPoints: 5, coursePoints: 20 })
  await api('owner', 'recognition.group', { group: ids.team, levels: 'on', levelPoints: 20, leaderboard: 'on' })
  await api('learner', 'recognition.visibility', { visible: 'yes' })
  const skill = (await api('owner', 'skill.create', { name: 'USER SKILL', description: 'USER SKILL DESCRIPTION' })).id
  await api('reviewer', 'skill.review', { skill })
  await api('owner', 'skill.course', { course: item.course, skills: [skill] })
  await api('learner', 'skill.goals', { skills: [skill] })
  const external = await api('owner', 'external.requirement', { name: 'USER CERTIFICATE REQUIREMENT', teams: [ids.team], reviewer: 'manager', reminderDays: 30, expires: 'yes' })
  await api('learner', 'external.upload', { requirement: external.id, issuer: 'USER ISSUER', number: 'synthetic-beam-1', issuedOn: '2026-01-01', expiresOn: '2030-01-01', file: file('synthetic-beam-1.pdf', '%PDF-1.4\nUSER CERTIFICATE') })
  const source = await api('author', 'source.create', { title: 'USER POLICY', licence: 'owned', licenceEvidence: 'Employer owns procedure', provenance: 'Employer procedure', reviewer: ids.reviewer, file: file('synthetic-beam-1.txt', 'USER POLICY TEXT') })
  const acknowledgment = (await api('owner', 'acknowledgment.request', { source: source.id, kind: 'signature', learners: [ids.learner] })).created[0]
  await h.raw(`/app/acknowledgments/${acknowledgment}/document`, { cookie: cookies.learner })
  const session = (await api('owner', 'session.schedule', { course: item.course, title: 'USER SESSION', format: 'classroom', location: 'USER ROOM', date: '2030-12-10', time: '08:00', minutes: 60, timezone: 'America/Chicago' })).id
  await api('learner', 'session.register', { session })
  const practiceProposal = await api('author', 'agent.propose', { kind: 'scenario', title: 'USER PRACTICE', reasons: ['Practice reviewed procedure'], payload: { course: item.course, courseRevision: (await api('learner', `assignments/${item.assignment}`)).assignment.revision, title: 'USER PRACTICE', rubric: 'Keep tools clean.', steps: [{ id: 'tools', situation: 'USER SCENARIO', choices: [{ label: 'USER CHOICE', feedback: 'USER FEEDBACK', next: null, sources: [] }, { label: 'USER OTHER CHOICE', feedback: 'USER OTHER FEEDBACK', next: null, sources: [] }] }] } })
  const practice = (await api('reviewer', 'agent.decide', { proposal: practiceProposal.id, decision: 'approve', sha256: practiceProposal.sha256 })).result.scenario
  const questionsProposal = await api('owner', 'agent.propose', { kind: 'question_plan', title: 'USER QUESTIONS', reasons: ['Understand the work'], payload: { title: 'USER QUESTIONS', purpose: 'USER PURPOSE', questions: ['USER OPTIONAL QUESTION'], participants: [ids.learner, ids.assessor, ids.manager], closesOn: '2031-01-01' } })
  const questions = (await api('owner', 'agent.decide', { proposal: questionsProposal.id, decision: 'approve', sha256: questionsProposal.sha256 })).result.plan
  const practical = await f.course('USER PRACTICAL COURSE', true), practicalAssignment = await f.assign(practical)
  await f.lessons(practicalAssignment)
  await api('learner', 'blocker.report', { assignment: practicalAssignment, kind: 'access', note: 'USER BLOCKER' })
  const future = await f.course('USER FUTURE COURSE'), futureAssignment = await f.assign(future)
  await api('owner', 'assignment.window', { assignment: futureAssignment, kind: 'dates', openDate: '2030-01-01', closeDate: '2031-12-31' })
  const timed = await api('author', 'course.create', { title: 'USER TIMED COURSE', reviewer: ids.reviewer })
  let version = (await api('author', 'course.lesson', { course: timed.id, draftVersion: timed.draftVersion, title: 'USER TIMED LESSON', body: 'USER TIMED TEXT', sources: [] })).draftVersion
  for (const question of [
    { kind: 'text', prompt: 'USER WRITTEN QUESTION', guidance: 'USER GUIDANCE', points: 2 },
    { kind: 'blank', prompt: 'USER BLANK QUESTION', answers: 'clean' },
    { kind: 'order', prompt: 'USER ORDER QUESTION', items: 'Wash\nDry' },
    { kind: 'match', prompt: 'USER MATCH QUESTION', pairs: 'Clean = Tools\nDry = Hands' },
  ]) version = (await api('author', 'course.question', { course: timed.id, draftVersion: version, ...question })).draftVersion
  version = (await api('author', 'course.assessment', { course: timed.id, draftVersion: version, passPercent: 80, maxAttempts: 3, timeLimitMinutes: 30, assessor: ids.assessor })).draftVersion
  version = (await api('author', 'course.survey', { course: timed.id, draftVersion: version, survey: 'rating: USER SURVEY QUESTION' })).draftVersion
  await f.publish((await api('author', 'course.submit', { course: timed.id, draftVersion: version })).id)
  const timedAssignment = await f.assign(timed)
  await f.lessons(timedAssignment)
  const start = await (await h.raw(`/app/learn/${timedAssignment}/quiz`, { cookie: cookies.learner })).text()
  assert.ok(start.includes('Comenzar el cuestionario con límite de tiempo') && start.includes('Guarda tus respuestas'))
  const pages = [
    ['catalog', '/app/catalog', 'Catálogo de cursos'], ['sessions', '/app/sessions', 'Mi agenda'],
    ['skills', '/app/skills', 'Mis habilidades y sugerencias'], ['my-skills', `/app/skills/${ids.learner}`, 'Mis objetivos'],
    ['recognition', '/app/recognition', 'Mi reconocimiento'], ['external', '/app/external', 'Subir un certificado'],
    ['record', `/app/records/${ids.learner}`, 'Asignaciones'], ['transcript', `/app/records/${ids.learner}/transcript`, 'Descargar CSV'],
    ['acknowledgment', `/app/acknowledgments/${acknowledgment}`, 'Escribe tu nombre completo'],
    ['discussions', `/app/discussions/${item.course}`, 'Haz una pregunta'], ['practice', `/app/practice/${practice}`, 'Solo es práctica'],
    ['questions', `/app/questions/${questions}`, 'Prefiero no responder'], ['practical', `/app/learn/${practicalAssignment}/practical`, 'Enviar para evaluación'],
    ['access-window', `/app/learn/${futureAssignment}`, 'Este curso abre el'], ['blocker', `/app/learn/${practicalAssignment}`, 'Impedimento:'], ['survey', `/app/learn/${timedAssignment}`, 'Enviar encuesta'],
  ]
  return { pages, timed: timedAssignment }
}
