import assert from 'node:assert/strict'

// AUTHOR-005: the owner retires a course with an open assignment through its page; no door assigns
// it anew while its records stay readable and the open assignment can still be finished; a copy is a new unpublished
// course with the same draft and reviewer that leaves the source untouched; reinstating makes it assignable again.
// Catalog details make a template an author builds from, tags change on several courses at once and filter the list,
// and a retired course is archived out of the everyday list while staying readable.
export async function estateCheck(f) {
  const { api, h, cookies, ids, course } = f
  const c = await course('Forklift refresher')
  const [open] = (await api('manager', 'assignment.create', { course: c.id, learners: [ids.learner], dueDate: '2030-10-01' })).created
  for (const role of ['learner', 'manager']) await api(role, 'course.retire', { course: c.id, reason: 'Not mine' }, 403)
  assert.equal((await h.submit('course.retire', cookies.owner, { course: c.id, reason: 'Replaced by the 2027 forklift course.' }, `/app/courses/${c.id}`)).searchParams.get('error'), null)
  const detail = await api('owner', `courses/${c.id}`)
  assert.deepEqual([detail.retired.by, detail.retired.reason], [ids.owner, 'Replaced by the 2027 forklift course.'])
  assert.ok((await (await h.raw(`/app/courses/${c.id}`, { cookie: cookies.owner })).text()).includes('Reinstate for new assignments'))

  // No door assigns it anew: a person, a team, the Manage form.
  assert.equal((await api('manager', 'assignment.create', { course: c.id, learners: [ids.learner], dueDate: '2030-10-01' }, 409)).error, 'course_retired')
  assert.equal((await api('manager', 'assignment.create', { course: c.id, teams: [ids.team], dueDate: '2030-10-01' }, 409)).error, 'course_retired')
  assert.equal((await h.submit('assignment.create', cookies.manager, { course: c.id, learners: ids.learner, dueDate: '2030-10-01' }, '/app/manage')).searchParams.get('error'), 'course_retired')
  assert.equal((await api('owner', 'course.retire', { course: c.id, reason: 'Twice' }, 409)).error, 'course_retired')

  // Its records stay readable and the open assignment is still finished, with its certificate.
  for (const lesson of (await api('learner', `assignments/${open}`)).lessons) await api('learner', 'lesson.complete', { assignment: open, lesson: lesson.id })
  assert.equal((await api('learner', `assignments/${open}`)).assignment.status, 'completed')
  assert.ok((await api('learner', 'records/me')).completions.some(row => row.course === c.id && row.certificate))
  assert.ok((await api('manager', `report?course=${c.id}`)).rows.some(row => row.assignment === open && row.status === 'completed'))

  // A copy through the course page: a new unpublished course with the same draft and reviewer; the source is untouched.
  const copied = await h.submit('course.clone', cookies.owner, { course: c.id, title: 'Forklift refresher 2027' }, '/app/courses/{id}')
  const copyId = copied.pathname.split('/').pop()
  const copy = await api('author', `courses/${copyId}`)
  assert.deepEqual([copy.title, copy.publishedRevision, copy.clonedFrom, copy.reviewer, copy.retired, copy.draft.lessons.map(row => row.title)], ['Forklift refresher 2027', null, c.id, detail.reviewer, null, detail.draft.lessons.map(row => row.title)])
  await api('author', 'course.lesson', { course: copyId, draftVersion: copy.draftVersion, title: 'Mast checks', body: 'Check the mast chains.', sources: [] })
  assert.equal((await api('author', `courses/${c.id}`)).draft.lessons.length, detail.draft.lessons.length)
  await api('manager', 'course.clone', { course: c.id }, 403)

  // Reinstated, it is assignable again; each step is in the audit.
  await api('owner', 'course.reinstate', { course: c.id })
  assert.equal((await api('manager', 'assignment.create', { course: c.id, learners: [ids.learner], dueDate: '2030-10-01' })).created.length, 1)
  const actions = (await api('owner', `audit?q=${c.id}`)).events.map(event => event.action)
  assert.ok(['course.retire', 'course.reinstate', 'course.clone'].every(action => actions.includes(action)))

  // Catalog details through the course page, then an author builds a course from it as a template.
  const page = async path => await (await h.raw(path, { cookie: cookies.owner })).text()
  assert.equal((await h.submit('course.catalog', cookies.owner, { course: c.id, folder: 'Warehouse', tags: 'Safety, forklift, safety', objectives: 'Inspect the forks\nReport damage', language: 'en-US', durationMinutes: '20', owner: ids.manager, template: 'true' }, `/app/courses/${c.id}`)).searchParams.get('error'), null)
  const catalog = (await api('owner', `courses/${c.id}`)).catalog
  assert.deepEqual([catalog.folder, catalog.tags, catalog.objectives, catalog.language, catalog.durationMinutes, catalog.owner, catalog.template], ['Warehouse', ['safety', 'forklift'], ['Inspect the forks', 'Report damage'], 'en-US', 20, ids.manager, true])
  assert.equal((await api('owner', 'course.catalog', { course: c.id, language: 'English' }, 400)).error, 'invalid_language')
  assert.equal((await api('author', 'course.catalog', { course: c.id, folder: 'Mine' }, 403)).error, 'forbidden')
  assert.ok((await (await h.raw('/app/courses', { cookie: cookies.author })).text()).includes('Start from a template'))
  const built = (await h.submit('course.clone', cookies.author, { course: c.id, title: 'Forklift night shift' }, '/app/courses/{id}')).pathname.split('/').pop()
  const builtCatalog = (await api('author', `courses/${built}`)).catalog
  assert.deepEqual([builtCatalog.folder, builtCatalog.tags, builtCatalog.template, builtCatalog.owner], ['Warehouse', ['safety', 'forklift'], false, ids.author])

  // Tags change on several courses at once and filter the list.
  assert.equal((await h.submit('course.retag', cookies.owner, { courses: [c.id, copyId], add: 'Refresher', remove: 'safety' }, '/app/courses')).searchParams.get('error'), null)
  const tagged = (await api('owner', 'courses')).filter(row => row.tags.includes('refresher'))
  assert.deepEqual(tagged.map(row => row.id).sort(), [c.id, copyId].sort())
  assert.deepEqual(tagged.find(row => row.id === c.id).tags, ['forklift', 'refresher'])
  const filtered = await page('/app/courses?tag=refresher')
  assert.ok(filtered.includes('Forklift refresher 2027') && !filtered.includes('Forklift night shift'))
  await api('manager', 'course.retag', { courses: [c.id], add: 'mine' }, 403)

  // Archiving needs retirement first; an archived course leaves the everyday list and stays readable.
  assert.equal((await api('owner', 'course.archive', { course: copyId }, 409)).error, 'retire_before_archiving')
  await api('owner', 'course.retire', { course: copyId, reason: 'Superseded by the night-shift course.' })
  assert.equal((await h.submit('course.archive', cookies.owner, { course: copyId, archived: 'true' }, `/app/courses/${copyId}`)).searchParams.get('error'), null)
  assert.ok(!(await page('/app/courses')).includes('Forklift refresher 2027') && (await page('/app/courses?archived=1')).includes('Forklift refresher 2027'))
  assert.equal((await h.raw(`/app/courses/${copyId}`, { cookie: cookies.owner })).status, 200)
}
