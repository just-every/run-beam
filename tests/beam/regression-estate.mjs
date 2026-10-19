import assert from 'node:assert/strict'

// AUTHOR-005 (retire and copy): the owner retires a course with an open assignment through its page; no door assigns
// it anew while its records stay readable and the open assignment can still be finished; a copy is a new unpublished
// course with the same draft and reviewer that leaves the source untouched; reinstating makes it assignable again.
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
}
