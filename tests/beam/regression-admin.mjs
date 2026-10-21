import assert from 'node:assert/strict'

// ORG-002: the owner grants a learning administrator one business unit; they manage its courses, enrollment and
// reports through the HTML and JSON doors, are refused another unit, owner and provider authority, and lose every
// page, API call and download when a grant expires or is revoked.
export async function adminCheck(f) {
  const { api, h, cookies, ids, publish, course } = f
  const page = async (path, role) => { const response = await h.raw(path, { cookie: cookies[role] }); return { status: response.status, text: await response.text() } }
  ids.admin = (await api('owner', 'person.invite', { email: 'admin@example.test', name: 'Ada Admin', roles: ['learner'] })).id
  cookies.admin = await h.signIn('admin@example.test', { requested: true })
  const north = await f.team('North floor', [ids.learner]), south = await f.team('South floor', [ids.other])
  // Units and grants are the owner's: created and granted through the form door.
  for (const [name, team] of [['North region', north], ['South region', south]]) assert.equal((await h.submit('unit.create', cookies.owner, { name, teams: team }, '/app/people')).searchParams.get('error'), null)
  const unit = name => api('owner', 'units').then(view => view.units.find(row => row.name === name).id)
  const [northUnit, southUnit] = [await unit('North region'), await unit('South region')]
  assert.equal((await h.submit('admin.grant', cookies.owner, { member: ids.admin, unit: northUnit }, '/app/people')).searchParams.get('error'), null)
  const grant = (await api('owner', 'units')).grants.find(row => row.member === ids.admin && row.unit === northUnit)
  assert.deepEqual([grant.state, grant.expiresAt], ['active', null])
  assert.deepEqual((await api('admin', 'me')).adminUnits, [northUnit])

  // Catalog: a course in their unit is theirs to write; another unit's course is refused.
  const southCourse = await course('South forklift safety')
  await api('owner', 'course.unit', { course: southCourse.id, unit: southUnit })
  const created = await api('admin', 'course.create', { title: 'North induction', reviewer: ids.reviewer, unit: northUnit })
  assert.equal((await api('admin', 'course.create', { title: 'Elsewhere', reviewer: ids.reviewer, unit: southUnit }, 403)).error, 'outside_your_units')
  await api('admin', 'course.create', { title: 'Nowhere', reviewer: ids.reviewer }, 403)
  const lesson = await api('admin', 'course.lesson', { course: created.id, draftVersion: created.draftVersion, title: 'Welcome', body: 'Where to find the first-aid kit.', sources: [] })
  await publish((await api('admin', 'course.submit', { course: created.id, draftVersion: lesson.draftVersion })).id)
  const southDraft = (await api('author', `courses/${southCourse.id}`)).draftVersion
  assert.equal((await api('admin', 'course.lesson', { course: southCourse.id, draftVersion: southDraft, title: 'Mine now', body: 'x', sources: [] }, 403)).error, 'outside_your_units')
  await api('admin', `courses/${southCourse.id}`, undefined, 403)
  assert.deepEqual((await api('admin', 'courses')).map(row => row.id), [created.id])
  const courses = await page('/app/courses', 'admin')
  assert.ok(courses.status === 200 && courses.text.includes('North induction') && !courses.text.includes('South forklift safety'))
  assert.equal((await page(`/app/courses/${southCourse.id}`, 'admin')).status, 403)

  // Enrollment: their unit's people in their unit's courses only, through JSON and the form.
  const [mine] = (await api('admin', 'assignment.create', { course: created.id, learners: [ids.learner], dueDate: '2030-10-01' })).created
  assert.equal((await api('admin', 'assignment.create', { course: created.id, learners: [ids.other], dueDate: '2030-10-01' }, 403)).error, 'outside_your_units')
  await api('admin', 'assignment.create', { course: created.id, teams: [south], dueDate: '2030-10-01' }, 403)
  assert.equal((await h.submit('assignment.create', cookies.admin, { course: southCourse.id, learners: ids.learner, dueDate: '2030-10-01' }, '/app/people')).searchParams.get('error'), 'outside_your_units')
  const [theirs] = (await api('manager', 'assignment.create', { course: southCourse.id, learners: [ids.other], dueDate: '2030-10-01' })).created
  await api('admin', 'assignment.cancel', { assignment: theirs, reason: 'Not mine' }, 403)
  const people = await api('admin', 'people')
  assert.deepEqual([people.members.map(row => row.id), people.teams.map(row => row.id)], [[ids.learner], [north]])
  await api('admin', `records/${ids.learner}`)
  await api('admin', `records/${ids.other}`, undefined, 404)
  const peoplePage = await page('/app/people', 'admin')
  assert.ok(peoplePage.status === 200 && peoplePage.text.includes('Your administration') && peoplePage.text.includes('North region') && !peoplePage.text.includes('South region'))

  // Reports, page and download, hold only their unit's people; another unit's team is refused.
  const report = await api('admin', 'report')
  assert.ok(report.rows.some(row => row.assignment === mine) && report.rows.every(row => row.learner === ids.learner))
  assert.equal((await api('admin', `report?team=${south}`, undefined, 403)).error, 'outside_your_units')
  const csv = await page('/app/reports.csv', 'admin')
  assert.ok(csv.status === 200 && csv.text.includes('North induction') && !csv.text.includes('South forklift safety'))
  assert.equal((await page('/app/reports', 'admin')).status, 200)

  // Membership of their units' teams: they invite new learners into North and set North's members from people already
  // in their units; South, other roles, existing people and people outside their units are refused. The owner names
  // managers and sets course and path windows; the windows of enrollments the administrator created are theirs.
  const nia = (await api('admin', 'person.invite', { email: 'nia@example.test', name: 'Nia New', roles: ['learner'], teams: [north] })).id
  assert.equal((await api('admin', 'person.invite', { email: 'zed@example.test', name: 'Zed', roles: ['learner'], teams: [south] }, 403)).error, 'outside_your_units')
  assert.equal((await api('admin', 'person.invite', { email: 'zed@example.test', name: 'Zed', roles: ['author'], teams: [north] }, 403)).error, 'owner_required')
  assert.equal((await api('admin', 'person.invite', { email: 'other@example.test', name: 'Other', roles: ['learner'], teams: [north] }, 409)).error, 'already_member')
  assert.equal((await h.raw('/auth/invite', { cookie: cookies.admin, body: { email: 'zed@example.test', displayName: 'Zed' } })).status, 403)
  cookies.nia = await h.signIn('nia@example.test', { requested: true })
  assert.equal((await api('nia', 'me')).id, nia)
  const noor = (await api('admin', 'person.invite', { email: 'noor@example.test', name: 'Noor New', roles: ['learner'], teams: [north] })).id
  assert.deepEqual((await api('admin', 'people')).members.find(row => row.id === nia).teams, [north])
  // Removing someone from every team of their units hands them back to the owner: they cannot be drawn in again.
  assert.equal((await h.submit('team.members', cookies.admin, { team: north, members: [ids.learner, nia] }, '/app/people')).searchParams.get('error'), null)
  assert.equal((await api('admin', 'team.members', { team: north, members: [ids.learner, nia, noor] }, 403)).error, 'outside_your_units')
  assert.equal((await api('admin', 'team.members', { team: north, members: [ids.learner, nia, ids.other] }, 403)).error, 'outside_your_units')
  await api('admin', 'team.members', { team: north, members: [ids.learner, nia] })
  assert.equal((await api('admin', 'team.members', { team: south, members: [ids.other, nia] }, 403)).error, 'outside_your_units')
  assert.equal((await api('admin', 'team.managers', { team: north, members: [ids.admin] }, 403)).error, 'owner_required')
  assert.deepEqual((await api('admin', 'people')).members.map(row => row.id).sort(), [ids.learner, nia].sort())
  const membersPage = await page('/app/people', 'admin')
  assert.ok(membersPage.text.includes('Invite a learner') && membersPage.text.includes('Save members') && !membersPage.text.includes('Save managers'))
  await api('admin', 'access.rule', { scope: 'course', target: created.id, kind: 'after_enrolment', closeDays: 30 }, 403)
  const window = await api('admin', 'assignment.window', { assignment: mine, kind: 'after_enrolment', closeDays: 30 })
  assert.equal((await h.submit('access.extend', cookies.admin, { assignment: mine, days: '7', reason: 'Back from leave' }, `/app/learn/${mine}`)).searchParams.get('error'), null)
  assert.equal((await api('admin', `assignments/${mine}`)).access.closesAt, window.closesAt + 7 * 86400000)
  assert.ok((await page(`/app/learn/${mine}`, 'admin')).text.includes('Set this assignment’s window'))
  const [ownerMade] = (await api('owner', 'assignment.create', { course: southCourse.id, learners: [ids.learner], dueDate: '2030-10-01' })).created
  assert.equal((await api('admin', 'assignment.window', { assignment: ownerMade, kind: 'after_enrolment', closeDays: 30 }, 403)).error, 'not_your_enrollment')
  await api('owner', 'assignment.window', { assignment: ownerMade, kind: 'after_enrolment', closeDays: 30 })
  assert.equal((await api('admin', 'access.extend', { assignment: ownerMade, days: 7, reason: 'Not mine' }, 403)).error, 'not_your_enrollment')

  // Owner and provider authority stays with the owner: grants, people, settings, move-in, sign-in providers, credentials.
  assert.equal((await api('admin', 'admin.grant', { member: ids.admin, unit: southUnit }, 403)).error, 'owner_required')
  assert.equal((await h.submit('admin.grant', cookies.admin, { member: ids.admin, unit: southUnit }, '/app/people')).searchParams.get('error'), 'owner_required')
  await api('admin', 'person.invite', { email: 'x@example.test', name: 'X', roles: ['learner'] }, 403)
  await api('admin', 'business.configure', { name: 'Mine', timezone: 'UTC' }, 403)
  await api('admin', 'agent.issue', { expiresInSeconds: 600 }, 403)
  for (const path of ['/app/business', '/app/import', '/auth/providers', '/auth/settings/identity']) assert.equal((await page(path, 'admin')).status, 403, path)
  assert.equal((await page('/auth/providers', 'owner')).status, 200)

  // A grant with an end: South opens to them until that instant, then closes everywhere while North stays.
  const expiresAt = Date.now() + 2500
  await api('owner', 'admin.grant', { member: ids.admin, unit: southUnit, expiresAt: new Date(expiresAt).toISOString() })
  await api('admin', `courses/${southCourse.id}`)
  await new Promise(resolve => setTimeout(resolve, expiresAt - Date.now() + 300))
  await api('admin', `courses/${southCourse.id}`, undefined, 403)
  assert.deepEqual((await api('admin', 'me')).adminUnits, [northUnit])
  assert.equal((await api('owner', 'units')).grants.find(row => row.unit === southUnit).state, 'expired')

  // Revoking the active grant ends it on the next request of the same session, and the record stays.
  await api('admin', 'assignment.cancel', { assignment: mine, reason: 'Enrolled by mistake' })
  assert.equal((await h.submit('admin.revoke', cookies.owner, { grant: grant.id }, '/app/people')).searchParams.get('error'), null)
  assert.deepEqual((await api('admin', 'me')).adminUnits, [])
  for (const path of ['courses', 'people', 'report', 'units']) await api('admin', path, undefined, 403)
  await assert.rejects(h.signIn('noor@example.test', { requested: true }), /ordinary link confirmation/)
  await api('admin', `records/${ids.learner}`, undefined, 404)
  for (const path of ['/app/courses', '/app/reports', '/app/reports.csv', '/app/people', `/app/revisions/${(await api('author', `courses/${created.id}`)).publishedRevision}`]) assert.equal((await page(path, 'admin')).status, 403, path)
  const revoked = (await api('owner', 'units')).grants.find(row => row.id === grant.id)
  assert.deepEqual([revoked.state, revoked.revokedBy], ['revoked', ids.owner])
  await api('owner', 'admin.revoke', { grant: grant.id }, 404)
}

