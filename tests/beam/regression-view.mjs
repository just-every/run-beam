import assert from 'node:assert/strict'

// ORG-012: a learning administrator opens "View as" for a learner in their unit and sees that learner's pages as they
// do, read-only: writes, evidence downloads and non-learner pages are refused, progress does not move, and the session
// is in Audit with how long it lasted. Another unit's learner, the owner and another administrator are refused; a
// manager views only their own team; a view ends on exit, after 15 minutes, or when the viewer's authority ends.
export async function viewAsCheck(f) {
  const { api, h, cookies, ids, course } = f
  const MINUTE = 60_000
  const raw = (path, cookie, form) => h.raw(path, { cookie, form })
  const startView = async (cookie, learner) => {
    const response = await raw('/app/view/start', cookie, new URLSearchParams({ learner, returnTo: `/app/records/${learner}` }))
    assert.equal(response.status, 303)
    return `${cookie}; ${response.headers.getSetCookie().find(line => line.startsWith('beam_view=')).split(';')[0]}`
  }
  const viewEvents = async (reason) => (await api('owner', 'audit?q=view.')).events.filter(event => event.action === 'view.end' && event.detail.reason === reason)

  ids.viewer = (await api('owner', 'person.invite', { email: 'viewer@example.test', name: 'Vera Viewer', roles: ['learner'] })).id
  cookies.viewer = await h.signIn('viewer@example.test', { requested: true })
  const unit = (await api('owner', 'unit.create', { name: 'View unit', teams: [ids.team] })).id
  const grant = (await api('owner', 'admin.grant', { member: ids.viewer, unit })).id
  await api('owner', 'admin.grant', { member: ids.admin, unit })
  // The learner's own training: one course completed with a certificate, one still open.
  const done = await course('Viewed course'), open = await course('Viewed open course')
  const [completed] = (await api('manager', 'assignment.create', { course: done.id, learners: [ids.learner], dueDate: '2030-10-01' })).created
  for (const lesson of (await api('learner', `assignments/${completed}`)).lessons) await api('learner', 'lesson.complete', { assignment: completed, lesson: lesson.id })
  const [pending] = (await api('manager', 'assignment.create', { course: open.id, learners: [ids.learner], dueDate: '2030-10-01' })).created
  const record = await api('learner', 'records/me')
  const certificate = record.completions.find(row => row.course === done.id).certificate
  const before = await api('learner', `assignments/${pending}`)
  const learnerEvents = (await api('owner', `audit?actor=${ids.learner}`)).events.length

  // The view: the learner's pages and reads, as the learner sees them, under a banner naming whose view it is.
  const viewing = await startView(cookies.viewer, ids.learner)
  const home = await (await raw('/app/learning', viewing)).text()
  assert.ok(home.includes('Viewing Beam as <strong>learner</strong>') && home.includes('Viewed open course') && home.includes('Exit view'))
  assert.equal((await h.api('me', viewing)).id, ids.learner)
  assert.deepEqual((await h.api('records/me', viewing)).completions.map(row => row.id), record.completions.map(row => row.id))
  const overview = await (await raw(`/app/learn/${completed}`, viewing)).text()
  assert.ok(overview.includes('Completed') && overview.includes(`/app/certificates/${certificate}`))
  assert.equal((await raw(`/app/certificates/${certificate}`, viewing)).status, 200)

  // Read-only: every write and form is refused, as are evidence files, policy documents, practice, anonymous questions
  // and pages beyond the learner's own; nothing moved.
  const lesson = before.lessons[0].id
  assert.equal((await h.api('lesson.complete', viewing, { assignment: pending, lesson }, 403)).error, 'view_as_read_only')
  assert.equal((await raw('/app/do/lesson.complete', viewing, new URLSearchParams({ assignment: pending, lesson }))).status, 403)
  assert.equal((await h.api('quiz.start', viewing, { assignment: pending }, 403)).error, 'view_as_read_only')
  assert.equal((await h.api('agent.issue', viewing, { expiresInSeconds: 600 }, 403)).error, 'view_as_read_only')
  for (const path of ['/app/files/attachment/any', '/app/acknowledgments/any/document', '/app/practice/any', '/app/questions/any', '/app/people', '/app/manage', '/app/audit', `/app/records/${ids.learner}`]) assert.equal((await raw(path, viewing)).status, 403, path)
  for (const path of ['people', 'report', 'audit', `practice/any`]) await h.api(path, viewing, undefined, 403)
  assert.deepEqual((await api('learner', `assignments/${pending}`)).lessons.map(row => row.completed), before.lessons.map(row => row.completed))
  assert.equal((await api('owner', `audit?actor=${ids.learner}`)).events.length, learnerEvents)

  // Exit ends it and clears the cookie; Audit has who viewed whom, when and for how long.
  const exit = await raw('/app/view/end', viewing, new URLSearchParams())
  assert.ok(exit.status === 303 && exit.headers.getSetCookie().some(line => line.startsWith('beam_view=;')))
  assert.equal((await h.api('me', viewing)).id, ids.viewer)
  const [ended] = await viewEvents('exit')
  assert.deepEqual([ended.actor, ended.subject, typeof ended.detail.seconds], [ids.viewer, ids.learner, 'number'])
  assert.ok((await api('owner', 'audit?q=view.start')).events.some(event => event.actor === ids.viewer && event.subject === ids.learner))

  // Refused: another unit's learner, the owner, another administrator, yourself; a learner views nobody.
  assert.equal((await api('viewer', 'view.start', { learner: ids.other }, 403)).error, 'outside_your_units')
  assert.equal((await api('viewer', 'view.start', { learner: ids.owner }, 403)).error, 'cannot_view_owner')
  assert.equal((await api('viewer', 'view.start', { learner: ids.admin }, 403)).error, 'cannot_view_administrator')
  assert.equal((await api('viewer', 'view.start', { learner: ids.viewer }, 403)).error, 'cannot_view_yourself')
  assert.equal((await api('learner', 'view.start', { learner: ids.other }, 403)).error, 'forbidden')
  // A manager views their own team's learner only.
  await api('manager', 'view.start', { learner: ids.learner })
  const loner = (await api('owner', 'person.invite', { email: 'loner@example.test', name: 'Lone Learner', roles: ['learner'] })).id
  assert.equal((await api('manager', 'view.start', { learner: loner }, 403)).error, 'learner_outside_your_team')

  // A view ends 15 minutes after it starts, and at once when the viewer's authority ends.
  const timed = await startView(cookies.viewer, ids.learner)
  await h.db.prepare('UPDATE beam_view_sessions SET started_at = started_at - ?1, expires_at = expires_at - ?1 WHERE viewer_id = ?2 AND ended_at IS NULL').bind(16 * MINUTE, ids.viewer).run()
  assert.equal((await h.api('me', timed)).id, ids.viewer)
  assert.equal((await viewEvents('timeout'))[0].detail.seconds, 15 * 60)
  const revoked = await startView(cookies.viewer, ids.learner)
  await api('owner', 'admin.revoke', { grant })
  assert.equal((await h.api('me', revoked)).id, ids.viewer)
  assert.equal((await viewEvents('authority_ended')).length, 1)
}
