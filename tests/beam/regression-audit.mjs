import assert from 'node:assert/strict'

// OPS-001: a course publication, an access revocation, an automatic outcome and an agent approval made through public
// doors are found in Audit by search and category, with the agent's route and its delegating person, and exported; a
// correction is appended beside its event, and no door edits or removes an event; a learning administrator and an
// auditor read only their own slice, and nobody else reads it.
export async function auditCheck(f) {
  const { api, h, cookies, ids, publish, course } = f
  const MINUTE = 60_000
  const page = async (path, role) => { const response = await h.raw(path, { cookie: cookies[role] }); return { status: response.status, text: await response.text() } }
  const find = async (query, action) => (await api('owner', `audit?${query}`)).events.find(event => event.action === action)

  // A course publication through the reviewer's form.
  const published = await course('Audited forklift check')
  const publication = await find('category=content&q=revision.publish', 'revision.publish')
  assert.equal(publication.actor, ids.reviewer)
  assert.ok((await api('owner', `audit?q=${published.revision}`)).events.some(event => event.action === 'revision.publish'))

  // An access revocation through the People form.
  ids.leaver = (await api('owner', 'person.invite', { email: 'leaver@example.test', name: 'Lee Leaver', roles: ['learner'] })).id
  cookies.leaver = await h.signIn('leaver@example.test', { requested: true })
  assert.equal((await h.submit('person.access', cookies.owner, { member: ids.leaver, status: 'inactive' }, '/app/people')).searchParams.get('error'), null)
  const revocation = await find('category=access&q=Lee%20Leaver', 'person.inactive')
  assert.deepEqual([revocation.subject, revocation.actor], [ids.leaver, ids.owner])

  // An automatic outcome: a timed quiz scored by rule when its limit passes, labelled as automatic.
  const c = await api('author', 'course.create', { title: 'Audited timed quiz', reviewer: ids.reviewer })
  let draftVersion = c.draftVersion
  for (const [action, fields] of [['course.lesson', { title: 'Read', body: 'Read it.', sources: [] }], ['course.question', { prompt: 'Ready?', choices: 'Yes\nNo', correct: '1' }], ['course.assessment', { passPercent: 100, maxAttempts: 2, timeLimitMinutes: 10 }]]) draftVersion = (await api('author', action, { course: c.id, draftVersion, ...fields })).draftVersion
  await publish((await api('author', 'course.submit', { course: c.id, draftVersion })).id)
  const [assignment] = (await api('manager', 'assignment.create', { course: c.id, learners: [ids.learner], dueDate: '2030-10-01' })).created
  for (const lesson of (await api('learner', `assignments/${assignment}`)).lessons) await api('learner', 'lesson.complete', { assignment, lesson: lesson.id })
  const started = await api('learner', 'quiz.start', { assignment })
  await h.db.prepare('UPDATE beam_quiz_sessions SET started_at = started_at - ?1, deadline = deadline - ?1 WHERE id = ?2').bind(11 * MINUTE, started.id).run()
  await api('learner', `assignments/${assignment}`)
  const expiry = await find('category=automatic', 'quiz.expire')
  assert.ok(expiry.automatic && expiry.detail.assignment === assignment)

  // An agent approval: the manager's preparation credential proposes, the manager decides; the audit names the route.
  const { token } = await api('manager', 'agent.issue', { expiresInSeconds: 600 })
  const proposedResponse = await h.fetch('/api/beam/agent.propose', { method: 'POST', headers: { authorization: `Bearer ${token}`, origin: h.origin, 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'process_change', title: 'Name a dock lead', agent: 'claude-code', inputs: [], reasons: ['Two late checks this month.'], excluded: [], payload: { summary: 'Name a dock lead each shift', change: 'Add a dock lead to the roster.' } }) })
  assert.equal(proposedResponse.status, 200)
  const proposed = await proposedResponse.json()
  assert.equal((await h.submit('agent.decide', cookies.manager, { proposal: proposed.id, decision: 'approve', sha256: proposed.sha256, note: 'Agreed.' }, '/app/agent')).searchParams.get('error'), null)
  const proposal = (await api('owner', 'audit?category=agent')).events.find(event => event.action === 'agent.propose' && event.subject === proposed.id)
  assert.deepEqual([proposal.actor, proposal.via?.kind, proposal.via?.delegatedBy], [ids.manager, 'agent_credential', 'manager'])
  const approval = await find(`q=${proposed.id}`, 'agent.approve')
  assert.deepEqual([approval.actor, approval.via], [ids.manager, null])

  // The page shows them and the CSV download carries the same events, formulas inert.
  const audit = await page('/app/audit?q=Audited', 'owner')
  assert.ok(audit.status === 200 && audit.text.includes('Audited forklift check'))
  const csv = await page(`/app/audit.csv?q=${proposed.id}`, 'owner')
  assert.ok(csv.status === 200 && csv.text.startsWith('Event,At (UTC),Actor') && csv.text.includes('agent.approve') && csv.text.includes('agent preparation credential delegated by manager'))
  assert.ok((await page('/app/audit.csv?category=automatic', 'owner')).text.includes('Timed quiz scored'))

  // A correction is appended beside its event; the event is unchanged.
  assert.equal((await h.submit('audit.correct', cookies.owner, { event: String(revocation.id), explanation: 'Left on 18 October; access removed a day late.' }, '/app/audit')).searchParams.get('error'), null)
  const corrected = (await api('owner', `audit?q=${ids.leaver}`)).events.find(event => event.id === revocation.id)
  assert.deepEqual([corrected.action, corrected.subject, corrected.corrections.map(row => row.explanation)], ['person.inactive', ids.leaver, ['Left on 18 October; access removed a day late.']])
  await api('owner', 'audit.correct', { event: 999999999, explanation: 'Nothing there' }, 404)

  // A learning administrator reads the events about their unit's people and courses; an auditor the recording of the
  // completions shared with them. Neither corrects, and neither sees events about anyone else.
  ids.unitAdmin = (await api('owner', 'person.invite', { email: 'unit.admin@example.test', name: 'Una Admin', roles: ['learner'] })).id
  ids.reader = (await api('owner', 'person.invite', { email: 'reader@example.test', name: 'Rae Reader', roles: ['learner'] })).id
  for (const role of ['unitAdmin', 'reader']) cookies[role] = await h.signIn(`${role === 'unitAdmin' ? 'unit.admin' : 'reader'}@example.test`, { requested: true })
  const unit = (await api('owner', 'unit.create', { name: 'Audit unit', teams: [ids.team] })).id
  await api('owner', 'admin.grant', { member: ids.unitAdmin, unit })
  const [finished] = (await api('manager', 'assignment.create', { course: published.id, learners: [ids.learner], dueDate: '2030-10-01' })).created
  for (const lesson of (await api('learner', `assignments/${finished}`)).lessons) await api('learner', 'lesson.complete', { assignment: finished, lesson: lesson.id })
  const day = offset => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
  await api('owner', 'auditor.grant', { member: ids.reader, teams: [ids.team], periodFrom: day(-1), periodTo: day(1), expiresOn: day(30) })
  const adminView = (await api('unitAdmin', 'audit')).events
  assert.ok(adminView.some(event => event.action === 'quiz.expire' && event.detail.assignment === assignment) && adminView.some(event => event.subject === finished))
  assert.ok(!adminView.some(event => event.subject === ids.leaver || event.action === 'agent.propose' || event.action === 'questions.answer'))
  const readerView = (await api('reader', 'audit')).events
  assert.ok(readerView.length > 0 && readerView.every(event => event.action === 'completion.record'))
  assert.ok((await page('/app/audit', 'unitAdmin')).text.includes('Audit') && !(await page('/app/audit', 'unitAdmin')).text.includes('Add a correction'))
  for (const role of ['unitAdmin', 'reader']) await api(role, 'audit.correct', { event: revocation.id, explanation: 'Mine' }, 403)

  // No door edits or removes an event, and nobody else reads, exports or corrects the audit.
  for (const action of ['audit.update', 'audit.delete', 'audit.remove']) await api('owner', action, { event: revocation.id }, 404)
  for (const role of ['manager', 'reviewer', 'learner']) {
    await api(role, 'audit', undefined, 403)
    await api(role, 'audit.correct', { event: revocation.id, explanation: 'Mine' }, 403)
    for (const path of ['/app/audit', '/app/audit.csv']) assert.equal((await page(path, role)).status, 403, `${role} ${path}`)
  }
  assert.equal((await api('owner', `audit?q=${ids.leaver}`)).events.find(event => event.id === revocation.id).corrections.length, 1)
}
