// OPS-007 fixture data is entered through the unchanged historical producer's public doors.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { devKey, enter } from './cli.mjs'
import { procedureV1 } from './fixtures.mjs'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

export async function client(root, origin) {
  const key = await devKey(root)
  const owner = await enter(origin, key, 'owner')
  assert.equal(owner.status, 303, 'OPS-007: owner signs in on the installation')
  const request = (path, cookie, data) => fetch(new URL(path, origin), { redirect: 'manual', method: data === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { cookie } : {}), ...(data === undefined ? {} : { origin, 'content-type': 'application/json' }) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) })
  const api = async (path, data, cookie = owner.cookie) => {
    const response = await request(`/api/beam/${path}`, cookie, data)
    assert.equal(response.status, 200, `OPS-007: ${path} public API succeeds`)
    return response.json()
  }
  const confirm = await fetch(`${origin}/setup`, { method: 'POST', redirect: 'manual', headers: { cookie: owner.cookie, origin, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=yes' })
  assert.equal(confirm.status, 303)
  return { key, owner, request, api }
}

export async function createLegacyData(root, origin) {
  const c = await client(root, origin)
  await c.api('business.configure', { name: 'Sierra Lakes Produce', timezone: 'America/Chicago' })
  const learner = await enter(origin, c.key, 'learner')
  assert.equal(learner.status, 303)
  const learnerId = (await c.api('me', undefined, learner.cookie)).id
  const ownerId = (await c.api('me')).id
  const source = await c.api('source.create', { title: 'Cold storage opening', file: { filename: 'opening.txt', base64: Buffer.from(procedureV1).toString('base64') }, reviewer: ownerId, licence: 'owned', licenceEvidence: 'Written by the training owner', provenance: 'Employer operating procedure' })
  const course = await c.api('course.create', { title: 'Cold storage opening', reviewer: ownerId })
  const lesson = await c.api('course.lesson', { course: course.id, draftVersion: course.draftVersion, title: 'Check the temperature log', body: 'Read the log before opening the cold storage room.', sources: [source.versionId] })
  const revision = await c.api('course.submit', { course: course.id, draftVersion: lesson.draftVersion })
  const published = await fetch(`${origin}/app/do/revision.decide`, { method: 'POST', redirect: 'manual', headers: { cookie: c.owner.cookie, origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ revision: revision.id, decision: 'publish', returnTo: '/app/courses' }) })
  assert.equal(published.status, 303)
  assert.ok(!new URL(published.headers.get('location'), origin).searchParams.has('error'))
  const assignment = (await c.api('assignment.create', { course: course.id, learners: [learnerId], dueDate: '2030-10-01', dueTime: '17:00', timezone: 'America/Chicago' })).created[0]
  for (const row of (await c.api(`assignments/${assignment}`, undefined, learner.cookie)).lessons) await c.api('lesson.complete', { assignment, lesson: row.id }, learner.cookie)
  const completion = (await c.api('records/me', undefined, learner.cookie)).completions.find(row => row.course === course.id)
  assert.ok(completion, 'OPS-007: the historical application created a real completion')
  const link = await c.api('certificate.link', { certificate: completion.certificate }, learner.cookie)
  const app = await c.api('app.issue', { name: 'Roster reporting integration', audience: 'reports.read', expiresInDays: 30 })
  const dashboard = await c.api('dashboard.create', { name: 'Opening training coverage', course: course.id, status: 'all', fields: ['name', 'status'] })
  const share = await c.api('dashboard.link', { dashboard: dashboard.id, viewer: ownerId, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() })
  const key = new URL(share.url, origin).searchParams.get('key')
  assert.equal((await fetch(`${origin}/api/beam/v1/report`, { headers: { authorization: `Bearer ${app.token}` } })).status, 200)
  assert.equal((await c.request(link.path)).status, 200)
  await c.api(`dashboards/${dashboard.id}?key=${key}`)
  return { source, course, completion, app, link, dashboard, share, key, ownerId, ownerCookie: c.owner.cookie, learnerId, digests: [digest(app.token.split('.')[2]), digest(link.id), digest(key)], sourceDigest: digest(procedureV1) }
}

export { digest }
