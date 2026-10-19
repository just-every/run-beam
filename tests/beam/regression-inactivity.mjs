import assert from 'node:assert/strict'

// AUTO-007: the owner previews and switches on an inactivity policy; a run gives an inactive person a notice, a sign-in
// cancels it, a notice that runs out removes access (sessions revoked, records kept, recorded with the policy version),
// running twice changes nothing more, protected people are left alone, and the owner's restore plus a fresh emailed
// sign-in recovers the person.
export async function inactivityCheck(f) {
  const { api, h, cookies, ids } = f
  const DAY = 86_400_000
  const age = (email, ms) => h.db.prepare('UPDATE oa_sessions SET created_at = created_at - ?1 WHERE operator_id = (SELECT id FROM oa_operators WHERE lower(email) = ?2)').bind(ms, email).run()
  const run = () => api('owner', 'inactivity.run', {})

  // Only the owner sets the policy; it runs only once switched on, and switches on only after a preview of this version.
  assert.equal((await api('manager', 'inactivity.policy', { inactiveDays: 90, noticeDays: 14 }, 403)).error, 'owner_required')
  assert.equal((await h.submit('inactivity.policy', cookies.owner, { inactiveDays: '90', noticeDays: '14', excludedTeams: ids.team }, '/app/people')).searchParams.get('error'), null)
  assert.equal((await api('owner', 'inactivity.enable', { enabled: 'true' }, 409)).error, 'preview_required')
  assert.equal((await api('owner', 'inactivity.run', {}, 409)).error, 'policy_not_enabled')

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

  // A run gives the notice, shown on My learning; a second run changes nothing; signing in again cancels it.
  assert.deepEqual(await run(), { version: 1, noticed: [ids.author], cancelled: [], deactivated: [] })
  assert.match(await (await h.raw('/app/learning', { cookie: cookies.author })).text(), /Your access ends .* unless you sign in again/)
  assert.deepEqual(await run(), { version: 1, noticed: [], cancelled: [], deactivated: [] })
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
  assert.equal((await api('owner', `records/${ids.author}`)).member.id, ids.author)
  const notices = (await api('owner', 'inactivity')).notices.filter(notice => notice.member === ids.author)
  assert.deepEqual(notices.map(notice => [notice.state, notice.policyVersion]), [['deactivated', 1], ['cancelled', 1]])
  const removed = (await api('owner', 'audit?q=inactivity.deactivate')).events.find(event => event.subject === ids.author)
  assert.deepEqual([removed.action, removed.detail.version, removed.detail.inactiveDays], ['inactivity.deactivate', 1, 90])

  // Recovery: the owner restores access; the old sessions stay ended and a fresh emailed sign-in works.
  await api('owner', 'person.access', { email: 'author@example.test', status: 'active' })
  assert.equal((await h.raw('/api/beam/me', { cookie: fresh })).status, 401)
  assert.equal((await h.api('me', await h.signIn('author@example.test'))).id, ids.author)
}
