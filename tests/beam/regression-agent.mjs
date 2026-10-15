import assert from 'node:assert/strict'
import { file } from './harness.mjs'
export async function agentCheck(f) {
  const { api, h, cookies, ids, course, nextRevision, request, publish } = f
  const c = await course('Human publication')
  const revision = await nextRevision(c)
  const result = { cookiePublication: await request('/api/beam/revision.decide', { role: 'reviewer', body: { revision, decision: 'publish' } }) }
  assert.equal(result.cookiePublication.status, 403)
  assert.equal((await request('/app/do/revision.decide', { role: 'reviewer', body: { revision, decision: 'publish' } })).status, 403)
  await api('owner', 'person.roles', { email: 'other@example.test', roles: ['assessor', 'reviewer'] })
  const wrongReviewer = await h.submit('revision.decide', cookies.other, { revision, decision: 'publish' })
  assert.ok(wrongReviewer.searchParams.get('error'))
  assert.equal((await api('reviewer', `revisions/${revision}`)).revision.state, 'in_review')
  result.wrongNamedHumanReviewerRefused = true
  const issue = async (role, seconds = 300) => {
    const response = await request('/api/beam/agent.issue', { role, body: { expiresInSeconds: seconds } })
    assert.equal(response.status, 200)
    assert.ok(response.data.token); assert.ok(response.data.expiresAt > Date.now())
    const parent = await request('/auth/session', { role })
    assert.ok(response.data.expiresAt <= parent.data.expiresAt)
    return response.data.token
  }
  const token = await issue('reviewer')
  const agent = (path, body) => request('/api/beam/' + path, { token, body })
  assert.equal((await agent('me')).data.id, ids.reviewer)
  result.issuance = { authenticatedHuman: true, credentialReturned: true }
  result.refused = []
  // Both transport doors, all accepted body encodings, with and without a cookie.
  for (const role of [undefined, 'reviewer']) for (const encoding of ['json', 'urlencoded', 'multipart']) {
    for (const path of ['/api/beam/revision.decide', '/app/do/revision.decide', '/api/beam/agent.issue']) {
      const r = await request(path, { token, role, encoding, body: { revision, decision: 'publish' } })
      assert.equal(r.status, 403, `${path} ${encoding} cookie=${!!role}: ${r.data?.error ?? r.errorText ?? 'non-JSON'}`)
      result.refused.push({ path, encoding, coPresentCookie: !!role, status: r.status })
    }
  }
  for (const encoding of ['json', 'urlencoded', 'multipart']) {
    const r = await request('/api/beam/revision.decide', { role: 'reviewer', encoding, body: { revision, decision: 'publish' } })
    assert.equal(r.status, 403)
  }
  for (const path of ['/api/beam/person.roles', '/api/beam/assignment.create', '/api/beam/offline.record', '/api/beam/proposal.decide']) assert.equal((await request(path, { token, role: 'owner', body: {} })).status, 403)
  for (const path of ['/app', '/app/courses', '/auth/session', '/setup']) assert.equal((await request(path, { token, role: 'owner' })).status, 403)
  for (const path of ['/auth/signout', '/app/do/course.create', '/app/do/agent.issue']) assert.equal((await request(path, { token, role: 'owner', body: {} })).status, 403)
  const forgedCookie = `operator_session_local=${token}`
  assert.equal((await request('/api/beam/me', { cookie: forgedCookie })).status, 401)
  for (const invalid of ['invalid', token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')]) assert.equal((await request('/api/beam/me', { token: invalid, role: 'owner' })).status, 401)
  assert.equal((await api('reviewer', `revisions/${revision}`)).revision.state, 'in_review')
  // Preparation works with the restricted token and real stored source bytes.
  const source = await api('author', 'source.create', { title: 'Agent input', licence: 'owned', licenceEvidence: 'Owned procedure', provenance: 'Business author', reviewer: ids.reviewer, file: file('procedure.txt', 'Agent preparation source bytes') })
  const download = await fetch(h.origin + `/api/beam/source-files/${source.versionId}`, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(download.status, 200); assert.equal(await download.text(), 'Agent preparation source bytes')
  const draft = (await agent(`courses/${c.id}`)).data
  const proposal = { course: c.id, draftVersion: draft.draftVersion, inputs: [source.versionId], summary: 'Prepared from owned procedure', agent: 'Scoped preparation agent', draft: draft.draft }
  const stale = await agent('proposal.create', proposal)
  assert.equal(stale.status, 200)
  const edited = await agent('course.details', { course: c.id, draftVersion: draft.draftVersion, title: draft.title, summary: 'Prepared edit' })
  assert.equal(edited.status, 200)
  await api('reviewer', 'proposal.decide', { proposal: stale.data.id, decision: 'accept' }, 409)
  const fresh = await agent('proposal.create', { ...proposal, draftVersion: edited.data.draftVersion })
  assert.equal(fresh.status, 200)
  await api('reviewer', 'proposal.decide', { proposal: fresh.data.id, decision: 'accept' })
  assert.equal((await api('reviewer', `courses/${c.id}`)).publishedRevision, c.revision)
  result.preparation = { sourceRead: true, draftEdit: edited.status, staleProposalDenied: true, freshProposalAccepted: true, publishedRevisionUnchanged: true }
  // Roles are read again for the same token; it never gains manager capabilities.
  await api('owner', 'person.roles', { email: 'reviewer@example.test', roles: ['learner'] })
  assert.deepEqual((await agent('me')).data.roles, ['learner'])
  const revokedHuman = await h.submit('revision.decide', cookies.reviewer, { revision, decision: 'publish' })
  assert.ok(revokedHuman.searchParams.get('error'))
  assert.equal((await api('author', `revisions/${revision}`)).revision.state, 'in_review')
  result.revokedHumanReviewerRefused = true
  assert.equal((await agent(`courses/${c.id}`)).status, 403)
  assert.equal((await agent('proposal.create', proposal)).status, 403)
  await api('owner', 'person.roles', { email: 'reviewer@example.test', roles: ['reviewer', 'author'] })
  assert.equal((await agent(`courses/${c.id}`)).status, 200)
  const short = await issue('author', 1)
  await new Promise(resolve => setTimeout(resolve, 1100))
  assert.equal((await request('/api/beam/me', { token: short, role: 'owner' })).status, 401)
  const signout = await issue('author')
  assert.equal((await request('/auth/signout', { role: 'author', body: {} })).status, 204)
  assert.equal((await request('/api/beam/me', { token: signout, role: 'owner' })).status, 401)
  cookies.author = await h.signIn('author@example.test')
  await api('owner', 'person.access', { email: 'reviewer@example.test', status: 'inactive' })
  assert.equal((await agent('me')).status, 401)
  await api('owner', 'person.access', { email: 'reviewer@example.test', status: 'active' })
  assert.equal((await agent('me')).status, 401)
  cookies.reviewer = await h.signIn('reviewer@example.test')
  await publish(revision)
  result.lifecycle = { liveRolesEnforced: true, tokenExpired: true, signoutRevoked: true, accessRemovalRevoked: true, reactivationDidNotRevive: true, humanNamedReviewerPublished: true }
  return result
}
