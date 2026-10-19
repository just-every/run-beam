import assert from 'node:assert/strict'
import { file } from './harness.mjs'

// AUTO-001: through Automation the owner previews a role and location audience that enrolls a course, enables it and
// synchronizes twice without duplicates; HR changes through People and roster imports move people in and out with the
// reason (on leave), a returning person keeps their completion and is not enrolled again, and an exclusion keeps its
// reason. Manager, team, custom-field, hire-date and employment conditions narrow the preview. A LIB-006 requirement
// assigned to the audience applies to a person whose role change moves them into it.
export async function audiencesCheck(f) {
  const { api, h, cookies, ids, course } = f
  const DAY = 86_400_000
  const day = offset => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10)
  const csv = rows => rows.map(row => row.join(',')).join('\r\n')
  const header = ['Employee ID', 'Name', 'Preferred name', 'Email', 'Mobile', 'Language', 'Employment', 'Manager employee ID', 'Role', 'Department', 'Location', 'Hire date', 'Team', 'Shift']
  const roster = lines => api('owner', 'people.import', { file: file('roster.csv', csv([header, ...lines.map(line => line.map(cell => cell.includes(',') ? `"${cell}"` : cell))]), 'text/csv') })
  await api('owner', 'person.field', { label: 'Shift' })
  const shift = (await api('owner', 'directory')).fields.find(item => item.label === 'Shift').id
  const people = await roster([
    ['E700', 'Mo Lee', '', '', '', '', 'active', '', 'Kitchen manager', 'Kitchen', 'Denver, CO', day(-900), '', ''],
    ['E701', 'Ana Ruiz', '', '', '', '', 'active', 'E700', 'Line cook', 'Kitchen', 'Round Rock, TX', day(-10), 'Regression floor', 'Days'],
    ['E702', 'Ben Cho', '', '', '', '', 'active', '', 'Line cook', 'Kitchen', 'Denver, CO', day(-400), '', ''],
    ['E703', 'Cy Park', '', '', '', '', 'active', '', 'Dishwasher', 'Kitchen', 'Round Rock, TX', day(-400), '', ''],
    ['E704', 'Dee Fox', '', '', '', '', 'leave', 'E700', 'Line cook', 'Kitchen', 'Round Rock, TX', day(-10), 'Regression floor', 'Nights'],
  ])
  assert.deepEqual([people.created.length, people.errors], [5, []])
  const [mo, ana, ben, cy] = people.created
  const safety = await course('Round Rock line safety')
  const assignments = async learner => (await api('owner', `records/${learner}`)).assignments.filter(row => row.course === safety.id)
  const audience = async id => (await api('owner', 'audiences')).audiences.find(item => item.id === id)
  const names = list => list.map(item => item.name).sort()

  // Only an administrator saves audiences; the owner saves a role and location rule through the Automation form.
  await api('manager', 'audience.save', { name: 'Mine', jobRoles: ['Line cook'] }, 403)
  assert.equal((await h.submit('audience.save', cookies.owner, { name: 'Round Rock line cooks', jobRoles: 'line cook', locations: 'Round Rock, TX', employment: 'active', course: safety.id, dueDays: '14' }, '/app/automation')).searchParams.get('error'), null)
  const cooks = (await api('owner', 'audiences')).audiences.find(item => item.name === 'Round Rock line cooks').id
  assert.equal((await api('owner', 'audience.state', { audience: cooks, state: 'active' }, 409)).error, 'preview_required')

  // The preview shows who would join (Dee is on leave, Ben is in Denver, Cy washes dishes) and writes nothing.
  const preview = await api('owner', 'audience.preview', { audience: cooks })
  assert.deepEqual([names(preview.joins), preview.joins.map(item => item.outcome), preview.leaves], [['Ana Ruiz'], ['assigned'], []])
  assert.deepEqual(await assignments(ana), [])
  assert.match(await h.raw('/app/automation', { cookie: cookies.owner }).then(response => response.text()), /role line cook; location Round Rock, TX/)

  // Enabling synchronizes; a second run adds and removes nobody and enrolls nobody twice.
  const enabled = await api('owner', 'audience.state', { audience: cooks, state: 'active' })
  assert.deepEqual(names(enabled.sync.joined), ['Ana Ruiz'])
  assert.deepEqual(await api('owner', 'audience.sync', { audience: cooks }).then(run => [run.joined, run.left]), [[], []])
  assert.equal((await assignments(ana)).filter(row => row.status === 'open').length, 1)

  // Ana completes the course, then goes on leave through People: she leaves the audience with that reason and her
  // completion stays.
  await api('owner', 'offline.record', { ...f.offline(safety), learners: [ana] })
  assert.equal((await h.submit('person.directory', cookies.owner, { member: ana, employment: 'leave' }, `/app/records/${ana}`)).searchParams.get('error'), null)
  let view = await audience(cooks)
  assert.deepEqual([names(view.members), view.history.map(item => [item.name, item.leftReason])], [[], [['Ana Ruiz', 'on_leave']]])
  assert.equal((await api('owner', `records/${ana}`)).completions.filter(row => row.course === safety.id).length, 1)

  // Ben transfers to Round Rock in the next roster: he joins and is enrolled, his transfer date is today; synchronizing
  // twice more changes nothing.
  const moved = await roster([['E702', 'Ben Cho', '', '', '', '', 'active', '', '', '', 'Round Rock, TX', '', '', '']])
  assert.deepEqual(moved.audiences.find(run => run.id === cooks).joined.map(item => [item.name, item.outcome]), [['Ben Cho', 'assigned']])
  assert.equal((await api('owner', `directory/${ben}`)).person.transferDate, day(0))
  for (let run = 0; run < 2; run++) assert.deepEqual(await api('owner', 'audience.sync', { audience: cooks }).then(result => [result.joined, result.left]), [[], []])
  assert.equal((await assignments(ben)).length, 1)

  // Ana returns from leave: she rejoins with her completion kept and is not enrolled again.
  const back = await roster([['E701', 'Ana Ruiz', '', '', '', '', 'active', '', '', '', '', '', '', '']])
  assert.deepEqual(back.audiences.find(run => run.id === cooks).joined.map(item => [item.name, item.outcome]), [['Ana Ruiz', 'already_completed']])
  assert.deepEqual((await assignments(ana)).map(row => row.status), ['completed'])

  // A reasoned exclusion takes Ben out and withdraws only his open audience assignment; synchronizing keeps him out.
  assert.equal((await h.submit('audience.exclude', cookies.owner, { audience: cooks, member: ben, reason: 'Certified at his previous employer' }, '/app/automation')).searchParams.get('error'), null)
  assert.deepEqual(await api('owner', 'audience.sync', { audience: cooks }).then(run => run.joined), [])
  view = await audience(cooks)
  assert.deepEqual([names(view.members), view.exclusions.map(item => [item.name, item.reason]), view.history.find(item => item.member === ben).leftReason], [['Ana Ruiz'], [['Ben Cho', 'Certified at his previous employer']], 'excluded'])
  assert.deepEqual((await assignments(ben)).map(row => row.status), ['cancelled'])
  assert.ok((await api('owner', 'audit?category=enrollment')).events.some(event => event.action === 'audience.exclude'))

  // Manager, team, custom field, hire date and employment conditions all narrow the preview.
  const previewOf = async fields => {
    const id = (await api('owner', 'audience.save', { name: `Narrow ${Math.random()}`, managers: [mo], teams: [ids.team], ...fields })).id
    return names((await api('owner', 'audience.preview', { audience: id })).joins)
  }
  assert.deepEqual(await previewOf({ [`custom_${shift}`]: ['Nights'], hiredWithinDays: 30, employment: ['active', 'leave'] }), ['Dee Fox'])
  assert.deepEqual(await previewOf({ [`custom_${shift}`]: ['Nights'], hiredWithinDays: 30 }), [])
  assert.deepEqual(await previewOf({ [`custom_${shift}`]: ['Days', 'Nights'], hiredWithinDays: 30 }), ['Ana Ruiz'])
  assert.deepEqual(await previewOf({ [`custom_${shift}`]: ['Days'], hiredWithinDays: 5 }), [])

  // LIB-006 by role and location: Cy's role change moves him into the audience and the requirement applies to him.
  const card = (await api('owner', 'external.requirement', { name: 'Round Rock food handler card', audiences: [cooks], reviewer: 'manager', reminderDays: 30 })).id
  const applies = async () => (await api('owner', 'external')).people.filter(row => row.requirement === card).map(row => row.learnerName).sort()
  assert.deepEqual(await applies(), ['Ana Ruiz'])
  assert.equal((await h.submit('person.directory', cookies.owner, { member: cy, jobRoleSent: 'yes', jobRole: 'Line cook' }, `/app/records/${cy}`)).searchParams.get('error'), null)
  assert.deepEqual(await applies(), ['Ana Ruiz', 'Cy Park'])
  assert.equal((await api('owner', `directory/${cy}`)).person.transferDate, day(0))
}
