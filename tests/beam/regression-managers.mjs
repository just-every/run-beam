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
