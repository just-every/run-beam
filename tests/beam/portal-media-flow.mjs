import assert from 'node:assert/strict'
import { file } from './harness.mjs'
import { syntheticImage, syntheticAudio, syntheticVideo, pdf } from './fixtures.mjs'
import { sourceProcedureDocx } from './source-fixtures.mjs'

// Loaded by the existing public portal flow; no alternate application or employee authority.
export async function portalMediaFlow(f, portal, foreignPortal) {
  const { api, h, cookies, ids } = f
  const invitation = await api('owner', 'portal.invite', { portal: portal.id, email: 'synthetic-beam-21@example.test', name: 'Partner media learner', sendInvitation: true })
  const cookie = await h.signIn('synthetic-beam-21@example.test', { requested: true })
  const call = (door, body, status = 200, as = cookie) => h.api(`portal/${portal.id}/${door}`, as, body, status)
  await call('claim', { identity: invitation.id })
  await call('consent', { accept: true, noticeVersion: 1 })
  const upload = (filename, bytes) => api('author', 'source.create', { title: filename, licence: 'owned', licenceEvidence: 'Employer-owned training', reviewer: ids.reviewer, provenance: 'Private preparation provenance', file: file(filename, bytes) })
  const originals = [
    ['image', 'synthetic-beam-21.png', syntheticImage, 'image/png'],
    ['audio', 'synthetic-beam-22.mp3', syntheticAudio, 'audio/mpeg'],
    ['video', 'synthetic-beam-23.webm', syntheticVideo, 'video/webm'],
    ['document', 'synthetic-beam-24.pdf', pdf, 'application/pdf'],
  ]
  const sources = []
  for (const [, filename, bytes] of originals) sources.push(await upload(filename, bytes))
  const vtt = 'WEBVTT\n\n00:00.000 --> 00:01.000\nInspect the station.\n'
  const captions = await upload('synthetic-beam-25.vtt', vtt)
  const prepared = await upload('synthetic-beam-26.docx', sourceProcedureDocx)
  const extraction = await api('author', `sources/${prepared.versionId}/extraction`)
  const course = await api('author', 'course.create', { title: 'Partner station induction', reviewer: ids.reviewer })
  let edited = await api('author', 'course.lesson', { course: course.id, draftVersion: course.draftVersion, title: 'Station induction', body: 'Inspect the station before starting work.', sources: [] })
  const lesson = edited.draft.lessons[0].id
  const blocks = [
    { kind: 'text', text: '**Prepare** the station.' },
    { kind: 'table', text: 'Station checks', table: [[{ text: 'Tool', header: true, colSpan: 1, rowSpan: 1 }, { text: 'Condition', header: true, colSpan: 1, rowSpan: 1 }], [{ text: 'Probe', header: false, colSpan: 1, rowSpan: 1 }, { text: 'Clean', header: false, colSpan: 1, rowSpan: 1 }]] },
    { kind: 'check', text: 'Which action comes first?', choices: ['Inspect', 'Ignore'], answer: 0, feedback: 'Inspect before work.' },
    ...originals.map(([kind], index) => ({ kind, text: `${kind} station guide`, source: sources[index].versionId, ...(kind === 'video' ? { captions: { source: captions.versionId, language: 'en-US', label: 'English captions' } } : {}) })),
    { kind: 'image', text: 'Approved extracted station image', source: prepared.versionId, asset: extraction.assets[0].id },
  ]
  for (const content of blocks) edited = await api('author', 'course.block', { course: course.id, draftVersion: edited.draftVersion, lesson, content })
  const revision = (await api('author', 'course.submit', { course: course.id, draftVersion: edited.draftVersion })).id
  await f.publish(revision)
  await api('owner', 'portal.share', { portal: portal.id, revision, confirm: true })
  const enrollment = await call('enroll', { identity: invitation.id, revision }, 200, cookies.owner)
  const study = await call(`learning?enrollment=${enrollment.id}`), approved = study.lessons[0]
  assert.equal(approved.available, true)
  assert.deepEqual(approved.blocks.map(block => block.kind), ['text', 'table', 'check', 'image', 'audio', 'video', 'document', 'image'])
  assert.ok(!JSON.stringify(study).includes('Private preparation provenance'))
  for (const source of [...sources, captions, prepared]) assert.ok(!JSON.stringify(study).includes(source.versionId), 'Source ids are not a portal delivery capability')
  const paths = approved.blocks.slice(3).map(block => `/api/beam/portal/${portal.id}/media?enrollment=${enrollment.id}&lesson=${approved.id}&block=${block.id}`)
  const expected = [...originals.map(([, , bytes, type]) => [bytes, type]), [syntheticImage, 'image/png']]
  for (const [index, path] of paths.entries()) {
    const response = await h.raw(path, { cookie })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), expected[index][1])
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(expected[index][0]))
    for (const wrong of [cookies.owner, cookies.learner]) assert.equal((await h.raw(path, { cookie: wrong })).status, 404)
    assert.equal((await h.raw(path.replace(portal.id, foreignPortal.id), { cookie })).status, 404)
    assert.equal((await h.raw(path + '-missing', { cookie })).status, 404)
    assert.equal((await h.raw(path, { cookie, body: {} })).status, 405)
  }
  const captionPath = paths[2] + '&caption=1'
  const caption = await h.raw(captionPath, { cookie })
  assert.equal(caption.headers.get('content-type'), 'text/vtt; charset=utf-8')
  assert.equal(await caption.text(), vtt)
  assert.equal((await h.raw(paths[0] + '&caption=1', { cookie })).status, 404)
  assert.equal((await h.raw(paths[3] + '&download=1', { cookie })).headers.get('content-disposition').startsWith('attachment;'), true)
  const head = await h.raw(paths[0], { cookie, method: 'HEAD' })
  assert.deepEqual([head.status, await head.text()], [200, ''])
  for (const path of [paths[0], captionPath]) {
    assert.equal((await h.raw(path)).status, 401)
    assert.equal((await h.fetch(path, { headers: { cookie, authorization: 'Bearer synthetic-beam-27' } })).status, 403)
    assert.equal((await h.raw(path, { cookie: `${cookies.owner}; beam_view=synthetic-beam-28` })).status, 403)
  }
  await api('author', 'source.version', { source: sources[0].id, provenance: 'Later original', file: file('synthetic-beam-29.png', Buffer.concat([syntheticImage, Buffer.from('new revision')])) })
  assert.deepEqual(Buffer.from(await (await h.raw(paths[0], { cookie })).arrayBuffer()), syntheticImage, 'Delivery remains bound to the published source version')
  await call('completion', { enrollment: enrollment.id }, 409)
  await call('learning', { enrollment: enrollment.id, lesson: approved.id })
  assert.equal((await call(`completion?enrollment=${enrollment.id}`)).qualified, true)
  await call('consent', { withdraw: true })
  for (const path of [...paths, captionPath]) assert.equal((await h.raw(path, { cookie })).status, 403)
  await call('consent', { accept: true, noticeVersion: 1 })
  assert.equal((await call(`learning?enrollment=${enrollment.id}`)).lessonsRead, 1)
  await api('owner', 'portal.share', { portal: portal.id, revision, confirm: true, revoke: true })
  for (const path of [...paths, captionPath]) assert.equal((await h.raw(path, { cookie })).status, 404)
  await api('owner', 'portal.share', { portal: portal.id, revision, confirm: true })
  return { portal, cookie, enrollment, lesson: approved, paths, captionPath }
}
