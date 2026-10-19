import assert from 'node:assert/strict'

// REPORT-003 (transcript): a learner's transcript lists, in time order, the assignment with its exact revision, a due-date
// exception, the completion and its certificate, and a repeated completion after reassignment; its definitions (time
// zone, as-of, what is included, count) accompany the page and every CSV row, and formula-like course names stay inert.
// The learner reads their own; their manager reads it; another learner is refused.
export async function transcriptCheck(f) {
  const { api, h, cookies, ids, course } = f
  const c = await course('=SUM(A1) safety walk')
  const complete = async assignment => { for (const lesson of (await api('learner', `assignments/${assignment}`)).lessons) await api('learner', 'lesson.complete', { assignment, lesson: lesson.id }) }
  const [first] = (await api('manager', 'assignment.create', { course: c.id, learners: [ids.learner], dueDate: '2030-10-01' })).created
  await api('manager', 'assignment.due', { assignment: first, dueDate: '2030-10-15', reason: 'Back from leave' })
  await complete(first)
  const [second] = (await api('manager', 'assignment.create', { course: c.id, learners: [ids.learner], dueDate: '2031-10-01' })).created
  await complete(second)

  const view = await api('learner', 'transcripts/me')
  const mine = view.entries.filter(entry => entry.course === '=SUM(A1) safety walk')
  assert.deepEqual(mine.map(entry => entry.kind), ['assigned', 'due date changed', 'completion', 'assigned', 'completion'])
  assert.ok(mine.filter(entry => entry.kind === 'completion').every(entry => entry.revision === 1 && /^certificate /.test(entry.detail)))
  assert.ok(mine[1].detail.includes('Back from leave') && mine[1].by === 'manager')
  assert.deepEqual([view.zone, view.count, typeof view.asOf], ['UTC', view.entries.length, 'number'])
  assert.deepEqual((await api('manager', `transcripts/${ids.learner}`)).entries.map(entry => entry.record), view.entries.map(entry => entry.record))
  await api('assessor', `transcripts/${ids.learner}`, undefined, 404)

  const page = await (await h.raw(`/app/records/${ids.learner}/transcript`, { cookie: cookies.manager })).text()
  assert.ok(page.includes('times in UTC') && page.includes(`${view.count} ${view.count === 1 ? 'entry' : 'entries'}, all of them`) && page.includes('due date changed'))
  const csv = await (await h.raw(`/app/records/${ids.learner}/transcript.csv`, { cookie: cookies.manager })).text()
  const rows = csv.trim().split('\r\n')
  assert.ok(rows[0].startsWith('Person,As of (UTC),Time zone,Included,At (UTC),At (UTC),Kind') && rows.length === view.count + 1)
  assert.ok(csv.includes("'=SUM(A1) safety walk") && !csv.includes(',=SUM(A1)'))
}
