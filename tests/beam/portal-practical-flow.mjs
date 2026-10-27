import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPortability, readArchive } from '@runeditrun/rer/modules/portability'
import { exportArchive, fileRecords } from '@runeditrun/rer/modules/portability/files'
import policy from '../../scripts/installer/portability-policy.mjs'
import { portalNotice } from './regression-portals.mjs'
import { file } from './harness.mjs'

// These fixtures use ordinary authoring and human publication, never direct evidence writes.
export async function portalPracticalCourse(f, title, assessor = f.ids.owner) {
  const course = await f.api('author', 'course.create', { title, reviewer: f.ids.reviewer })
  let edited = await f.api('author', 'course.lesson', { course: course.id, draftVersion: course.draftVersion, title: 'Practical procedure', body: 'Inspect the station before work.', sources: [] })
  edited = await f.api('author', 'course.question', { course: course.id, draftVersion: edited.draftVersion, prompt: 'What comes before work?', choices: 'Inspect the station\nIgnore the station', correct: '1' })
  edited = await f.api('author', 'course.assessment', { course: course.id, draftVersion: edited.draftVersion, passPercent: 100, maxAttempts: 2, practicalInstructions: 'Demonstrate the station inspection and describe the result.', assessor })
  const revision = (await f.api('author', 'course.submit', { course: course.id, draftVersion: edited.draftVersion })).id
  await f.publish(revision)
  return { id: course.id, revision, draftVersion: edited.draftVersion }
}

