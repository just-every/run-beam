import assert from 'node:assert/strict'

// ORG-004: two team managers assign, report and follow up within their own teams only; cross-team reads and writes and
// an assessment decision without the assessor grant are refused; a due-date exception is reasoned and kept; a temporary
// coverage grant works until it ends.
export async function managersCheck(f) {
  const { api, h, cookies, ids, course } = f
  const page = async (path, role) => { const response = await h.raw(path, { cookie: cookies[role] }); return { status: response.status, text: await response.text() } }
  for (const [name, roles] of [['mara', ['manager']], ['ben', ['manager']], ['pat', ['learner']], ['quinn', ['learner']]]) {
    ids[name] = (await api('owner', 'person.invite', { email: `${name}@example.test`, name: `${name[0].toUpperCase()}${name.slice(1)} Example`, roles })).id
    cookies[name] = await h.signIn(`${name}@example.test`, { requested: true })
  }
  const alpha = (await api('owner', 'team.create', { name: 'Alpha shift' })).id, beta = (await api('owner', 'team.create', { name: 'Beta shift' })).id
  await api('owner', 'team.members', { team: alpha, members: [ids.pat] })
  await api('owner', 'team.members', { team: beta, members: [ids.quinn] })
  assert.equal((await h.submit('team.managers', cookies.owner, { team: alpha, members: ids.mara }, '/app/people')).searchParams.get('error'), null)
  await api('owner', 'team.managers', { team: beta, members: [ids.ben] })
  await api('mara', 'team.members', { team: alpha, members: [ids.pat, ids.quinn] }, 403)

  // Each manager assigns within their own team; the other team is refused, by person and by team.
  const c = await course('Shift handover', true)
  const [pats] = (await api('mara', 'assignment.create', { course: c.id, learners: [ids.pat], dueDate: '2030-10-01' })).created
  assert.equal((await api('mara', 'assignment.create', { course: c.id, learners: [ids.quinn], dueDate: '2030-10-01' }, 403)).error, 'learner_outside_your_team')
  await api('mara', 'assignment.create', { course: c.id, teams: [beta], dueDate: '2030-10-01' }, 403)
  const [quinns] = (await api('ben', 'assignment.create', { course: c.id, teams: [beta], dueDate: '2030-10-01' })).created
  assert.equal((await h.submit('assignment.create', cookies.ben, { course: c.id, learners: ids.pat, dueDate: '2030-10-01' }, '/app/manage')).searchParams.get('error'), 'learner_outside_your_team')

  // Reports, People and Manage show each manager their own team only; another team's filter is refused.
  for (const [role, mine, theirs, team, other] of [['mara', ids.pat, ids.quinn, alpha, beta], ['ben', ids.quinn, ids.pat, beta, alpha]]) {
    const report = await api(role, 'report')
    assert.ok(report.rows.length > 0 && report.rows.every(row => row.learner === mine), role)
    assert.equal((await api(role, `report?team=${other}`, undefined, 403)).error, 'learner_outside_your_team')
    const people = await api(role, 'people')
    assert.deepEqual([people.members.map(row => row.id), people.teams.map(row => row.id)], [[mine], [team]])
    await api(role, `records/${mine}`)
    await api(role, `records/${theirs}`, undefined, 404)
  }
  const csv = await page('/app/reports.csv', 'mara')
  assert.ok(csv.text.includes('Pat Example') && !csv.text.includes('Quinn Example'))
  // The owner's People page sets members, managers, units and roles; a direct manager hands their own team over.
  const ownerPeople = await page('/app/people', 'owner'), maraPeople = await page('/app/people', 'mara')
  assert.ok(ownerPeople.status === 200 && ['Save managers', 'Business units and administrators', 'Custom roles'].every(text => ownerPeople.text.includes(text)))
  assert.ok(maraPeople.status === 200 && maraPeople.text.includes('Hand this team to someone') && !maraPeople.text.includes('Save managers') && !maraPeople.text.includes('Beta shift'))
  const manage = await page('/app/manage?status=open', 'mara')
  assert.ok(manage.status === 200 && manage.text.includes('Pat Example') && !manage.text.includes('Quinn Example'))

  // Cross-team follow-up is refused: the assignment, its cancellation, a reset and a retry.
  await api('mara', `assignments/${quinns}`, undefined, 404)
  await api('mara', 'assignment.cancel', { assignment: quinns, reason: 'Not mine' }, 403)
  await api('mara', 'assignment.reset', { assignment: quinns, reason: 'Not mine' }, 403)
  assert.equal((await api('mara', 'attempt.grant', { assignment: quinns, reason: 'Not mine' }, 403)).error, 'learner_outside_your_team')
  assert.equal((await api('mara', 'attempt.grant', { assignment: pats, reason: 'Within my team' }, 409)).error, 'attempts_remaining')
  // A practical decision needs the separate named-assessor grant, which a manager does not hold.
  for (const lesson of (await api('pat', `assignments/${pats}`)).lessons) await api('pat', 'lesson.complete', { assignment: pats, lesson: lesson.id })
  const attempt = await api('pat', 'practical.submit', { assignment: pats, evidence: 'Handed over the shift log' })
  await api('mara', 'practical.decide', { attempt: attempt.id, decision: 'accepted', note: 'Looks right' }, 403)
  await api('mara', `attempts/${attempt.id}`)
  await api('ben', `attempts/${attempt.id}`, undefined, 404)

  // A due-date exception: reasoned, in the assignment's zone, with the earlier date kept.
  const before = (await api('mara', `assignments/${pats}`)).assignment
  assert.ok((await page(`/app/learn/${pats}`, 'mara')).text.includes('Due date exception'))
  assert.equal((await h.submit('assignment.due', cookies.mara, { assignment: pats, dueDate: '2030-11-15', reason: 'Back from leave on Nov 1' }, `/app/learn/${pats}`)).searchParams.get('error'), null)
  await api('ben', 'assignment.due', { assignment: pats, dueDate: '2030-12-01', reason: 'Not mine' }, 403)
  const moved = await api('pat', `assignments/${pats}`)
  assert.deepEqual(moved.dueExceptions.map(row => [row.previousDueAt, row.dueAt, row.reason, row.approvedBy]), [[before.dueAt, moved.assignment.dueAt, 'Back from leave on Nov 1', ids.mara]])
  assert.ok(moved.assignment.dueAt > before.dueAt && (await api('mara', 'report')).rows.find(row => row.assignment === pats).dueAt === moved.assignment.dueAt)

  // Coverage: Mara hands Alpha to Ben until an instant; Ben follows Pat up until it passes, then loses Alpha everywhere.
  await api('ben', 'team.coverage', { team: alpha, member: ids.ben, expiresAt: new Date(Date.now() + 60_000).toISOString(), reason: 'Self-granted' }, 403)
  const expiresAt = Date.now() + 3000
  await api('mara', 'team.coverage', { team: alpha, member: ids.ben, expiresAt: new Date(expiresAt).toISOString(), reason: 'Mara on leave' })
  await api('ben', `records/${ids.pat}`)
  assert.ok((await api('ben', 'report')).rows.some(row => row.assignment === pats))
  await new Promise(resolve => setTimeout(resolve, expiresAt - Date.now() + 300))
  await api('ben', `records/${ids.pat}`, undefined, 404)
  assert.ok((await api('ben', 'report')).rows.every(row => row.learner === ids.quinn))
  await api('ben', 'assignment.due', { assignment: pats, dueDate: '2030-12-01', reason: 'Too late' }, 403)
  const grants = (await api('owner', 'people')).managers.filter(row => row.team === alpha)
  assert.deepEqual(grants.map(row => [row.member, row.kind, row.state]), [[ids.mara, 'direct', 'active'], [ids.ben, 'coverage', 'expired']])
  // A dated coverage through the form, ended early by the manager who granted it.
  assert.equal((await h.submit('team.coverage', cookies.mara, { team: alpha, member: ids.ben, expiresOn: '2030-01-01', reason: 'Second leave' }, '/app/people')).searchParams.get('error'), null)
  await api('ben', `records/${ids.pat}`)
  const second = (await api('mara', 'people')).managers.find(row => row.kind === 'coverage' && row.state === 'active')
  await api('ben', 'team.coverage.end', { grant: second.id }, 403)
  assert.equal((await h.submit('team.coverage.end', cookies.mara, { grant: second.id }, '/app/people')).searchParams.get('error'), null)
  await api('ben', `records/${ids.pat}`, undefined, 404)
}

