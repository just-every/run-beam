import assert from 'node:assert/strict'
import { file } from './harness.mjs'
import { workbook } from './fixtures.mjs'

// ORG-006: through People the owner uploads a 200-person XLSX roster with a repeated email, an unknown manager, a
// transfer that appears once its Site column is mapped to location, a leaver and email-less rows with usernames. The
// preview writes nothing and sends nothing, and people missing from the file stay unless the owner chooses otherwise.
// Selected rows apply in an interrupted run that resumes; every new person with an email is invited exactly once,
// email-less people are never emailed, managers named further down the file are linked, and applying the batch again,
// or the same file again, changes nothing.
export async function rosterCheck(f) {
  const { api, h, cookies } = f
  const today = new Date().toISOString().slice(0, 10)
  const csv = rows => rows.map(row => row.join(',')).join('\r\n')
  // People already in Beam: one to transfer, one who leaves, one who is missing from the file.
  await api('owner', 'people.import', { file: file('before.csv', csv([['Employee ID', 'Name', 'Location'], ['E1500', 'Tom Transfer', 'Denver'], ['E1501', 'Lea Leaver', 'Denver'], ['E1502', 'Mia Missing', 'Denver']]), 'text/csv') })
  const header = ['Employee ID', 'Name', 'Email', 'Login', 'Mobile', 'Employment', 'Manager employee ID', 'Site']
  const lines = []
  for (let n = 1; n <= 155; n++) lines.push([`E${1000 + n}`, `Worker ${n}`, `worker${n}@roster.test`, '', '', 'active', n > 1 && n < 155 ? 'E1155' : '', 'Austin'])
  for (let n = 156; n <= 195; n++) lines.push([`E${1000 + n}`, `Worker ${n}`, '', `worker.${n}`, `+1 512 555 ${String(n).padStart(4, '0')}`, 'active', 'E1001', 'Austin'])
  lines.push(['E1196', 'Dup One', 'dup@roster.test', '', '', 'active', '', 'Austin'], ['E1197', 'Dup Two', 'dup@roster.test', '', '', 'active', '', 'Austin'], ['E1198', 'Bad Manager', 'bad@roster.test', '', '', 'active', 'E9999', 'Austin'])
  lines.push(['E1500', 'Tom Transfer', '', '', '', 'active', '', 'Round Rock'], ['E1501', 'Lea Leaver', '', '', '', 'terminated', '', 'Denver'])
  assert.equal(lines.length, 200)
  const roster = Buffer.from(workbook([['Roster', [header, ...lines]]]))
  const people = async () => (await api('owner', 'people')).members.length
  const [membersBefore, mailsBefore] = [await people(), h.mails.length]
  const person = async employeeId => { const member = (await api('owner', 'people')).members.find(item => item.employeeId === employeeId); return member && (await api('owner', `directory/${member.id}`)).person }

  // A missing-people policy is explicit: by default Mia stays; choosing to deactivate lists her (and is the owner's).
  const small = file('small.csv', csv([['Employee ID', 'Name'], ['E1500', 'Tom Transfer']]), 'text/csv')
  assert.equal((await api('owner', 'people.batch.preview', { file: small })).rows.some(row => row.action === 'deactivate_missing'), false)
  const strict = await api('owner', 'people.batch.preview', { file: small, missing: 'deactivate' })
  assert.ok(strict.rows.some(row => row.action === 'deactivate_missing' && row.detail.name === 'Mia Missing'))
  await api('manager', 'people.batch.preview', { file: small }, 403)

  // Upload through the People form; columns map by name, and Site waits for a mapping.
  assert.equal((await h.submit('people.batch.preview', cookies.owner, { file: new File([roster], 'roster.xlsx'), invite: 'yes', missing: 'keep' }, '/app/people')).searchParams.get('error'), null)
  let batch = (await api('owner', 'roster-batches')).batches.find(item => item.filename === 'roster.xlsx')
  assert.deepEqual([batch.mapping, batch.counts], [['employeeId', 'name', 'email', 'username', 'mobile', 'employment', 'managerEmployeeId', null], { create: 195, error: 3, unchanged: 1, deactivate: 1 }])
  const preview = await api('owner', 'people.batch.preview', { batch: batch.id, map_7: 'location', invite: true })
  assert.deepEqual(preview.counts, { create: 195, error: 3, transfer: 1, deactivate: 1 })
  const row = line => preview.rows.find(item => item.line === line)
  assert.deepEqual([row(197).detail.errors, row(198).detail.errors, row(199).detail.errors], [['duplicate_email'], ['duplicate_email'], ['invalid_manager']])
  assert.deepEqual([row(2).detail.invite, row(160).detail.invite, row(160).detail.username, row(200).action], [true, false, 'worker.159', 'transfer'])
  assert.match(await h.raw('/app/people', { cookie: cookies.owner }).then(response => response.text()), /Preview of roster\.xlsx/)
  // Nothing was written and nothing was sent.
  assert.deepEqual([await people(), h.mails.length, (await person('E1500')).location, await person('E1001')], [membersBefore, mailsBefore, 'Denver', undefined])

  // Apply all but Lea, stopped after 37 rows, then resumed through the form until done. Base sends at most 30
  // invitations from one address in 15 minutes: people past that limit are added with their invitation waiting, and
  // a later apply (here after the test moves Base's limit window on) sends it.
  const selected = preview.rows.filter(item => !['error', 'unchanged'].includes(item.action) && item.line !== 201).map(item => String(item.seq))
  const nextWindow = () => h.db.prepare('UPDATE oa_limits SET window = window - 1').run()
  await nextWindow()
  const first = await api('owner', 'people.batch.apply', { batch: preview.id, rows: selected, limit: 37 })
  assert.deepEqual([first.applied, first.remaining, first.invitationsWaiting, first.outcomes.created_invited], [37, 159 + first.invitationsWaiting, 37 - first.outcomes.created_invited, first.outcomes.created_invited])
  assert.ok(first.invitationsWaiting > 0 && h.mails.length - mailsBefore === first.outcomes.created_invited)
  assert.match(await h.raw('/app/people', { cookie: cookies.owner }).then(response => response.text()), /invitations wait: Base sends at most 30 invitations/)
  for (let round = 0; round < 20 && !(await api('owner', 'roster-batches')).batches.find(item => item.id === preview.id).appliedAt; round++) {
    await nextWindow()
    assert.equal((await h.submit('people.batch.apply', cookies.owner, { batch: preview.id }, '/app/people')).searchParams.get('error'), null)
  }
  const sent = h.mails.slice(mailsBefore)
  const recipients = sent.map(mail => [mail.to].flat()[0])
  assert.deepEqual([sent.length, new Set(recipients).size, recipients.every(address => /^worker\d+@roster\.test$/.test(address))], [155, 155, true])
  batch = (await api('owner', 'roster-batches')).batches.find(item => item.id === preview.id)
  assert.deepEqual([batch.rows.find(item => item.line === 201).outcome, batch.rows.filter(item => item.outcome === 'created_invited').length, batch.rows.filter(item => item.outcome === 'created').length], ['not_selected', 155, 40])

  // The people as the file said: Tom transferred today, Worker 159 has a username and mobile and no email, managers
  // named further down the file are linked, Lea was not selected and stays.
  const [tom, worker159, worker2, lea] = [await person('E1500'), await person('E1159'), await person('E1002'), await person('E1501')]
  assert.deepEqual([tom.location, tom.transferDate, worker159.email, worker159.username, worker159.mobile, worker159.manager.employeeId, worker2.manager.employeeId, lea.employment], ['Round Rock', today, null, 'worker.159', '+1 512 555 0159', 'E1001', 'E1155', 'active'])
  assert.equal(await people(), membersBefore + 195)

  // Applying the batch again, and the same file again (Lea still unselected), change nothing and send nothing.
  assert.equal((await api('owner', 'people.batch.apply', { batch: preview.id })).alreadyApplied, true)
  const again = await api('owner', 'people.batch.preview', { file: file('roster.xlsx', roster), invite: true, map_7: 'location' })
  assert.deepEqual(again.counts, { unchanged: 196, error: 3, deactivate: 1 })
  const reapplied = await api('owner', 'people.batch.apply', { batch: again.id, rows: [] })
  assert.deepEqual([reapplied.applied, reapplied.done, h.mails.length - mailsBefore, await people()], [0, true, 155, membersBefore + 195])

  // Lea's deactivation applies on its own once selected: she is marked as left; Mia, missing from every file, stays.
  const leaving = await api('owner', 'people.batch.preview', { file: file('leaver.csv', csv([['Employee ID', 'Name', 'Employment'], ['E1501', 'Lea Leaver', 'terminated']]), 'text/csv') })
  assert.equal((await api('owner', 'people.batch.apply', { batch: leaving.id })).outcomes.deactivated, 1)
  assert.deepEqual([(await person('E1501')).employment, (await person('E1502')).employment], ['terminated', 'active'])
}

