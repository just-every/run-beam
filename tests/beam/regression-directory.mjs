import assert from 'node:assert/strict'
import { file } from './harness.mjs'

// ORG-001: a US roster imported through People adds a person with an employee id and mobile number but no email and
// adopts existing people by their email; edits go through the People form; a signed-in person's email change keeps
// their record and sign-in, an unused invitation follows the new address; a leaver's row rehires the same person with
// their learning kept; a conflicting external id is held until resolved; history is kept; field visibility follows
// ct's 08:48Z rule; the audit never stores a mobile number or custom value; a custom role reaches a directory location.
export async function directoryCheck(f) {
  const { api, h, cookies, ids, course, assign } = f
  const csv = rows => rows.map(row => row.map(cell => /[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell).join(',')).join('\r\n')
  const roster = lines => api('owner', 'people.import', { file: file('roster.csv', csv([['Employee ID', 'Name', 'Preferred name', 'Email', 'Mobile', 'Language', 'Employment', 'Manager employee ID', 'Role', 'Department', 'Location', 'Hire date', 'Team', 'Uniform size'], ...lines]), 'text/csv') })
  const uniform = (await api('owner', 'person.field', { label: 'Uniform size' })).id
  await assign(await course('Directory handover'))
  const before = (await api('learner', 'records/me')).assignments.length

  // Import: two existing people adopt employee ids by email; Rosa has an employee id and a mobile number but no email.
  const first = await roster([
    ['E100', 'learner', 'Lee', 'learner@example.test', '+1 512 555 0100', 'English', 'active', 'E200', 'Line cook', 'Kitchen', 'Austin, TX', '2024-03-01', '', 'Medium-Tall'],
    ['E200', 'manager', '', 'manager@example.test', '', 'English', 'active', '', 'Kitchen manager', 'Kitchen', 'Denver, CO', '2021-06-14', '', ''],
    ['E300', 'Rosa Diaz', 'Rosa', '', '+1 (303) 555-0142', 'Spanish', 'active', 'E200', 'Prep cook', 'Kitchen', 'Denver, CO', '2026-09-28', 'Regression floor', ''],
  ])
  assert.deepEqual([first.created.length, first.updated.length, first.conflicts.length, first.errors], [1, 2, 0, []])
  const rosa = first.created[0]
  const people = await api('owner', 'people')
  const rosaRow = people.members.find(member => member.id === rosa)
  assert.deepEqual([rosaRow.email, rosaRow.employeeId, rosaRow.status, rosaRow.teams], [null, 'E300', null, [ids.team]])
  assert.match((await h.raw('/app/people', { cookie: cookies.owner }).then(response => response.text())), /ID E300 · no work email/)
  const rosaRecord = await api('owner', `directory/${rosa}`)
  assert.deepEqual([rosaRecord.person.mobile, rosaRecord.person.language, rosaRecord.person.manager.id], ['+1 (303) 555-0142', 'Spanish', ids.manager])
  // Without a work email nobody can be invited yet (ORG-011 sign-in is not offered).
  assert.equal((await api('owner', 'person.access', { member: rosa, status: 'active' }, 409)).error, 'no_work_email')

  // Visibility: the manager reads their team's people without mobile, hire date or custom fields; the person reads
  // their whole record; someone outside their teams reads nothing.
  const managed = await api('manager', `directory/${ids.learner}`)
  assert.deepEqual([managed.person.employeeId, managed.person.location, managed.person.jobRole, 'mobile' in managed.person, 'hireDate' in managed.person, managed.person.custom, 'history' in managed], ['E100', 'Austin, TX', 'Line cook', false, false, [], false])
  await api('owner', 'person.field', { field: uniform, label: 'Uniform size', managersRead: true })
  assert.deepEqual((await api('manager', `directory/${ids.learner}`)).person.custom, [{ id: uniform, label: 'Uniform size', value: 'Medium-Tall' }])
  const own = await api('learner', `directory/${ids.learner}`)
  assert.deepEqual([own.person.mobile, own.person.hireDate, own.editable], ['+1 512 555 0100', '2024-03-01', false])
  await api('author', `directory/${ids.learner}`, undefined, 404)
  await api('learner', 'person.directory', { member: ids.learner, preferredName: 'Leo' }, 403)
  await api('manager', 'person.directory', { member: ids.learner, preferredName: 'Leo' }, 403)

  // Edit through the People form; a signed-in person's work email changes, their sign-in email stays theirs to change.
  const edited = await h.submit('person.directory', cookies.owner, { member: ids.learner, name: 'learner', employeeIdSent: 'yes', employeeId: 'E100', emailSent: 'yes', email: 'lee.learner@example.test', employment: 'active', departmentSent: 'yes', department: 'Front of house' }, `/app/records/${ids.learner}`)
  assert.equal(edited.searchParams.get('error'), null)
  const changed = await api('owner', `directory/${ids.learner}`)
  assert.deepEqual([changed.person.email, changed.person.department, changed.signIn.email, changed.signIn.matches], ['lee.learner@example.test', 'Front of house', 'learner@example.test', false])
  assert.equal((await api('learner', 'me')).id, ids.learner)
  assert.equal((await api('learner', 'records/me')).assignments.length, before)
  assert.match(await h.raw(`/app/records/${ids.learner}`, { cookie: cookies.owner }).then(response => response.text()), /Signs in as learner@example\.test/)

  // An unused invitation follows the new address; the old one no longer reaches the person.
  const casey = (await api('owner', 'person.invite', { email: 'casey@example.test', name: 'Casey Ortiz', roles: ['learner'] })).id
  assert.equal((await api('owner', 'person.directory', { member: casey, email: 'casey.ortiz@example.test' })).signIn, 'invitation_resent')
  assert.equal((await h.api('me', await h.signIn('casey.ortiz@example.test', { requested: true }))).id, casey)
  assert.equal((await h.api('me', await h.signIn('casey@example.test', { requested: true }), undefined, 403)).error, 'not_a_member')

  // Rehire: the leaver's row leaves, then the same employee id returns active; learning stays on the same person.
  assert.deepEqual((await roster([['E100', 'learner', 'Lee', '', '', '', 'terminated', '', '', '', '', '', '', '']])).updated, [ids.learner])
  const back = await roster([['E100', 'learner', 'Lee', '', '', '', 'active', '', '', '', '', '2026-10-05', '', '']])
  assert.deepEqual([back.rehired, back.created], [[ids.learner], []])
  assert.equal((await api('owner', `records/${ids.learner}`)).assignments.length, before)
  assert.equal((await api('owner', `directory/${ids.learner}`)).person.hireDate, '2026-10-05')

  // Conflicts: E300's row carries the manager's email, and a new id carries the learner's: nothing changes, both wait.
  const held = await roster([['E300', 'Rosa Diaz', 'Rosa', 'manager@example.test', '', '', 'active', '', '', 'Front of house', '', '', '', ''], ['E900', 'Lee Learner', '', 'lee.learner@example.test', '', '', 'active', '', '', '', '', '', '', '']])
  assert.deepEqual(held.conflicts.map(conflict => conflict.reason), ['employee_id_and_email_differ', 'email_has_other_employee_id'])
  assert.deepEqual([(await api('owner', `directory/${rosa}`)).person.email, (await api('owner', `directory/${rosa}`)).person.department, (await api('owner', 'people')).members.some(member => member.employeeId === 'E900')], [null, 'Kitchen', false])
  const waiting = (await api('owner', 'directory')).conflicts
  assert.equal(waiting.length, 2)
  assert.match(await h.raw('/app/people', { cookie: cookies.owner }).then(response => response.text()), /Roster conflicts/)
  assert.equal((await h.submit('people.conflict', cookies.owner, { conflict: held.conflicts[0].id, decision: 'apply' }, '/app/people')).searchParams.get('error'), null)
  await api('owner', 'people.conflict', { conflict: held.conflicts[1].id, decision: 'dismiss' })
  const resolved = await api('owner', `directory/${rosa}`)
  assert.deepEqual([resolved.person.email, resolved.person.department, (await api('owner', 'directory')).conflicts.length], [null, 'Front of house', 0])
  assert.deepEqual(resolved.history.map(event => event.action).slice(0, 3), ['person.conflict.resolve', 'person.directory', 'person.conflict'])
  // Retained history on the learner: the email change and the rehire.
  const history = (await api('owner', `directory/${ids.learner}`)).history
  assert.ok(history.some(event => event.action === 'person.rehire') && history.some(event => event.detail.email?.from === 'learner@example.test' && event.detail.email?.to === 'lee.learner@example.test'))
  // The audit names changed fields and the employee id, never a mobile number or a custom value.
  const audit = JSON.stringify((await api('owner', 'audit?category=access')).events)
  assert.ok(audit.includes('mobile number') && audit.includes('E300') && !audit.includes('555') && !audit.includes('Medium-Tall'))

  // ORG-010 with ORG-001: a custom role limited to a location reaches the people there only.
  const role = (await api('owner', 'role.save', { name: 'Austin trainers', permissions: ['people'], locations: ['Austin, TX'] })).id
  await api('owner', 'role.grant', { role, member: ids.other })
  assert.deepEqual((await api('other', 'people')).members.map(member => member.id), [ids.learner])
  await api('other', `directory/${ids.learner}`, undefined, 404)
}
