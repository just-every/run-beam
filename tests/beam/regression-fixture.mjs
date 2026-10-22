import assert from 'node:assert/strict'
import { harness } from './harness.mjs'
export async function fixture(options) {
  const h = await harness(options), cookies = {}, ids = {}
  try {
    const api = (role, path, body, status = 200) => h.api(path, cookies[role], body, status)
    assert.equal((await h.raw('/auth/bootstrap', { body: { token: h.vars.SETUP_TOKEN, displayName: options?.ownerName ?? 'Owner' } })).status, 303)
    cookies.owner = await h.signIn('owner@example.test')
    ids.owner = (await api('owner', 'me')).id
    await h.raw('/setup', { cookie: cookies.owner, form: new URLSearchParams({ confirm: 'yes' }) })
    await api('owner', 'business.configure', { name: options?.businessName ?? 'Regression training', timezone: 'UTC' })
    for (const [name, roles] of Object.entries({ author: ['author'], reviewer: ['reviewer', 'author'], learner: ['learner'], assessor: ['assessor', 'learner'], other: ['assessor'], manager: ['manager'] })) {
      ids[name] = (await api('owner', 'person.invite', { email: `${name}@example.test`, name: options?.names?.[name] ?? name, roles })).id
      cookies[name] = await h.signIn(`${name}@example.test`, { requested: true })
    }
    // ORG-004: the owner sets a team and its members; the manager manages it and only it.
    async function team(name, members) {
      const id = (await api('owner', 'team.create', { name })).id
      await api('owner', 'team.members', { team: id, members })
      await api('owner', 'team.managers', { team: id, members: [ids.manager] })
      return id
    }
    ids.team = await team('Regression floor', [ids.learner])
    async function publish(revision, fields = {}) {
      const result = await h.submit('revision.decide', cookies.reviewer, { revision, decision: 'publish', ...fields })
      assert.equal(result.searchParams.get('error'), null)
      assert.equal((await api('reviewer', `revisions/${revision}`)).revision.state, 'published')
    }
    async function course(title, practical = false) {
      const c = await api('author', 'course.create', { title, reviewer: ids.reviewer })
      let draftVersion = (await api('author', 'course.lesson', { course: c.id, draftVersion: c.draftVersion, title: 'Procedure', body: 'Perform the owned procedure.', sources: [] })).draftVersion
      if (practical) draftVersion = (await api('author', 'course.assessment', { course: c.id, draftVersion, practicalInstructions: 'Demonstrate the procedure', assessor: ids.assessor })).draftVersion
      const revision = (await api('author', 'course.submit', { course: c.id, draftVersion })).id
      await publish(revision)
      return { id: c.id, revision }
    }
    async function nextRevision(c) {
      const draft = await api('author', `courses/${c.id}`)
      return (await api('author', 'course.submit', { course: c.id, draftVersion: draft.draftVersion })).id
    }
    const assign = async c => (await api('manager', 'assignment.create', { course: c.id, learners: [ids.learner], dueDate: '2030-10-01', dueTime: '17:00', timezone: 'UTC' })).created[0]
    const view = id => api('learner', `assignments/${id}`)
    async function lessons(id) { for (const lesson of (await view(id)).lessons) await api('learner', 'lesson.complete', { assignment: id, lesson: lesson.id }) }
    const offline = (c, revision = c.revision) => ({ course: c.id, revision, learners: [ids.learner], heldOn: '2026-10-01', instructor: 'Trainer', location: 'Office', attestation: 'Observed complete training.' })
    async function request(path, { role, token, body, encoding = 'json', cookie } = {}) {
      let encoded
      const headers = { origin: h.origin, ...(cookie || role ? { cookie: cookie ?? cookies[role] } : {}), ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}) }
      if (body !== undefined) {
        if (encoding === 'json') { headers['content-type'] = 'application/json'; encoded = JSON.stringify(body) }
        else { encoded = encoding === 'multipart' ? new FormData() : new URLSearchParams(); for (const [key, value] of Object.entries(body)) for (const item of [value].flat()) encoded.append(key, item) }
      }
      const res = await h.fetch(path, { method: body === undefined ? 'GET' : 'POST', headers, body: encoded })
      const text = await res.text()
      const safeError = res.status >= 400 ? [token, cookie, cookies[role], ...Object.values(h.vars)].filter(Boolean).reduce((safe, secret) => safe.replaceAll(secret, '[redacted]'), text).slice(0, 1200) : undefined
      return { status: res.status, location: res.headers.get('location'), data: res.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : null, ...(safeError ? { errorText: safeError } : {}) }
    }
    return { h, api, cookies, ids, team, publish, course, nextRevision, assign, view, lessons, offline, request }
  } catch (error) { await h.close(); throw error }
}