// ORG-003: an expert authors one course only; named reviewers decide and choose retraining; a reviewer handover keeps
// both decision histories; self-review is allowed per course by the owner, labelled, and refused when off.
export async function courseScopeCheck(f) {
  const { api, h, cookies, ids, course } = f
  const page = async (path, role) => { const response = await h.raw(path, { cookie: cookies[role] }); return { status: response.status, text: await response.text() } }
  const decide = async (role, revision, decision = 'publish', fields = {}) => (await h.submit('revision.decide', cookies[role], { revision, decision, ...fields }, `/app/revisions/${revision}`)).searchParams.get('error')
  for (const [name, roles] of [['expert', ['learner']], ['reviewer2', ['reviewer']]]) {
    ids[name] = (await api('owner', 'person.invite', { email: `${name}@example.test`, name, roles })).id
    cookies[name] = await h.signIn(`${name}@example.test`, { requested: true })
  }
  // Evidence an author or reviewer must never reach: a learner's practical upload.
  const practical = await course('Scoped evidence', true)
  const [assignment] = (await api('manager', 'assignment.create', { course: practical.id, learners: [ids.learner], dueDate: '2030-10-01' })).created
  for (const lesson of (await api('learner', `assignments/${assignment}`)).lessons) await api('learner', 'lesson.complete', { assignment, lesson: lesson.id })
  const attempt = await api('learner', 'practical.submit', { assignment, evidence: 'Shown on the floor', file: { filename: 'proof.txt', base64: Buffer.from('proof').toString('base64'), type: 'text/plain' } })
  const evidence = `/app/files/attachment/${(await api('learner', `attempts/${attempt.id}`)).attachment}`

  // The owner gives the expert one course; they coauthor it with the author and submit it.
  const unrelated = await course('Unrelated hygiene')
  const cold = await api('author', 'course.create', { title: 'Cold chain handling', reviewer: ids.reviewer })
  assert.equal((await h.submit('course.authors', cookies.owner, { course: cold.id, members: ids.expert }, `/app/courses/${cold.id}`)).searchParams.get('error'), null)
  assert.deepEqual((await api('expert', 'courses')).map(row => row.id), [cold.id])
  let draftVersion = (await api('author', 'course.lesson', { course: cold.id, draftVersion: cold.draftVersion, title: 'Receiving', body: 'Probe every pallet.', sources: [] })).draftVersion
  draftVersion = (await api('expert', 'course.lesson', { course: cold.id, draftVersion, title: 'Storage', body: 'Keep below 5 °C.', sources: [] })).draftVersion
  const first = (await api('expert', 'course.submit', { course: cold.id, draftVersion })).id
  assert.equal(await decide('reviewer', first, 'return', { note: 'Name the probe.' }), null)
  draftVersion = (await api('expert', 'course.lesson', { course: cold.id, draftVersion, title: 'Probe', body: 'Use the calibrated probe.', sources: [] })).draftVersion
  const second = (await api('expert', 'course.submit', { course: cold.id, draftVersion })).id
  assert.equal(await decide('reviewer', second, 'publish', { reassignment: 'none' }), null)
  const coursePage = await page(`/app/courses/${cold.id}`, 'expert')
  assert.ok(coursePage.status === 200 && coursePage.text.includes('Submit for review'))
  // Unrelated content, people administration and learner evidence are refused to the expert and to a reviewer.
  const otherDraft = (await api('author', `courses/${unrelated.id}`)).draftVersion
  assert.equal((await api('expert', 'course.lesson', { course: unrelated.id, draftVersion: otherDraft, title: 'x', body: 'x', sources: [] }, 403)).error, 'outside_your_courses')
  await api('expert', `courses/${unrelated.id}`, undefined, 403)
  await api('expert', 'course.create', { title: 'Mine', reviewer: ids.reviewer }, 403)
  for (const role of ['expert', 'reviewer']) {
    await api(role, 'people', undefined, 403)
    await api(role, 'person.roles', { member: ids.learner, roles: ['manager'] }, 403)
    await api(role, `records/${ids.learner}`, undefined, 404)
    await api(role, 'report', undefined, 403)
    assert.equal((await page(evidence, role)).status, 404)
  }
  assert.equal((await page(evidence, 'learner')).status, 200)

  // The reviewer is replaced with a reason; the old one can no longer decide, and both decision histories remain.
  await api('expert', 'course.reviewer', { course: cold.id, reviewer: ids.reviewer2, reason: 'x' }, 403)
  assert.equal((await h.submit('course.reviewer', cookies.owner, { course: cold.id, reviewer: ids.reviewer2, reason: 'Priya is on leave' }, `/app/courses/${cold.id}`)).searchParams.get('error'), null)
  const third = (await api('expert', 'course.submit', { course: cold.id, draftVersion })).id
  assert.equal(await decide('reviewer', third), 'named_reviewer_required')
  assert.equal(await decide('reviewer2', third, 'publish', { reassignment: 'open' }), null)
  const detail = await api('expert', `courses/${cold.id}`)
  assert.deepEqual(detail.revisions.map(row => [row.id, row.state, row.reviewedBy, row.selfReviewed]), [[third, 'published', ids.reviewer2, 0], [second, 'superseded', ids.reviewer, 0], [first, 'returned', ids.reviewer, 0]])
  // AUTHOR-004: the course's own author compares its revisions and restores one through the page, and only its own course's.
  const history = await page(`/app/courses/${cold.id}/compare?from=${second}&to=${third}`, 'expert')
  assert.ok(history.status === 200 && (await api('expert', `compare?from=${second}&to=${third}`)).changed === false)
  const restoredByExpert = await h.submit('course.restore', cookies.expert, { course: cold.id, draftVersion: (await api('expert', `courses/${cold.id}`)).draftVersion, revision: first }, `/app/courses/${cold.id}`)
  assert.equal(restoredByExpert.searchParams.get('error'), null)
  assert.deepEqual((await api('expert', `courses/${cold.id}`)).draft.lessons.map(lesson => lesson.title), ['Receiving', 'Storage'])
  await api('expert', `compare?from=${unrelated.revision}&to=${unrelated.revision}`, undefined, 403)
  assert.deepEqual(detail.reviewerChanges.map(row => [row.previousReviewer, row.reviewer, row.reason, row.changedBy]), [[ids.reviewer, ids.reviewer2, 'Priya is on leave', ids.owner]])

  // Self-review: off by default, so a reviewer cannot publish their own revision.
  const own = await api('reviewer', 'course.create', { title: 'Own work', reviewer: ids.reviewer })
  const ownDraft = (await api('reviewer', 'course.lesson', { course: own.id, draftVersion: own.draftVersion, title: 'Mine', body: 'Mine.', sources: [] })).draftVersion
  assert.equal(await decide('reviewer', (await api('reviewer', 'course.submit', { course: own.id, draftVersion: ownDraft })).id), 'self_review_not_allowed')
  // A one-person team: the owner names the unit's learning administrator as reviewer and allows self-review.
  const unit = (await api('owner', 'unit.create', { name: 'Solo site', teams: [] })).id
  await api('owner', 'admin.grant', { member: ids.expert, unit })
  const solo = await api('expert', 'course.create', { title: 'Solo safety', reviewer: ids.expert, unit })
  let soloDraft = (await api('expert', 'course.lesson', { course: solo.id, draftVersion: solo.draftVersion, title: 'Exits', body: 'Know both exits.', sources: [] })).draftVersion
  await api('expert', 'course.selfreview', { course: solo.id, allowed: true }, 403)
  assert.equal((await h.submit('course.selfreview', cookies.owner, { course: solo.id, allowed: 'yes' }, `/app/courses/${solo.id}`)).searchParams.get('error'), null)
  const fix = (await api('expert', 'course.submit', { course: solo.id, draftVersion: soloDraft })).id
  assert.equal(await decide('expert', fix), null)
  assert.equal((await api('expert', `courses/${solo.id}`)).revisions[0].selfReviewed, 1)
  assert.ok((await page(`/app/revisions/${fix}`, 'expert')).text.includes('(self-reviewed)') && (await page(`/app/courses/${solo.id}`, 'owner')).text.includes('(self-reviewed)'))
  // With self-review off again the same publication is refused.
  await api('owner', 'course.selfreview', { course: solo.id, allowed: false })
  soloDraft = (await api('expert', 'course.lesson', { course: solo.id, draftVersion: soloDraft, title: 'Assembly', body: 'Meet at the car park.', sources: [] })).draftVersion
  assert.equal(await decide('expert', (await api('expert', 'course.submit', { course: solo.id, draftVersion: soloDraft })).id), 'named_reviewer_required')
}
