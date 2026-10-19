import assert from 'node:assert/strict'

// ORG-007: a learner finds offered courses by search, subject, skill, role, language and duration; sees required work
// apart from optional; self-enrolls in an open course, requests a restricted one that their manager approves (another
// manager cannot), withdraws from optional work with its history kept and cannot withdraw from required work; courses
// not offered to them, and other people's favorites and saved searches, stay hidden.
export async function catalogCheck(f) {
  const { api, h, cookies, ids, course } = f
  const page = async (path, role) => (await h.raw(path, { cookie: cookies[role] })).text()
  const knives = await course('Knife skills'), allergens = await course('Allergen lead'), closers = await course('Closing duties'), opening = await course('Opening checklist')
  const elsewhere = (await api('owner', 'team.create', { name: 'Catalog elsewhere' })).id
  await api('owner', 'course.catalog', { course: knives.id, folder: 'Kitchen', tags: 'knives, safety', language: 'en', durationMinutes: 20 })
  await api('owner', 'course.catalog', { course: allergens.id, folder: 'Kitchen', tags: 'allergens', language: 'es', durationMinutes: 45 })
  // Offering is set by whoever manages the course's catalog: open, on approval, or for chosen teams only.
  assert.ok((await page(`/app/courses/${knives.id}`, 'owner')).includes('Catalog enrollment'))
  assert.equal((await h.submit('course.enrollment', cookies.owner, { course: knives.id, mode: 'open' }, `/app/courses/${knives.id}`)).searchParams.get('error'), null)
  await api('owner', 'course.enrollment', { course: allergens.id, mode: 'request' })
  await api('owner', 'course.enrollment', { course: closers.id, mode: 'open', teams: [elsewhere] })
  await api('learner', 'course.enrollment', { course: opening.id, mode: 'open' }, 403)
  const path = (await api('manager', 'path.create', { name: 'Line cook', team: ids.team })).id
  await api('manager', 'path.revise', { path, courses: [knives.id], prerequisites: [''], dueDays: ['14'], renewalDays: [''] })
  const [required] = (await api('manager', 'assignment.create', { course: opening.id, learners: [ids.learner], dueDate: '2030-10-01' })).created

  // Browse and filter: only offered courses appear; each filter narrows by its own field.
  const titles = async query => (await api('learner', `catalog${query}`)).courses.map(row => row.title).sort()
  assert.deepEqual(await titles(''), ['Allergen lead', 'Knife skills'])
  assert.deepEqual(await titles('?q=knife'), ['Knife skills'])
  assert.deepEqual(await titles('?skill=allergens'), ['Allergen lead'])
  assert.deepEqual(await titles('?language=es'), ['Allergen lead'])
  assert.deepEqual(await titles('?maxMinutes=30'), ['Knife skills'])
  assert.deepEqual(await titles(`?role=${path}`), ['Knife skills'])
  assert.deepEqual(await titles('?subject=Kitchen'), ['Allergen lead', 'Knife skills'])
  const html = await page('/app/catalog?subject=Kitchen', 'learner')
  assert.ok(html.includes('Knife skills') && !html.includes('Closing duties') && html.includes('Required'))
  for (const hidden of [closers.id, opening.id]) await api('learner', 'catalog.enroll', { course: hidden }, 404)

  // Self-enroll in the open course; it is optional work beside the required one. The restricted one needs a request.
  const enrolled = await h.submit('catalog.enroll', cookies.learner, { course: knives.id }, '/app/learn/{id}')
  assert.equal(enrolled.searchParams.get('error'), null)
  assert.equal((await api('learner', 'catalog.enroll', { course: allergens.id }, 409)).error, 'approval_required')
  let mine = await api('learner', 'catalog')
  const optional = mine.optional.find(row => row.courseTitle === 'Knife skills').id
  assert.ok(enrolled.pathname === `/app/learn/${optional}` && mine.required.some(row => row.id === required))
  assert.equal(mine.courses.find(row => row.title === 'Knife skills').standing, 'optional')
  await api('learner', 'catalog.request', { course: allergens.id, note: 'I run the allergen board on Saturdays' })
  await api('learner', 'catalog.request', { course: allergens.id }, 409)
  const request = (await api('manager', 'catalog-requests')).find(row => row.learner === ids.learner && row.course === allergens.id)
  assert.equal(request.note, 'I run the allergen board on Saturdays')
  await api('other', 'catalog.decide', { request: request.id, decision: 'approve' }, 403)
  assert.ok((await page('/app/catalog', 'manager')).includes('Enrollment requests waiting for you'))
  assert.equal((await h.submit('catalog.decide', cookies.manager, { request: request.id, decision: 'approve' }, '/app/catalog')).searchParams.get('error'), null)
  mine = await api('learner', 'catalog')
  assert.deepEqual([mine.requests[0].state, mine.courses.find(row => row.title === 'Allergen lead').standing], ['approved', 'optional'])

  // Withdraw from optional work: the assignment ends as cancelled and stays readable with its history; required work cannot be withdrawn.
  assert.equal((await api('learner', 'catalog.withdraw', { assignment: required }, 409)).error, 'required_work')
  assert.equal((await h.submit('catalog.withdraw', cookies.learner, { assignment: optional }, '/app/catalog')).searchParams.get('error'), null)
  const history = await api('learner', `assignments/${optional}`)
  assert.deepEqual([history.assignment.status, history.assignment.reason, history.lessons.length], ['cancelled', 'self', 1])
  assert.ok((await api('learner', 'catalog')).withdrawn.some(row => row.id === optional))
  assert.ok((await api('manager', 'report')).rows.some(row => row.assignment === optional && row.status === 'cancelled'))

  // Favorites and saved searches are personal.
  await api('learner', 'catalog.favorite', { course: knives.id })
  await h.submit('catalog.search', cookies.learner, { name: 'Kitchen, short', subject: 'Kitchen', maxMinutes: '30' }, '/app/catalog')
  mine = await api('learner', 'catalog')
  assert.deepEqual([mine.favorites.map(row => row.id), mine.searches.map(row => [row.name, row.query.subject, row.query.maxMinutes])], [[knives.id], [['Kitchen, short', 'Kitchen', 30]]])
  const theirs = await api('assessor', 'catalog')
  assert.deepEqual([theirs.favorites, theirs.searches, theirs.courses.find(row => row.id === knives.id).favorite], [[], [], false])
  await api('learner', 'catalog.favorite', { course: closers.id }, 404)
}
