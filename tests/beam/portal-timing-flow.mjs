import assert from 'node:assert/strict'
import { portalQuizCourse } from './regression-portals.mjs'

export async function portalTimingFlow(f, portal, foreignPortal) {
  const invitation = await f.api('owner', 'portal.invite', { portal: portal.id, email: 'synthetic-beam-30@example.test', name: 'Timed partner learner', sendInvitation: true })
  const cookie = await f.h.signIn('synthetic-beam-30@example.test', { requested: true })
  const call = (door, body, status = 200, as = cookie) => f.h.api(`portal/${portal.id}/${door}`, as, body, status)
  await call('claim', { identity: invitation.id })
  await call('consent', { accept: true, noticeVersion: (await call('consent')).noticeVersion })
  const course = await portalQuizCourse(f, 'Timed partner station assessment', 'timed')
  await f.api('owner', 'portal.share', { portal: portal.id, revision: course.revision, confirm: true })
  const enrollment = await call('enroll', { identity: invitation.id, revision: course.revision }, 200, f.cookies.owner)
  const door = `assessment?enrollment=${enrollment.id}`
  const start = { enrollment: enrollment.id, number: 1, operation: 'start' }
  await call('assessment', start, 409)
  const study = await call(`learning?enrollment=${enrollment.id}`)
  await call('learning', { enrollment: enrollment.id, lesson: study.lessons[0].id })
  const ready = await call(door)
  assert.deepEqual([ready.available, ready.timeLimitMinutes, ready.questions, ready.session], [true, 10, [], null])
  await call('assessment', { enrollment: enrollment.id, number: 1, operation: 'submit', version: 0 }, 409)
  const starts = await Promise.all([call('assessment', start), call('assessment', start)])
  assert.deepEqual(starts[0], starts[1], 'Concurrent start keeps one original deadline')
  const running = starts[0]
  assert.deepEqual([running.attempts.length, running.session.number, running.session.version, running.session.deadline - running.session.startedAt], [0, 1, 0, 600000])
  assert.deepEqual(running.questions.map(row => row.kind), ['choice', 'blank', 'order', 'match'])
  const [choice, blank, order, match] = running.questions
  const fields = { enrollment: enrollment.id, number: 1, version: 0, operation: 'save', [`q_${choice.id}`]: ['0'], [`q_${blank.id}_0`]: 'synthetic-beam-14' }
  const saved = await call('assessment', fields)
  assert.deepEqual([saved.session.deadline, saved.session.version, saved.attempts.length], [running.session.deadline, 1, 0])
  assert.deepEqual(saved.session.answers, { [choice.id]: [0], [blank.id]: ['synthetic-beam-14'], [order.id]: [-1, -1], [match.id]: [-1, -1] })
  await call('assessment', fields, 409)
  assert.deepEqual((await call(door)).session, saved.session, 'A page read resumes saved answers without extending time')
  await call(door, undefined, 404, f.cookies.owner)
  await f.h.api(`portal/${foreignPortal.id}/${door}`, cookie, undefined, 404)
  await call('consent', { withdraw: true })
  await call(door, undefined, 403)
  await call('assessment', { ...fields, version: 1 }, 403)
  await call('consent', { accept: true, noticeVersion: (await call('consent')).noticeVersion })
  assert.deepEqual((await call(door)).session, saved.session, 'Consent renewal never resets a running deadline')
  await f.h.setClock(running.session.deadline)
  const late = { ...fields, operation: 'submit', version: 1, [`q_${order.id}_0`]: '0', [`q_${order.id}_1`]: '1', [`q_${match.id}_0`]: '0', [`q_${match.id}_1`]: '1' }
  await call('assessment', late, 409)
  const expired = await call(door)
  assert.deepEqual([expired.session, expired.attemptsLeft, expired.nextNumber, expired.passed], [null, 1, 2, false])
  assert.deepEqual(expired.attempts.map(row => [row.number, row.score, row.maxScore, row.percent, row.passed]), [[1, 3, 5, 60, 0]])
  const receipt = await call(`assessment.json?enrollment=${enrollment.id}`)
  assert.deepEqual(receipt.attempts[0].timing, { startedAt: running.session.startedAt, deadline: running.session.deadline, closedAt: running.session.deadline, closeReason: 'expired' })
  assert.deepEqual(receipt.attempts[0].responses.map(row => row.selected), [[0], ['synthetic-beam-14'], [-1, -1], [-1, -1]])
  await call('completion', { enrollment: enrollment.id }, 409)
  const second = await call('assessment', { ...start, number: 2 })
  assert.equal(second.session.startedAt, running.session.deadline)
  const answers = { ...late, number: 2, version: 0 }
  const passed = await call('assessment', answers)
  assert.deepEqual([passed.session, passed.passed, passed.attemptsLeft], [null, true, 0])
  assert.deepEqual(passed.attempts.map(row => [row.number, row.percent, row.passed]), [[1, 60, 0], [2, 100, 1]])
  assert.deepEqual(passed.attempts[1].timing, { startedAt: second.session.startedAt, deadline: second.session.deadline, closedAt: second.session.startedAt, closeReason: 'submitted' })
  assert.deepEqual(await call('assessment', answers), passed, 'Response replay creates no extra attempt')
  await call('assessment', { ...start, number: 3 }, 409)
  const completion = await call('completion', { enrollment: enrollment.id })
  assert.equal(completion.completion.attempt, passed.attempts[1].id)
  assert.equal(completion.completion.revision, course.revision)
  const exported = (await (await f.h.raw('/app/data-export.json', { cookie: f.cookies.owner })).json()).records
  assert.deepEqual(exported.beam_portal_quiz_sessions.rows.filter(row => row.enrollment_id === enrollment.id).map(row => [row.number, row.close_reason, row.attempt_id]), [[1, 'expired', passed.attempts[0].id], [2, 'submitted', passed.attempts[1].id]])
  const audit = await f.api('owner', 'audit')
  assert.deepEqual(audit.events.filter(row => row.action === 'portal.quiz.submit' && row.detail.enrollment === enrollment.id).map(row => [row.detail.number, row.detail.closeReason, row.detail.outcome]).sort((a,b) => a[0]-b[0]), [[1, 'expired', 'failed'], [2, 'submitted', 'passed']])
  assert.ok(!JSON.stringify(audit.events.filter(row => row.detail.enrollment === enrollment.id)).includes('synthetic-beam-14'))
  return { portal, foreignPortal, cookie, course, enrollment, invitation }
}