export async function portalPracticalFlow(f) {
  const { api, h, cookies, ids } = f
  const portal = await api('owner', 'portal.create', { kind: 'customer', name: 'Practical customer training', consentText: 'Separate practical training consent', confirm: true })
  const foreignPortal = await api('owner', 'portal.create', { kind: 'partner', name: 'Separate practical partner', consentText: 'Independent partner consent', confirm: true })
  for (const p of [portal, foreignPortal]) await api('owner', 'portal.notice', { portal: p.id, version: 0, ...portalNotice })
  const course = await portalPracticalCourse(f, 'Practical customer inspection')
  const wrongAssessor = await portalPracticalCourse(f, 'Private named native assessor', ids.assessor)
  for (const c of [course, wrongAssessor]) await api('owner', 'portal.share', { portal: portal.id, revision: c.revision, confirm: true })
  const invite = async (p, email, name) => {
    const identity = await api('owner', 'portal.invite', { portal: p.id, email, name, sendInvitation: true })
    const cookie = await h.signIn(email, { requested: true })
    await h.api(`portal/${p.id}/claim`, cookie, { identity: identity.id })
    await h.api(`portal/${p.id}/consent`, cookie, { accept: true, noticeVersion: (await h.api(`portal/${p.id}/consent`, cookie)).noticeVersion })
    return { identity, cookie }
  }
  const learner = await invite(portal, 'synthetic-beam-40@example.test', 'Practical customer learner')
  const administrator = await invite(portal, 'synthetic-beam-41@example.test', 'Practical portal administrator')
  const foreign = await invite(foreignPortal, 'synthetic-beam-42@example.test', 'Separate practical learner')
  await api('owner', 'portal.admin', { portal: portal.id, identity: administrator.identity.id })
  const call = (door, body, status = 200, as = learner.cookie) => h.api(`portal/${portal.id}/${door}`, as, body, status)
  const enroll = c => call('enroll', { identity: learner.identity.id, revision: c.revision }, 200, cookies.owner)
  const enrollment = await enroll(course), wrongEnrollment = await enroll(wrongAssessor)
  const door = `practical?enrollment=${enrollment.id}`, reviewDoor = `practical-review?enrollment=${enrollment.id}`
  const first = { enrollment: enrollment.id, submission: randomUUID(), evidence: 'synthetic-beam-43: I inspected the station; the guard needed correction.' }
  await call('practical', first, 409)
  const study = await call(`learning?enrollment=${enrollment.id}`)
  await call('learning', { enrollment: enrollment.id, lesson: study.lessons[0].id })
  const ready = await call(door)
  assert.equal(ready.available && ready.lessonsComplete, true)
  assert.equal(ready.attachments, false)
  await call('practical', { ...first, file: file('synthetic-beam-44.txt', 'Inspection attachment') }, 409)
  const concurrent = await Promise.all([call('practical', first), call('practical', first)])
  assert.deepEqual(concurrent[0].submissions, concurrent[1].submissions)
  const submitted = concurrent[0].submissions[0]
  assert.deepEqual(concurrent[0].submissions.map(row => [row.number, row.evidence, row.state]), [[1, first.evidence, 'awaiting_review']])
  assert.equal((await call('practical', first)).submissions.length, 1)
  await call('practical', { ...first, evidence: 'A changed replay must be refused.' }, 409)
  await call('practical', { ...first, submission: randomUUID() }, 409)
  const laterDraft = await api('author', 'course.assessment', { course: course.id, draftVersion: course.draftVersion, passPercent: 100, maxAttempts: 2, practicalInstructions: 'A later revision has a different practical task.', assessor: ids.assessor })
  const laterRevision = (await api('author', 'course.submit', { course: course.id, draftVersion: laterDraft.draftVersion })).id
  await f.publish(laterRevision)
  const original = await call(door)
  assert.equal(original.revision, course.revision)
  assert.equal(original.assessmentRevision, ready.assessmentRevision)
  assert.equal(original.instructions, ready.instructions, 'Later publication cannot change the enrolled practical or its named reviewer')
  await call(door, undefined, 404, cookies.owner)
  await call(door, undefined, 404, administrator.cookie)
  await call(door, undefined, 404, foreign.cookie)
  await h.api(`portal/${foreignPortal.id}/${door}`, learner.cookie, undefined, 404)
  await h.api(`portal/${foreignPortal.id}/${reviewDoor}`, cookies.owner, undefined, 404)
  for (const cookie of [administrator.cookie, cookies.assessor]) {
    const response = await h.raw(`/api/beam/portal/${portal.id}/${reviewDoor}`, { cookie })
    assert.ok([403, 404].includes(response.status), 'Portal administrators and ordinary native assessors acquire no private review access')
    assert.ok(!(await response.text()).includes(first.evidence))
  }
  await call(`practical-review?enrollment=${wrongEnrollment.id}`, undefined, 403, cookies.owner)
  const nativeStudy = await call(`learning?enrollment=${wrongEnrollment.id}`)
  await call('learning', { enrollment: wrongEnrollment.id, lesson: nativeStudy.lessons[0].id })
  const unavailable = await call(`practical?enrollment=${wrongEnrollment.id}`)
  assert.equal(unavailable.available, false)
  await call('practical', { enrollment: wrongEnrollment.id, submission: randomUUID(), evidence: 'synthetic-beam-45: A nonowner assessor needs a separately reviewed delegation.' }, 409)
  assert.equal((await call(`practical?enrollment=${wrongEnrollment.id}`)).submissions.length, 0, 'Unsupported reviewer authority refuses collection of private evidence')
  await call('practical-review', { enrollment: wrongEnrollment.id, submission: submitted.id, decision: 'accepted', note: 'Owner status does not override the named assessor.' }, 403, cookies.owner)
  const assessment = await call(`assessment?enrollment=${enrollment.id}`)
  const passed = await call('assessment', { enrollment: enrollment.id, number: 1, [`q_${assessment.questions[0].id}`]: ['0'] })
  assert.equal(passed.passed, true)
  await call('completion', { enrollment: enrollment.id }, 409)
  const ownerReview = await call(reviewDoor, undefined, 200, cookies.owner)
  assert.equal(ownerReview.submissions[0].evidence, first.evidence)
  assert.equal(ownerReview.learner, 'Practical customer learner')
  const rejection = { enrollment: enrollment.id, submission: submitted.id, decision: 'rejected', note: 'Correct the guard and describe the new inspection.' }
  await call('consent', { withdraw: true })
  await call(door, undefined, 403)
  await call('practical', first, 403)
  await call(reviewDoor, undefined, 404, cookies.owner)
  await call('practical-review', rejection, 404, cookies.owner)
  await call('consent', { accept: true, noticeVersion: (await call('consent')).noticeVersion })
  await api('owner', 'portal.share', { portal: portal.id, revision: course.revision, confirm: true, revoke: true })
  await call(door, undefined, 404)
  await call('practical-review', rejection, 404, cookies.owner)
  await api('owner', 'portal.share', { portal: portal.id, revision: course.revision, confirm: true })
  const reviewRace = await Promise.all([h.raw(`/api/beam/portal/${portal.id}/practical-review`, { cookie: cookies.owner, body: rejection }), h.raw(`/api/beam/portal/${portal.id}/practical-review`, { cookie: cookies.owner, body: rejection })])
  assert.deepEqual(reviewRace.map(response => response.status).sort(), [200, 409], 'A concurrent decision is recorded exactly once')
  for (const response of reviewRace) await response.arrayBuffer()
  const rejected = await call(door)
  assert.equal(rejected.submissions[0].state, 'rejected')
  await call('completion', { enrollment: enrollment.id }, 409)
  const second = { enrollment: enrollment.id, submission: randomUUID(), evidence: 'synthetic-beam-46: The guard was corrected; I reinspected and recorded a safe station.' }
  const resubmitted = await call('practical', second)
  assert.deepEqual(resubmitted.submissions.map(row => [row.number, row.state]), [[1, 'rejected'], [2, 'awaiting_review']])
  const accepted = await call('practical-review', { enrollment: enrollment.id, submission: resubmitted.submissions[1].id, decision: 'accepted', note: 'Inspection evidence accepted against this revision.' }, 200, cookies.owner)
  assert.deepEqual(accepted.submissions.map(row => row.state), ['rejected', 'accepted'])
  assert.deepEqual((await call('practical', second)).submissions, accepted.submissions)
  await call('practical', { ...second, submission: randomUUID() }, 409)
  const qualified = await call(`completion?enrollment=${enrollment.id}`)
  assert.equal(qualified.qualified, true)
  assert.equal(qualified.completion, null, 'Accepting evidence never records completion automatically')
  const earned = await call('completion', { enrollment: enrollment.id })
  assert.equal(earned.completion.assessmentRevision, accepted.assessmentRevision)
  assert.equal(earned.completion.revision, course.revision)
  const retained = accepted.submissions
  await call('consent', { withdraw: true })
  await call(reviewDoor, undefined, 404, cookies.owner)
  const exported = (await (await h.raw('/app/data-export.json', { cookie: cookies.owner })).json()).records
  assert.deepEqual(exported.beam_portal_practical_submissions.rows.filter(row => row.enrollment_id === enrollment.id).sort((a, b) => a.number - b.number).map(row => [row.id, row.assessment_revision_id, row.evidence_text]), retained.map(row => [row.id, accepted.assessmentRevision, row.evidence]))
  assert.deepEqual(exported.beam_portal_practical_decisions.rows.filter(row => retained.some(submission => submission.id === row.submission_id)).sort((a, b) => a.decided_at - b.decided_at).map(row => [row.assessor_id, row.decision]), [[ids.owner, 'rejected'], [ids.owner, 'accepted']])
  const scratch = await mkdtemp(join(tmpdir(), 'beam-portal-practical-'))
  try {
    const archive = join(scratch, 'practical.rer')
    await exportArchive(await createPortability({ db: h.db, buckets: { files: h.files }, policy }), archive)
    const rows = []
    for await (const record of fileRecords(archive, readArchive)) if (record.kind === 'part') rows.push(...record.items.filter(item => item.kind === 'row'))
    assert.deepEqual(rows.filter(item => item.table === 'beam_portal_practical_submissions' && item.row.enrollment_id === enrollment.id).map(item => item.row.id).sort(), retained.map(row => row.id).sort())
    assert.deepEqual(rows.filter(item => item.table === 'beam_portal_practical_decisions' && retained.some(row => row.id === item.row.submission_id)).map(item => item.row.id).sort(), retained.map(row => row.decision.id).sort())
    assert.equal(rows.find(item => item.table === 'beam_portal_identities' && item.row.id === learner.identity.id).row.operator_id, null, 'Retained practical evidence carries no restored learner admission')
  } finally { await rm(scratch, { recursive: true, force: true }) }
  await call('consent', { accept: true, noticeVersion: (await call('consent')).noticeVersion })
  assert.deepEqual((await call(door)).submissions, retained)
  const audit = (await api('owner', 'audit')).events.filter(row => row.detail.enrollment === enrollment.id && row.action.startsWith('portal.practical.'))
  assert.equal(audit.filter(row => row.action === 'portal.practical.submit').length, 2)
  assert.equal(audit.filter(row => row.action === 'portal.practical.decide').length, 2)
  assert.ok(!JSON.stringify(audit).includes(first.evidence) && !JSON.stringify(audit).includes(rejection.note), 'Private evidence and review notes stay out of audit detail')
  return { portal, foreignPortal, course, enrollment, cookie: learner.cookie }
}