// Saved employer mappings produce ordinary, owner-reviewed roster batches without unattended writes.
export async function rosterFeedCheck(f) {
  const { api, h } = f
  const headers = ['Employee', 'Name', 'Site', 'Employment']
  const mapping = ['employeeId', 'name', 'location', 'employment']
  const settings = { name: 'Paylocity roster', headers, mapping, intervalMinutes: 60, terminationLimit: 25 }
  await api('manager', 'roster-feed.create', settings, 403)
  await api('owner', 'roster-feed.create', { ...settings, automatic: true }, 409)
  const feed = (await api('owner', 'roster-feed.create', settings)).id
  await api('manager', 'roster-feeds', undefined, 403)
  const upload = rows => file('synthetic-beam-roster.csv', [headers, ...rows].map(row => row.join(',')).join('\n'), 'text/csv')
  const person = async () => (await api('owner', 'people')).members.find(row => row.employeeId === 'synthetic-beam-7')
  const originalMailCount = h.mails.length
  const firstFile = upload([['synthetic-beam-7', 'Frontline colleague', 'Austin', 'active']])
  await api('manager', 'roster-feed.receive', { feed, file: firstFile }, 403)
  const first = await api('owner', 'roster-feed.receive', { feed, file: firstFile })
  assert.deepEqual([first.state, first.reason, await person(), h.mails.length], ['held', 'review_required', undefined, originalMailCount])
  const duplicate = await api('owner', 'roster-feed.receive', { feed, file: firstFile })
  assert.deepEqual([duplicate.id, duplicate.batch, duplicate.replayed], [first.id, first.batch, true])
  await api('owner', 'people.batch.apply', { batch: first.batch })
  const member = (await person()).id
  const xlsx = await api('owner', 'roster-feed.receive', { feed, file: file('synthetic-beam-roster.xlsx', workbook([['Roster', [headers, ['synthetic-beam-7', 'Frontline colleague', 'Austin', 'active']]]])) })
  assert.equal(xlsx.reason, 'review_required')
  assert.ok(xlsx.batch)
  const moved = await api('owner', 'roster-feed.receive', { feed, file: upload([['synthetic-beam-7', 'Frontline colleague', 'Dallas', 'active']]) })
  assert.equal((await api('owner', `directory/${member}`)).person.location, 'Austin')
  await api('owner', 'people.batch.apply', { batch: moved.batch })
  assert.equal((await api('owner', `directory/${member}`)).person.location, 'Dallas')
  const ambiguous = await api('owner', 'roster-feed.receive', { feed, file: upload([['synthetic-beam-7', 'Frontline colleague', 'Dallas', 'active'], ['synthetic-beam-7', 'Duplicate', 'Dallas', 'active']]) })
  assert.equal(ambiguous.reason, 'ambiguous_or_invalid_rows')
  const leaving = await api('owner', 'roster-feed.receive', { feed, file: upload([['synthetic-beam-7', 'Frontline colleague', 'Dallas', 'terminated']]) })
  assert.equal(leaving.reason, 'mass_terminations')
  assert.equal((await api('owner', `directory/${member}`)).person.employment, 'active')
  const changed = await api('owner', 'roster-feed.receive', { feed, file: file('renamed.csv', 'Worker,Name,Site,Employment\nsynthetic-beam-8,Other,Austin,active\n', 'text/csv') })
  assert.deepEqual([changed.reason, changed.batch], ['schema_changed', null])
  const before = await api('owner', 'roster-feeds')
  assert.equal(before.feeds.find(row => row.id === feed).stale, false)
  // Advance only this feed's last-arrival timestamp to exercise a missed scheduled drop.
  await h.db.prepare('UPDATE beam_roster_feeds SET last_received_at=? WHERE id=?').bind(Date.now() - 61 * 60000, feed).run()
  const stale = await api('owner', 'roster-feeds')
  assert.equal(stale.feeds.find(row => row.id === feed).stale, true)
  assert.equal(stale.receipts.find(row => row.id === first.id).batchState, 'applied')
  assert.equal(h.mails.length, originalMailCount)
  await api('owner', 'people.batch.apply', { batch: leaving.batch })
  assert.equal((await api('owner', `directory/${member}`)).person.employment, 'terminated')
  assert.equal((await api('owner', 'roster-feed.receive', { feed, file: firstFile })).replayed, true)
  assert.equal((await api('owner', `directory/${member}`)).person.employment, 'terminated')
}
