import assert from 'node:assert/strict'
import { file } from './harness.mjs'

// LEARN-014: an enrolled learner asks a lesson question with a photo; the photo waits for review and the expert (the
// course's named reviewer) answers, resolves the question and proposes a source-cited lesson update that the reviewer's
// proposal queue holds; the learner sees the answer on My learning. A moderator removes an unsafe attachment, which is
// never served again. A learner of another course and an outsider get not-found through the page, JSON and file doors.
// The learner's completed assignment and its completion evidence are unchanged by all of it.
export async function discussionsCheck(f) {
  const { api, h, cookies, ids, publish } = f
  const person = async (name) => {
    const id = (await api('owner', 'person.invite', { email: `${name}@example.test`, name, roles: ['learner'] })).id
    return { id, cookie: await h.signIn(`${name}@example.test`, { requested: true }) }
  }
  const [wren, xavi] = [await person('wren'), await person('xavi')]
  const as = (who, path, body, status) => h.api(path, who.cookie, body, status)
  const source = await api('author', 'source.create', { title: 'Closing procedure', licence: 'owned', licenceEvidence: 'Owned procedure', provenance: 'Business author', reviewer: ids.reviewer, file: file('closing.txt', 'Lock the back door, then set the alarm.') })
  const c = await api('author', 'course.create', { title: 'Closing up', reviewer: ids.reviewer })
  const draftVersion = (await api('author', 'course.lesson', { course: c.id, draftVersion: c.draftVersion, title: 'Locking up', body: 'Lock the doors.', sources: [source.versionId] })).draftVersion
  await publish((await api('author', 'course.submit', { course: c.id, draftVersion })).id)
  const other = await f.course('Opening up')
  const [wrenAssignment] = (await api('owner', 'assignment.create', { course: c.id, learners: [wren.id], dueDate: '2030-10-01', dueTime: '17:00', timezone: 'UTC' })).created
  await api('owner', 'assignment.create', { course: other.id, learners: [xavi.id], dueDate: '2030-10-01', dueTime: '17:00', timezone: 'UTC' })
  const lesson = (await as(wren, `assignments/${wrenAssignment}`)).lessons[0].id
  assert.match(await h.raw(`/app/learn/${wrenAssignment}/lessons/${lesson}`, { cookie: wren.cookie }).then(response => response.text()), new RegExp(`/app/discussions/${c.id}\\?lesson=${lesson}`))
  await as(wren, 'lesson.complete', { assignment: wrenAssignment, lesson })
  const before = { record: await api('owner', `records/${wren.id}`), assignment: await as(wren, `assignments/${wrenAssignment}`) }

  // Wren asks with a photo; the photo is hers and the moderators' until it is reviewed.
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c50000000049454e44ae426082', 'hex')
  const asked = await as(wren, 'discussion.ask', { course: c.id, lesson, title: 'Which door first?', body: 'Do I lock the back door before the alarm?', file: { filename: 'door.png', base64: png.toString('base64') } })
  assert.equal(asked.attachment.state, 'pending')
  const fileUrl = `/app/files/discussion/${asked.attachment.id}`
  assert.equal((await h.raw(fileUrl, { cookie: wren.cookie })).status, 200)
  assert.equal((await h.raw(fileUrl, { cookie: cookies.learner })).status, 404)
  assert.equal((await as(wren, 'discussion.file', { file: asked.attachment.id, decision: 'approve' }, 403)).error, 'moderators_only')

  // Another course's learner and an unenrolled learner get not-found through every door.
  for (const cookie of [xavi.cookie, cookies.learner]) {
    assert.equal((await h.raw(`/api/beam/discussions/${c.id}`, { cookie })).status, 404)
    assert.equal((await h.raw(`/app/discussions/${c.id}`, { cookie })).status, 404)
    assert.equal((await h.raw('/api/beam/discussion.reply', { cookie, body: { thread: asked.id, body: 'Me too' } })).status, 404)
  }
  assert.equal((await as(xavi, 'discussion.ask', { course: c.id, lesson, title: 'Hi', body: 'Can I see this?' }, 404)).error, 'not_found')

  // The expert sees the waiting question, approves the photo, answers and resolves; Wren sees the answer.
  assert.ok((await api('reviewer', 'discussion-notices')).waiting.some(row => row.id === asked.id))
  await api('reviewer', 'discussion.file', { file: asked.attachment.id, decision: 'approve' })
  const answer = await api('reviewer', 'discussion.reply', { thread: asked.id, body: 'Back door first, then the alarm.' })
  assert.equal(answer.expert, true)
  await as(wren, 'discussion.resolve', { thread: asked.id, answer: answer.post }, 403)
  await api('reviewer', 'discussion.resolve', { thread: asked.id, answer: answer.post })
  assert.ok((await as(wren, 'discussion-notices')).answered.some(row => row.id === asked.id))
  assert.match(await h.raw('/app/learning', { cookie: wren.cookie }).then(response => response.text()), new RegExp(`/app/discussions/${c.id}#thread-${asked.id}`))
  const seen = (await as(wren, `discussions/${c.id}`)).threads.find(row => row.id === asked.id)
  assert.deepEqual([seen.state, seen.answer, seen.posts.map(post => post.expert), seen.posts[0].files.map(item => item.state)], ['resolved', answer.post, [false, true], ['approved']])

  // The expert turns the answer into a proposed lesson update citing the lesson's source version.
  const draft = (await api('reviewer', `discussions/${c.id}`)).draft
  const proposed = await api('reviewer', 'discussion.propose', { thread: asked.id, draftVersion: draft.draftVersion, draftLesson: draft.lessons[0].id, lessonBody: 'Lock the back door first, then set the alarm.', summary: 'Say which door comes first.' })
  const proposal = (await api('reviewer', `courses/${c.id}`)).proposals.find(row => row.id === proposed.proposal)
  assert.deepEqual([proposal.state, proposal.inputs, proposal.draft.lessons[0].body], ['open', [source.versionId], 'Lock the back door first, then set the alarm.'])
  assert.equal((await api('reviewer', `discussions/${c.id}`)).threads.find(row => row.id === asked.id).proposal, proposed.proposal)

  // A later unsafe photo is removed by a moderator (the owner) and is never served, not even to its uploader.
  const unsafe = await as(wren, 'discussion.reply', { thread: asked.id, body: 'Here is the alarm code panel.', file: { filename: 'panel.png', base64: png.toString('base64') } })
  await api('owner', 'discussion.file', { file: unsafe.attachment.id, decision: 'remove', reason: 'Shows the alarm code.' })
  for (const cookie of [wren.cookie, cookies.owner]) assert.equal((await h.raw(`/app/files/discussion/${unsafe.attachment.id}`, { cookie })).status, 404)
  assert.ok((await api('owner', 'audit?category=discussion')).events.some(event => event.action === 'discussion.file.remove' && event.detail.reason === 'Shows the alarm code.'))

  // Discussion never stands in for learning: the completed assignment and its completion are as they were.
  assert.equal(before.record.completions.filter(row => row.course === c.id).length, 1)
  assert.deepEqual({ record: await api('owner', `records/${wren.id}`), assignment: await as(wren, `assignments/${wrenAssignment}`) }, before)
}