// ORG-010: a custom "Site training coordinator" role with enrollment and reports for one site (a business unit until
// ORG-001 brings locations) enrolls and reports there only; another site, provider credentials and publication are
// refused; owner-only and named decisions cannot be ticked; removing reports takes effect in the open session.
export async function customRoleCheck(f) {
  const { api, h, cookies, ids, course } = f
  const page = async (path, role) => { const response = await h.raw(path, { cookie: cookies[role] }); return { status: response.status, text: await response.text() } }
  for (const [name, roles] of [['cora', ['learner']], ['fresno', ['learner']], ['joliet', ['learner']]]) {
    ids[name] = (await api('owner', 'person.invite', { email: `${name}@example.test`, name: `${name[0].toUpperCase()}${name.slice(1)} Person`, roles })).id
    cookies[name] = await h.signIn(`${name}@example.test`, { requested: true })
  }
  const site = async (name, member) => {
    const team = (await api('owner', 'team.create', { name: `${name} crew` })).id
    await api('owner', 'team.members', { team, members: [member] })
    return { team, unit: (await api('owner', 'unit.create', { name: `${name} site`, teams: [team] })).id }
  }
  const [fresno, joliet] = [await site('Fresno', ids.fresno), await site('Joliet', ids.joliet)]
  await api('owner', 'role.save', { name: 'Owner in disguise', permissions: ['enrollment', 'owner'], units: [fresno.unit] }, 400)
  await api('owner', 'role.save', { name: 'Reviewer in disguise', permissions: ['named_reviewer'], units: [fresno.unit] }, 400)
  assert.equal((await h.submit('role.save', cookies.owner, { name: 'Site training coordinator', permissions: ['enrollment', 'reports'], units: fresno.unit }, '/app/people')).searchParams.get('error'), null)
  const role = (await api('owner', 'roles')).roles.find(row => row.name === 'Site training coordinator')
  await api('cora', 'role.grant', { role: role.id, member: ids.cora }, 403)
  assert.equal((await h.submit('role.grant', cookies.owner, { role: role.id, member: ids.cora }, '/app/people')).searchParams.get('error'), null)
  assert.deepEqual((await api('cora', 'me')).permissions.sort(), ['enrollment', 'reports'])

  // Enroll and report at Fresno.
  const c = await course('Forklift refresher')
  const [enrolled] = (await api('cora', 'assignment.create', { course: c.id, teams: [fresno.team], dueDate: '2030-10-01' })).created
  assert.equal((await api('cora', 'assignment.create', { course: c.id, learners: [ids.joliet], dueDate: '2030-10-01' }, 403)).error, 'learner_outside_your_team')
  await api('owner', 'assignment.create', { course: c.id, learners: [ids.joliet], dueDate: '2030-10-01' })
  const report = await api('cora', `report?course=${c.id}`)
  assert.deepEqual(report.rows.map(row => row.assignment), [enrolled])
  assert.equal((await api('cora', `report?team=${joliet.team}`, undefined, 403)).error, 'learner_outside_your_team')
  const csv = await page(`/app/reports.csv?course=${c.id}`, 'cora')
  assert.ok(csv.status === 200 && csv.text.includes('Fresno Person') && !csv.text.includes('Joliet Person'))
  assert.equal((await page('/app/reports', 'cora')).status, 200)
  const coraManage = await page('/app/manage?status=open', 'cora')
  assert.ok(coraManage.status === 200 && coraManage.text.includes('Fresno Person') && !coraManage.text.includes('Joliet Person'))
  // Nothing the role does not tick: people administration, provider credentials, publication.
  await api('cora', 'people', undefined, 403)
  await api('cora', 'person.invite', { email: 'y@example.test', name: 'Y', roles: ['learner'] }, 403)
  for (const path of ['/auth/providers', '/auth/settings/identity', '/app/business']) assert.equal((await page(path, 'cora')).status, 403, path)
  const draft = await api('author', 'course.create', { title: 'Coordinator cannot publish', reviewer: ids.reviewer })
  const lesson = await api('author', 'course.lesson', { course: draft.id, draftVersion: draft.draftVersion, title: 'One', body: 'One.', sources: [] })
  const revision = (await api('author', 'course.submit', { course: draft.id, draftVersion: lesson.draftVersion })).id
  assert.equal((await h.submit('revision.decide', cookies.cora, { revision, decision: 'publish' }, `/app/revisions/${revision}`)).searchParams.get('error'), 'named_reviewer_required')

  // Removing reports reaches the open session on its next request; enrollment stays.
  await api('owner', 'role.save', { role: role.id, name: 'Site training coordinator', permissions: ['enrollment'], units: [fresno.unit] })
  await api('cora', 'report', undefined, 403)
  assert.equal((await page('/app/reports.csv', 'cora')).status, 403)
  await api('cora', 'assignment.cancel', { assignment: enrolled, reason: 'Enrolled the wrong course' })
  // Every save, grant and change is in the audit record (OPS-001), with the permissions before and after.
  const audit = (await h.db.prepare("SELECT action, detail FROM beam_audit WHERE action LIKE 'role.%' AND (subject = ? OR json_extract(detail, '$.role') = ?) ORDER BY id").bind(role.id, role.id).all()).results
  assert.deepEqual(audit.map(row => row.action), ['role.create', 'role.grant', 'role.change'])
  assert.deepEqual(JSON.parse(audit[2].detail).before.permissions, ['enrollment', 'reports'])
}

