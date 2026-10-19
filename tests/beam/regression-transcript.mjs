import assert from 'node:assert/strict'

// REPORT-003 (transcript): a learner's transcript lists, in time order, the assignment with its exact revision, a due-date
// exception, the completion and its certificate, and a repeated completion after reassignment; its definitions (time
// zone, as-of, what is included, count) accompany the page and every CSV row, and formula-like course names stay inert.
// The learner reads their own; their manager reads it; another learner is refused. A larger cohort with formula-like
// names exports in full as CSV and XLSX, with the definitions alongside and no formula anywhere.
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
  const transcriptBook = await h.raw(`/app/records/${ids.learner}/transcript.xlsx`, { cookie: cookies.manager })
  const transcriptBytes = Buffer.from(await transcriptBook.arrayBuffer()).toString('latin1')
  assert.ok(transcriptBook.status === 200 && transcriptBytes.startsWith('PK') && transcriptBytes.includes('Definitions') && transcriptBytes.includes('=SUM(A1) safety walk') && !transcriptBytes.includes('<f>'))

  // A larger cohort with formula-like names: every row in the report, its CSV and its XLSX, with the definitions.
  // Two formula-like names join the fixture's people (more invitations would meet the sign-in rate limit).
  const named = []
  for (let n = 1; n <= 2; n++) named.push((await api('owner', 'person.invite', { email: `cohort${n}@example.test`, name: `=HYPERLINK("x") ${n}`, roles: ['learner'] })).id)
  const cohort = [...named, ids.learner, ids.assessor, ids.other, ids.author, ids.reviewer, ids.manager]
  const cohortTeam = await f.team('Cohort', cohort)
  await api('manager', 'assignment.create', { course: c.id, teams: [cohortTeam], dueDate: '2030-12-01' })
  const report = await api('manager', `report?course=${c.id}&team=${cohortTeam}`)
  const total = report.rows.length
  assert.ok(total >= cohort.length && new Set(report.rows.map(row => row.learner)).size === cohort.length)
  const reportCsv = (await (await h.raw(`/app/reports.csv?course=${c.id}&team=${cohortTeam}`, { cookie: cookies.manager })).text()).trim().split('\r\n')
  assert.ok(reportCsv.length === total + 1 && reportCsv[0].endsWith('As of (UTC),Business time zone,Filters') && reportCsv.slice(1).every(line => line.endsWith('course: =SUM(A1) safety walk; team: Cohort; status: all')))
  assert.equal(reportCsv.filter(line => line.startsWith(`"'=HYPERLINK(""x"")`)).length, 2)
  const book = await h.raw(`/app/reports.xlsx?course=${c.id}&team=${cohortTeam}`, { cookie: cookies.manager })
  assert.match(book.headers.get('content-type'), /spreadsheetml\.sheet/)
  const bytes = Buffer.from(await book.arrayBuffer()).toString('latin1')
  assert.ok(bytes.startsWith('PK') && !bytes.includes('<f>') && bytes.includes('<t xml:space="preserve">=HYPERLINK(&quot;x&quot;) 2</t>') && bytes.includes(`<t xml:space="preserve">Rows</t></is></c><c r="B6"><v>${total}</v>`))
  await api('learner', `report?course=${c.id}`, undefined, 403)
  assert.equal((await h.raw('/app/reports.xlsx', { cookie: cookies.learner })).status, 403)
}
