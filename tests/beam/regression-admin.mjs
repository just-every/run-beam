import assert from 'node:assert/strict'

// ORG-002: the owner grants a learning administrator one business unit; they manage its courses, enrollment and
// reports through the HTML and JSON doors, are refused another unit, owner and provider authority, and lose every
// page, API call and download when a grant expires or is revoked.
export async function adminCheck(f) {
  const { api, h, cookies, ids, publish, course } = f
  const page = async (path, role) => { const response = await h.raw(path, { cookie: cookies[role] }); return { status: response.status, text: await response.text() } }
  ids.admin = (await api('owner', 'person.invite', { email: 'admin@example.test', name: 'Ada Admin', roles: ['learner'] })).id
  cookies.admin = await h.signIn('admin@example.test', { requested: true })
  const north = (await api('manager', 'team.create', { name: 'North floor' })).id, south = (await api('manager', 'team.create', { name: 'South floor' })).id
  await api('manager', 'team.members', { team: north, members: [ids.learner] })
  await api('manager', 'team.members', { team: south, members: [ids.other] })
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
  await api('admin', `records/${ids.learner}`, undefined, 404)
  for (const path of ['/app/courses', '/app/reports', '/app/reports.csv', '/app/people', `/app/revisions/${(await api('author', `courses/${created.id}`)).publishedRevision}`]) assert.equal((await page(path, 'admin')).status, 403, path)
  const revoked = (await api('owner', 'units')).grants.find(row => row.id === grant.id)
  assert.deepEqual([revoked.state, revoked.revokedBy], ['revoked', ids.owner])
  await api('owner', 'admin.revoke', { grant: grant.id }, 404)
}
