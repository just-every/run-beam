import assert from 'node:assert/strict'
import { file } from './harness.mjs'

const notice = {
  operatorName: 'Synthetic training operator', purpose: 'Portal progress reporting',
  collectedData: 'Verified identity, lesson reads, assessment attempts and earned certificates.',
  reportingRecipients: 'The current portal administrators and human owner.',
  providers: 'Installation hosting and authentication services.',
  retentionAndHolds: 'Withdrawal restricts ordinary access to retained learning records.',
  certificateEffects: 'Earned evidence is retained; downloaded copies cannot be recalled.',
  withdrawal: 'Withdraw independently through the consent control. Renewal does not restore administration.',
}

// Called inside enterprisePortalsCheck after its earlier fixtures and assertions.
export async function portalReportFlow(f) {
  const { api, h, cookies, ids } = f
  const create = async (kind, name) => {
    const portal = await api('owner', 'portal.create', { kind, name, consentText: 'Independent reporting consent', confirm: true })
    await api('owner', 'portal.notice', { portal: portal.id, version: 0, ...notice })
    return portal
  }
  const portal = await create('customer', 'Portal learning report'), foreignPortal = await create('partner', 'Independent report')
  const call = (p, door, cookie, body, status = 200) => h.api(`portal/${p.id}/${door}`, cookie, body, status)
  const admit = async (p, email, name, existingCookie) => {
    const identity = await api('owner', 'portal.invite', { portal: p.id, email, name, sendInvitation: true })
    const cookie = existingCookie ?? await h.signIn(email, { requested: true })
    await call(p, 'claim', cookie, { identity: identity.id })
    await call(p, 'consent', cookie, { accept: true, noticeVersion: 1 })
    return { ...identity, cookie }
  }
  const adminName = '=SUM(1,2) "<synthetic-beam-90>"\nNext row'
  const learnerName = 'Synthetic report learner'
  const admin = await admit(portal, 'synthetic-beam-90@example.test', adminName)
  const learner = await admit(portal, 'synthetic-beam-91@example.test', learnerName)
  const foreign = await admit(foreignPortal, 'synthetic-beam-91@example.test', 'Independent identity', learner.cookie)
  await api('owner', 'portal.admin', { portal: portal.id, identity: admin.id })
  await api('owner', 'portal.admin', { portal: foreignPortal.id, identity: foreign.id })

  const provenance = 'synthetic-beam-92 private source provenance'
  const source = await api('author', 'source.create', { title: 'Reporting evidence source', licence: 'owned',
    licenceEvidence: 'Employer-owned training', reviewer: ids.reviewer, provenance,
    file: file('synthetic-beam-92.txt', 'Private preparation material.') })
  const title = '+SUM(2,3) "synthetic-beam-93"\nApproved procedure'
  const course = await api('author', 'course.create', { title, reviewer: ids.reviewer })
  let version = course.draftVersion
  const edit = async (action, fields) => {
    const changed = await api('author', action, { course: course.id, draftVersion: version, ...fields })
    version = changed.draftVersion
    return changed
  }
  await edit('course.lesson', { title: 'Prepare the station', body: 'Inspect the station.', sources: [source.versionId] })
  await edit('course.lesson', { title: 'Record the check', body: 'Record the station check.', sources: [] })
  const privateAnswer = 'synthetic-beam-94'
  await edit('course.question', { kind: 'blank', prompt: 'Enter the station code.', answers: privateAnswer, ignoreCase: true })
  await edit('course.assessment', { passPercent: 100, maxAttempts: 2, feedback: 'attempt' })
  const revision = (await api('author', 'course.submit', { course: course.id, draftVersion: version })).id
  await f.publish(revision)
  for (const p of [portal, foreignPortal]) await api('owner', 'portal.share', { portal: p.id, revision, confirm: true })
  const enroll = (p, identity) => call(p, 'enroll', cookies.owner, { identity, revision })
  const enrollment = await enroll(portal, learner.id), plannedEnrollment = await enroll(portal, admin.id)
  const independentEnrollment = await enroll(foreignPortal, foreign.id)
  const report = (cookie = admin.cookie, p = portal) => call(p, 'report', cookie)
  const learnerRow = async () => (await report()).enrollments.find(row => row.id === enrollment.id)
  const planned = await learnerRow()
  assert.deepEqual([planned.identity, planned.name, planned.revision, planned.courseTitle, planned.status], [learner.id, learnerName, revision, title, 'planned'])
  assert.deepEqual([planned.lessonsRead, planned.totalLessons, planned.attempts, planned.assessmentPassed, planned.completion, planned.completedAt, planned.certificateNumber], [0, 2, 0, null, null, null, null])
  const study = await call(portal, `learning?enrollment=${enrollment.id}`, learner.cookie)
  await call(portal, 'learning', learner.cookie, { enrollment: enrollment.id, lesson: study.lessons[0].id })
  assert.deepEqual([(await learnerRow()).status, (await learnerRow()).lessonsRead], ['in_progress', 1])
  await call(portal, 'completion', learner.cookie, { enrollment: enrollment.id }, 409)
  await call(portal, 'learning', learner.cookie, { enrollment: enrollment.id, lesson: study.lessons[1].id })
  const ready = await call(portal, `assessment?enrollment=${enrollment.id}`, learner.cookie)
  await call(portal, 'assessment', learner.cookie, { enrollment: enrollment.id, number: 1 })
  assert.deepEqual([(await learnerRow()).attempts, (await learnerRow()).assessmentPassed, (await learnerRow()).status], [1, 0, 'in_progress'])
  await call(portal, 'assessment', learner.cookie, { enrollment: enrollment.id, number: 2, [`q_${ready.questions[0].id}_0`]: privateAnswer })
  const passed = await learnerRow()
  assert.deepEqual([passed.lessonsRead, passed.attempts, passed.assessmentPassed, passed.status, passed.completion, passed.certificateNumber], [2, 2, 1, 'in_progress', null, null], 'Passing alone does not earn completion')
  const completion = (await call(portal, 'completion', learner.cookie, { enrollment: enrollment.id })).completion
  const completed = await learnerRow()
  assert.deepEqual([completed.status, completed.completion, completed.completedAt, completed.certificateNumber], ['completed', completion.id, completion.completedAt, completion.number])
  assert.deepEqual((await report(cookies.owner)).enrollments, (await report()).enrollments, 'Authorized owner and portal administrator see the same scoped evidence')
  assert.deepEqual((await report(learner.cookie, foreignPortal)).enrollments.map(row => [row.id, row.status, row.lessonsRead, row.attempts, row.certificateNumber]), [[independentEnrollment.id, 'planned', 0, 0, null]])
  assert.equal((await report()).enrollments.find(row => row.id === plannedEnrollment.id).status, 'planned')

  const csvPath = `/api/beam/portal/${portal.id}/report.csv`, pagePath = `/app/portal/${portal.id}/report`
  const csvResponse = await h.raw(csvPath, { cookie: admin.cookie })
  assert.equal(csvResponse.status, 200)
  assert.equal(csvResponse.headers.get('cache-control'), 'no-store')
  assert.match(csvResponse.headers.get('content-type'), /^text\/csv/)
  const csv = await csvResponse.text()
  for (const value of [adminName, title]) assert.ok(csv.includes(`"'${value.replaceAll('"', '""')}"`), 'Formula-prefixed user text is neutralized while commas, quotes and newlines remain in its quoted cell')
  assert.ok(csv.includes(`"${completion.number}"`) && csv.includes(`"${new Date(completion.completedAt).toISOString()}"`))
  assert.ok(csv.includes('"completed"') && csv.includes('"planned"'))
  const htmlResponse = await h.raw(pagePath, { cookie: admin.cookie })
  assert.equal(htmlResponse.status, 200)
  const html = await htmlResponse.text()
  assert.ok(html.includes(completion.number) && html.includes('Lessons read: 2 of 2') && html.includes('Assessment attempts: 2'))
  assert.ok(html.includes('&lt;synthetic-beam-90&gt;') && !html.includes('<synthetic-beam-90>'), 'Report text is HTML escaped')
  for (const text of [JSON.stringify(await report()), csv, html]) {
    for (const forbidden of [privateAnswer, provenance, source.versionId, independentEnrollment.id, foreign.id, 'responses_json', 'answers_json']) assert.ok(!text.includes(forbidden), `Report excludes ${forbidden}`)
  }
  for (const path of [`/api/beam/portal/${portal.id}/report`, csvPath, pagePath]) {
    for (const [cookie, status] of [[learner.cookie, 403], [cookies.learner, 404], [cookies.manager, 404], [cookies.author, 404]]) assert.equal((await h.raw(path, { cookie })).status, status)
    assert.equal((await h.raw(path, { cookie: `${cookies.owner}; beam_view=synthetic-beam-95` })).status, 403)
  }
  for (const door of ['report', 'report.csv']) assert.equal((await h.raw(`/api/beam/portal/${foreignPortal.id}/${door}`, { cookie: admin.cookie })).status, 404)
  const head = await h.raw(csvPath, { cookie: admin.cookie, method: 'HEAD' })
  assert.deepEqual([head.status, await head.text()], [200, ''])

  const draft = await api('author', `courses/${course.id}`)
  const changed = await api('author', 'course.details', { course: course.id, draftVersion: draft.draftVersion, title: 'Later approved procedure', summary: '' })
  const laterRevision = (await api('author', 'course.submit', { course: course.id, draftVersion: changed.draftVersion })).id
  await f.publish(laterRevision)
  assert.deepEqual(await learnerRow(), completed, 'A new approved revision never rewrites earned report evidence')
  await api('owner', 'portal.share', { portal: portal.id, revision: laterRevision, confirm: true })
  const progressEnrollment = await call(portal, 'enroll', cookies.owner, { identity: admin.id, revision: laterRevision })
  const laterStudy = await call(portal, `learning?enrollment=${progressEnrollment.id}`, admin.cookie)
  await call(portal, 'learning', admin.cookie, { enrollment: progressEnrollment.id, lesson: laterStudy.lessons[0].id })
  const progressing = (await report()).enrollments.find(row => row.id === progressEnrollment.id)
  assert.deepEqual([progressing.status, progressing.lessonsRead, progressing.totalLessons, progressing.certificateNumber], ['in_progress', 1, 2, null])
  await call(portal, 'consent', learner.cookie, { withdraw: true })
  assert.deepEqual((await report()).enrollments.map(row => row.id).sort(), [plannedEnrollment.id, progressEnrollment.id].sort())
  for (const path of [csvPath, pagePath]) {
    const text = await (await h.raw(path, { cookie: admin.cookie })).text()
    for (const value of [learner.id, learnerName, completion.number]) assert.ok(!text.includes(value), 'Ordinary reports hide withdrawn identities and retained evidence')
  }
  assert.deepEqual((await report(learner.cookie, foreignPortal)).enrollments.map(row => row.id), [independentEnrollment.id])
  await call(portal, 'consent', learner.cookie, { accept: true, noticeVersion: 1 })
  assert.deepEqual(await learnerRow(), completed, 'Renewal exposes the same immutable completion')
  await api('owner', 'portal.share', { portal: portal.id, revision, confirm: true, revoke: true })
  assert.deepEqual((await report()).enrollments.map(row => row.id), [progressEnrollment.id])
  await api('owner', 'portal.share', { portal: portal.id, revision: laterRevision, confirm: true, revoke: true })
  assert.deepEqual((await report()).enrollments, [])
  assert.ok(!(await (await h.raw(csvPath, { cookie: admin.cookie })).text()).includes(completion.number))
  await api('owner', 'portal.share', { portal: portal.id, revision, confirm: true })
  await api('owner', 'portal.share', { portal: portal.id, revision: laterRevision, confirm: true })
  await call(portal, 'consent', admin.cookie, { withdraw: true })
  for (const door of ['report', 'report.csv']) await call(portal, door, admin.cookie, undefined, 403)
  await call(portal, 'consent', admin.cookie, { accept: true, noticeVersion: 1 })
  for (const door of ['report', 'report.csv']) await call(portal, door, admin.cookie, undefined, 403)
  await api('owner', 'portal.admin', { portal: portal.id, identity: admin.id })
  assert.deepEqual(await learnerRow(), completed)
  return { portal, foreignPortal, admin, learner, enrollment, plannedEnrollment, progressEnrollment, completion, learnerName, adminName }
}
