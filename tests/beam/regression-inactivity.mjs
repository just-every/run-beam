import assert from 'node:assert/strict'

// AUTO-007: the owner previews and switches on an inactivity policy; a run gives an inactive person a notice, a sign-in
// cancels it, a notice that runs out removes access (sessions revoked, records kept, recorded with the policy version),
// running twice changes nothing more, protected people are left alone, and the owner's restore plus a fresh emailed
// sign-in recovers the person.
export async function inactivityCheck(f) {
  const { api, h, cookies, ids } = f
  const DAY = 86_400_000
  const age = (email, ms) => h.db.prepare('UPDATE oa_operators SET last_signin_at = ?1, created_at = MIN(created_at, ?1) WHERE lower(email) = ?2').bind(Date.now() - ms, email).run()
  const run = () => api('owner', 'inactivity.run', {})
  const auth = async (path, body, status = 200, cookie = cookies.owner) => {
    const res = await h.raw(path, { cookie, body }); const data = await res.json(); assert.equal(res.status, status, JSON.stringify(data)); return data
  }
  const tick = () => h.scheduled()
  const nextDay = () => h.db.prepare('UPDATE oa_policy_runs SET finished_at = finished_at - ? WHERE admitted = 1').bind(2 * DAY).run()

  // Only the owner sets the policy; it runs only once switched on, and switches on only after a preview of this version.
  assert.equal((await api('manager', 'inactivity.policy', { inactiveDays: 90, noticeDays: 14 }, 403)).error, 'owner_required')
  assert.equal((await h.submit('inactivity.policy', cookies.owner, { inactiveDays: '90', noticeDays: '14', excludedTeams: ids.team }, '/app/people')).searchParams.get('error'), null)
  assert.equal((await api('owner', 'inactivity.enable', { enabled: 'true' }, 409)).error, 'preview_required')
  assert.equal((await api('owner', 'inactivity.run', {}, 409)).error, 'policy_not_enabled')

  await api('owner', 'person.roles', { member: ids.author, roles: ['author', 'learner'] })
  const evidenceCourse = await f.course('Retained food safety evidence')
  await api('owner', 'offline.record', { ...f.offline(evidenceCourse), learners: [ids.author], heldOn: new Date().toISOString().slice(0, 10) })
  const evidenceBefore = await api('owner', `records/${ids.author}`)
  assert.ok(evidenceBefore.completions.length)

  // The author and the learner last signed in 100 days ago; the learner's team is protected, as is the owner.
  await age('author@example.test', 100 * DAY)
  await age('learner@example.test', 100 * DAY)
  const preview = await api('owner', 'inactivity.preview', {})
  assert.deepEqual(preview.notify.map(person => person.id), [ids.author])
  assert.deepEqual([preview.protected.find(person => person.id === ids.learner)?.protectedBy, preview.protected.find(person => person.id === ids.owner)?.protectedBy], ['protected team', 'owner'])
  assert.deepEqual((await api('owner', 'inactivity')).notices, [])
  const people = await (await h.raw('/app/people', { cookie: cookies.owner })).text()
  assert.ok(people.includes('Inactive accounts') && people.includes('would get a notice: no sign-in for 100 days'))
  assert.equal((await h.submit('inactivity.enable', cookies.owner, { enabled: 'true' }, '/app/people')).searchParams.get('error'), null)

  await tick()
  assert.equal((await auth('/auth/policy-runs')).runs[0].error, 'policy_approval_required')
  assert.deepEqual((await api('owner', 'inactivity')).notices, [])

  // A run gives the notice, shown on My learning; a second run changes nothing; signing in again cancels it.
  assert.deepEqual(await run(), { version: 1, noticed: [ids.author], cancelled: [], deactivated: [] })
  assert.match(await (await h.raw('/app/learning', { cookie: cookies.author })).text(), /Your access ends .* unless you sign in again/)
  assert.deepEqual(await run(), { version: 1, noticed: [], cancelled: [], deactivated: [] })
  await api('owner', 'team.members', { team: ids.team, members: [ids.learner, ids.author] })
  assert.deepEqual((await run()).cancelled, [ids.author])
  await api('owner', 'team.members', { team: ids.team, members: [ids.learner] })
  assert.deepEqual((await run()).noticed, [ids.author])
  const fresh = await h.signIn('author@example.test')
  assert.deepEqual((await run()).cancelled, [ids.author])

  // Inactive again: a new notice; when it runs out the next run removes access, and the run after that does nothing.
  await age('author@example.test', 100 * DAY)
  assert.deepEqual((await run()).noticed, [ids.author])
  await h.db.prepare("UPDATE beam_inactivity_notices SET deactivate_at = ? WHERE member_id = ? AND state = 'open'").bind(Date.now() - 1000, ids.author).run()
  assert.deepEqual(await run(), { version: 1, noticed: [], cancelled: [], deactivated: [ids.author] })
  assert.deepEqual(await run(), { version: 1, noticed: [], cancelled: [], deactivated: [] })
  for (const cookie of [cookies.author, fresh]) assert.equal((await h.raw('/api/beam/me', { cookie })).status, 401)
  assert.equal((await api('learner', 'me')).id, ids.learner)
  assert.deepEqual(await api('owner', `records/${ids.author}`), evidenceBefore)
  const notices = (await api('owner', 'inactivity')).notices.filter(notice => notice.member === ids.author)
  assert.deepEqual(notices.map(notice => [notice.state, notice.policyVersion]), [['deactivated', 1], ['cancelled', 1], ['cancelled', 1]])
  const removed = (await api('owner', 'audit?q=inactivity.deactivate')).events.find(event => event.subject === ids.author)
  assert.deepEqual([removed.action, removed.detail.version, removed.detail.inactiveDays], ['inactivity.deactivate', 1, 90])

  // Recovery: the owner restores access; the old sessions stay ended and a fresh emailed sign-in works.
  await api('owner', 'person.access', { member: ids.author, status: 'active' })
  assert.equal((await h.raw('/api/beam/me', { cookie: fresh })).status, 401)
  cookies.author = await h.signIn('author@example.test')
  assert.equal((await api('author', 'me')).id, ids.author)

  // Scheduled authority is reviewed separately, origin/owner-only and bound to the exact policy definition.
  await auth('/auth/policies', undefined, 403, cookies.manager)
  let current = (await auth('/auth/policies')).policies[0]
  await api('manager', 'inactivity.approve', { versionHash: current.versionHash }, 403)
  await api('owner', 'inactivity.approve', { versionHash: '0'.repeat(64) }, 409)
  const cross = await h.fetch('/api/beam/inactivity.approve', { method: 'POST', headers: { cookie: cookies.owner, origin: 'https://other.example.test', 'content-type': 'application/json' }, body: JSON.stringify({ versionHash: current.versionHash }) })
  assert.equal(cross.status, 403)
  const approval = await api('owner', 'inactivity.approve', { versionHash: current.versionHash })
  assert.ok(approval.id)
  await age('author@example.test', 100 * DAY)
  assert.equal((await h.raw('/auth/signout', { cookie: cookies.owner, body: {} })).status, 204)
  await tick()
  cookies.owner = await h.signIn('owner@example.test')
  assert.equal((await api('owner', 'inactivity')).notices.find(notice => notice.member === ids.author).state, 'open')
  // Admission prevents hidden repeat work within its minimum interval.
  await tick()
  assert.equal((await auth('/auth/policy-runs')).runs[0].error, 'policy_interval')
  await h.db.prepare("UPDATE beam_inactivity_notices SET deactivate_at = ? WHERE member_id = ? AND state = 'open'").bind(Date.now() - 1, ids.author).run()
  const retained = await api('owner', `records/${ids.author}`)
  await nextDay()
  await tick()
  assert.equal((await h.raw('/api/beam/me', { cookie: cookies.author })).status, 401)
  assert.deepEqual(await api('owner', `records/${ids.author}`), retained)
  const completed = (await auth('/auth/policy-runs')).runs.find(run => run.actions.some(action => action.action === 'operators:deactivate'))
  assert.equal(completed.status, 'completed')
  assert.equal(completed.actions[0].value.approvedBy, approval.ownerId)
  assert.equal(completed.actions[0].value.approvalId, approval.id)
  assert.equal(completed.actions[0].value.runId, completed.id)
  assert.ok(completed.actions[0].value.operatorId)
  assert.equal((await api('owner', 'people')).members.find(person => person.id === ids.author).status, 'inactive')
  assert.equal((await api('owner', 'me')).id, ids.owner)
  await api('owner', 'person.access', { member: ids.author, status: 'active' })
  cookies.author = await h.signIn('author@example.test')
  assert.equal((await api('author', 'me')).id, ids.author)

  // Protected live work takes precedence over inactivity, even when nobody has signed in recently.
  const practical = await f.course('Forklift assessment waiting', true)
  const waiting = await f.assign(practical)
  await f.lessons(waiting)
  await api('learner', 'practical.submit', { assignment: waiting, evidence: 'Ready for observation' })
  await age('assessor@example.test', 100 * DAY)
  let protectedPreview = await api('owner', 'inactivity.preview', {})
  assert.equal(protectedPreview.protected.find(person => person.id === ids.assessor).protectedBy, 'evidence waiting for them as assessor')
  const blocked = await f.assign(await f.course('Learning during leave'))
  await api('learner', 'blocker.report', { assignment: blocked, kind: 'leave', note: 'On leave' })
  protectedPreview = await api('owner', 'inactivity.preview', {})
  assert.equal(protectedPreview.protected.find(person => person.id === ids.learner).protectedBy, 'open blocker or exception')
  await api('owner', 'exception.grant', { assignment: blocked, kind: 'deferral', endsOn: new Date(Date.now() + 7 * DAY).toISOString().slice(0,10), reason: 'Approved leave' })
  assert.equal((await api('owner', 'inactivity.preview', {})).protected.find(person => person.id === ids.learner).protectedBy, 'open blocker or exception')

  // Revocation stops the next tick; changing a policy requires preview, enable and a new hash approval.
  await api('owner', 'inactivity.revoke', { approvalId: approval.id })
  await age('author@example.test', 100 * DAY)
  await nextDay(); await tick()
  assert.equal((await auth('/auth/policy-runs')).runs[0].error, 'policy_revoked')
  assert.ok(!(await api('owner', 'inactivity')).notices.some(notice => notice.member === ids.author && notice.state === 'open'))
  await api('owner', 'inactivity.policy', { inactiveDays: 91, noticeDays: 14, excludedRoles: ['author'], excludedTeams: [ids.team] })
  await api('owner', 'inactivity.approve', { versionHash: current.versionHash }, 409)
  await api('owner', 'inactivity.preview', {})
  await api('owner', 'inactivity.enable', { enabled: 'true' })
  current = (await auth('/auth/policies')).policies[0]
  await api('owner', 'inactivity.approve', { versionHash: current.versionHash })
  assert.equal((await api('owner', 'inactivity.preview', {})).protected.find(person => person.id === ids.author).protectedBy, 'protected role')
  await tick()
  assert.ok(!(await api('owner', 'inactivity')).notices.some(notice => notice.member === ids.author && notice.state === 'open'))
}
