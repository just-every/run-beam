import assert from 'node:assert/strict'
import { file } from './harness.mjs'

// AUTO-003: a team path with hire-relative, prerequisite-relative, fixed and transfer-relative due dates for learners in
// America/Chicago. The write-free preview's instants keep 17:00 local across the March 2027 daylight-saving change;
// assigning sets exactly those instants and says who was not assigned and why; completing the prerequisite sets the
// next course's due date from the completion; transferring a learner assigns the transfer-relative course; a new path
// revision changes later assignments only.
export async function dueDatesCheck(f) {
  const { api, h, cookies, ids, course } = f
  const csv = rows => rows.map(row => row.join(',')).join('\r\n')
  const crew = (await api('owner', 'team.create', { name: 'Due dates crew' })).id
  const roster = await api('owner', 'people.import', { file: file('crew.csv', csv([['Employee ID', 'Name', 'Hire date', 'Time zone', 'Location', 'Team'], ['E2001', 'Hana Hire', '2027-03-10', 'America/Chicago', 'Dallas', 'Due dates crew'], ['E2002', 'Ivan Early', '2027-03-12', 'America/Chicago', 'Dallas', 'Due dates crew'], ['E2003', 'Joe Nohire', '', 'America/Chicago', 'Dallas', 'Due dates crew']]), 'text/csv') })
  const [hana, ivan, joe] = roster.created
  await api('owner', 'team.managers', { team: crew, members: [ids.manager] })
  const [basics, skills, policy, site] = [await course('Crew basics'), await course('Crew line skills'), await course('Crew policy'), await course('Crew site induction')]
  const path = (await api('manager', 'path.create', { name: 'Crew onboarding', team: crew })).id
  await api('manager', 'path.revise', { path, courses: [skills.id], prerequisites: [''], dueAnchors: ['prerequisite'], dueDays: ['7'], renewalDays: [''] }, 400)
  await api('manager', 'path.revise', { path, courses: [basics.id, skills.id, policy.id, site.id], prerequisites: ['', basics.id, '', ''], dueAnchors: ['hire', 'prerequisite', 'fixed', 'transfer'], dueDays: ['3', '7', '', '10'], dueOn: ['', '', '2027-04-01', ''], renewalDays: ['', '', '', ''] })

  // The preview: 17:00 Chicago is 23:00 UTC before 14 March 2027 and 22:00 UTC after; nothing is written.
  const due = (list, learner, c) => list.find(item => item.learner === learner && item.course === c.id)
  const { dues } = await api('manager', 'path.preview', { path })
  assert.deepEqual([due(dues, hana, basics).dueAt, due(dues, ivan, basics).dueAt, due(dues, hana, skills).dueAt, due(dues, hana, policy).dueAt], [Date.UTC(2027, 2, 13, 23), Date.UTC(2027, 2, 15, 22), Date.UTC(2027, 2, 20, 22), Date.UTC(2027, 3, 1, 22)])
  assert.deepEqual([due(dues, joe, basics).skipped, due(dues, joe, skills).skipped, due(dues, joe, policy).dueDate, due(dues, hana, site).skipped], ['no_hire_date', 'no_hire_date', '2027-04-01', 'no_transfer_date'])
  assert.deepEqual((await api('owner', `records/${hana}`)).assignments, [])
  assert.match(await h.raw('/app/paths', { cookie: cookies.manager }).then(response => response.text()), /Due dates if assigned now/)

  // Assigning sets the previewed instants and reports who was not assigned.
  const assigned = await api('manager', 'path.assign', { path })
  assert.equal(assigned.created.length, 7)
  assert.deepEqual(assigned.skipped.filter(item => item.learner === joe).map(item => item.reason).sort(), ['no_hire_date', 'no_hire_date', 'no_transfer_date'])
  const work = async (learner, c) => (await api('owner', `records/${learner}`)).assignments.filter(row => row.course === c.id)
  assert.deepEqual((await work(ivan, basics)).map(row => [row.dueDate, row.dueAt, row.timezone]), [['2027-03-15', Date.UTC(2027, 2, 15, 22), 'America/Chicago']])

  // Completing the prerequisite sets the next course's due date seven local days after the completion.
  await api('owner', 'offline.record', { ...f.offline(basics), learners: [hana] })
  const completedAt = (await api('owner', `records/${hana}`)).completions.find(row => row.course === basics.id).completedAt
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(completedAt)
  const expected = new Date(Date.parse(`${local}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10)
  assert.deepEqual((await work(hana, skills)).map(row => [row.dueDate, row.status]), [[expected, 'open']])
  assert.ok((await api('owner', 'audit?category=due')).events.some(event => event.action === 'assignment.due.prerequisite' && event.detail.from.dueDate === '2027-03-20'))

  // Transferring Ivan dates his transfer today; assigning again gives him the transfer-relative course, due in ten days.
  assert.equal((await h.submit('person.directory', cookies.owner, { member: ivan, locationSent: 'yes', location: 'Austin' }, `/app/records/${ivan}`)).searchParams.get('error'), null)
  const transfer = (await api('owner', `directory/${ivan}`)).person.transferDate
  await api('manager', 'path.assign', { path })
  assert.deepEqual((await work(ivan, site)).map(row => row.dueDate), [new Date(Date.parse(`${transfer}T00:00:00Z`) + 10 * 86_400_000).toISOString().slice(0, 10)])

  // A new revision (basics due 30 days after hire) applies to later assignments only: Joe, once his hire date is
  // known, gets it; Hana's and Ivan's existing work keeps its dates.
  await api('manager', 'path.revise', { path, courses: [basics.id, skills.id, policy.id, site.id], prerequisites: ['', basics.id, '', ''], dueAnchors: ['hire', 'prerequisite', 'fixed', 'transfer'], dueDays: ['30', '7', '', '10'], dueOn: ['', '', '2027-04-01', ''], renewalDays: ['', '', '', ''] })
  await api('owner', 'person.directory', { member: joe, hireDate: '2027-03-10' })
  await api('manager', 'path.assign', { path })
  assert.deepEqual([(await work(joe, basics)).map(row => row.dueDate), (await work(ivan, basics)).map(row => row.dueDate), (await work(hana, basics)).find(row => row.status === 'completed').dueDate], [['2027-04-09'], ['2027-03-15'], '2027-03-13'])
}