// ORG-005, auditor half: the owner shares one team's evidence for a period with a time-limited auditor, who reads it
// and downloads its files (each checked on its own), changes nothing, and loses it all when the grant ends.
export async function auditorCheck(f) {
  const { api, h, cookies, ids, course } = f
  const page = async (path, role) => { const response = await h.raw(path, { cookie: cookies[role] }); return { status: response.status, text: await response.text() } }
  const upload = (name, text) => ({ filename: name, base64: Buffer.from(text).toString('base64'), type: 'text/plain' })
  ids.audrey = (await api('owner', 'person.invite', { email: 'audrey@example.test', name: 'Audrey Auditor', roles: ['learner'] })).id
  cookies.audrey = await h.signIn('audrey@example.test', { requested: true })
  // A practical returned once and then accepted: only the accepted evidence completes, so only it is shared.
  const c = await course('Audited lockout', true)
  const [assignment] = (await api('manager', 'assignment.create', { course: c.id, learners: [ids.learner], dueDate: '2030-10-01' })).created
  for (const lesson of (await api('learner', `assignments/${assignment}`)).lessons) await api('learner', 'lesson.complete', { assignment, lesson: lesson.id })
  const first = await api('learner', 'practical.submit', { assignment, evidence: 'First try', file: upload('first.txt', 'first') })
  await api('assessor', 'practical.decide', { attempt: first.id, decision: 'rejected', note: 'Lock missing' })
  const second = await api('learner', 'practical.submit', { assignment, evidence: 'Locked out', file: upload('second.txt', 'second') })
  await api('assessor', 'practical.decide', { attempt: second.id, decision: 'accepted', note: 'Good' })
  const [unshared, shared] = [(await api('learner', `attempts/${first.id}`)).attachment, (await api('learner', `attempts/${second.id}`)).attachment]
  const day = offset => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
  // Someone outside the shared team completes the same course in the same period.
  await api('owner', 'offline.record', { course: c.id, revision: c.revision, learners: [ids.other], heldOn: day(0), instructor: 'Trainer', location: 'Shop floor', attestation: 'Observed the lockout.' })
  const elsewhere = (await api('other', 'records/me')).completions.find(row => row.courseTitle === 'Audited lockout').certificate

  await api('audrey', 'evidence', undefined, 403)
  await api('audrey', 'auditor.grant', { member: ids.audrey, teams: [ids.team], periodFrom: day(-1), periodTo: day(1), expiresOn: day(30) }, 403)
  const expiresAt = Date.now() + 5000
  await api('owner', 'auditor.grant', { member: ids.audrey, teams: [ids.team], periodFrom: day(-1), periodTo: day(1), expiresAt: new Date(expiresAt).toISOString() })
  const evidence = await api('audrey', 'evidence')
  const row = evidence.completions.find(item => item.courseTitle === 'Audited lockout')
  assert.ok(row && row.attachment === shared && row.certificate && evidence.completions.every(item => item.learner === ids.learner))
  assert.equal((await page(`/app/files/attachment/${shared}`, 'audrey')).text, 'second')
  assert.equal((await page(`/app/files/attachment/${unshared}`, 'audrey')).status, 404)
  await api('audrey', `certificates/${row.certificate}`)
  await api('audrey', `certificates/${elsewhere}`, undefined, 404)
  assert.ok((await page('/app/evidence', 'audrey')).text.includes('Audited lockout'))
  // Read-only: no record, report or people, and no write to assessments, completions, people or policy.
  await api('audrey', `records/${ids.learner}`, undefined, 404)
  for (const path of ['report', 'people']) await api('audrey', path, undefined, 403)
  await api('audrey', 'practical.decide', { attempt: second.id, decision: 'rejected', note: 'x' }, 403)
  await api('audrey', 'offline.record', { course: c.id, revision: c.revision, learners: [ids.learner], heldOn: day(0), instructor: 'x', location: 'x', attestation: 'x' }, 403)
  await api('audrey', 'assignment.create', { course: c.id, learners: [ids.learner], dueDate: '2030-10-01' }, 403)
  await api('audrey', 'person.roles', { member: ids.learner, roles: ['manager'] }, 403)
  await api('audrey', 'access.rule', { scope: 'course', target: c.id, kind: 'none' }, 403)
  // After the end, nothing: the list, the file and the certificate.
  await new Promise(resolve => setTimeout(resolve, expiresAt - Date.now() + 300))
  await api('audrey', 'evidence', undefined, 403)
  assert.equal((await page(`/app/files/attachment/${shared}`, 'audrey')).status, 404)
  await api('audrey', `certificates/${row.certificate}`, undefined, 404)
  // Through the form door, then revoked by the owner.
  assert.equal((await h.submit('auditor.grant', cookies.owner, { member: ids.audrey, teams: ids.team, periodFrom: day(-1), periodTo: day(1), expiresOn: day(30) }, '/app/people')).searchParams.get('error'), null)
  await api('audrey', 'evidence')
  const grant = (await api('owner', 'auditors')).find(item => item.state === 'active')
  assert.equal((await h.submit('auditor.revoke', cookies.owner, { grant: grant.id }, '/app/people')).searchParams.get('error'), null)
  await api('audrey', 'evidence', undefined, 403)
}
