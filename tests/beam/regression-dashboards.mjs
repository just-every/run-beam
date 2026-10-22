import assert from 'node:assert/strict'
import { fixture } from './regression-fixture.mjs'
import { formResult } from './form-result.mjs'

// REPORT-002: every shared rendering uses live creator and viewer access; a token never grants authority.
export async function dashboardCheck() {
  const f = await fixture()
  try { await dashboards(f) } finally { await f.h.close() }
}

async function dashboards({ h, cookies, ids, course, lessons }) {
  const api = async (role, path, body, status = 200) => {
    const response = await h.raw('/api/beam/' + path, {cookie: cookies[role], body})
    assert.equal(response.status, status, 'Beam action: ' + path.replace(/key=[a-f0-9]+/g, 'key=[redacted]'))
    if (path === 'dashboard.link' || path.includes('?key=')) assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
    return response.json()
  }
  const html = async (path, role) => {
    const response = await h.raw(path, { ...(role ? { cookie: cookies[role] } : {}) })
    return { status: response.status, text: await response.text(), headers: response.headers }
  }
  const invite = async (key, name, roles = ['learner']) => {
    const email = `${key}@example.test`.toLowerCase()
    ids[key] = (await api('owner', 'person.invite', { email, name, roles })).id
    cookies[key] = await h.signIn(email, { requested: true })
  }
  await invite('dashboardOutside', 'Outside dashboard manager', ['manager'])
  await invite('dashboardAdmin', 'Dashboard unit administrator')
  await invite('dashboardCustom', 'Dashboard report coordinator')
  const outside = (await api('owner', 'team.create', { name: 'Outside dashboard team' })).id
  await api('owner', 'team.members', { team: outside, members: [ids.other] })
  await api('owner', 'team.managers', { team: outside, members: [ids.dashboardOutside] })
  const unit = (await api('owner', 'unit.create', { name: 'Dashboard unit', teams: [ids.team] })).id
  const adminGrant = await api('owner', 'admin.grant', { unit, member: ids.dashboardAdmin })
  const role = await api('owner', 'role.save', { name: 'Dashboard report role', permissions: ['reports'], teams: [ids.team] })
  const customGrant = await api('owner', 'role.grant', { role: role.id, member: ids.dashboardCustom })
  const c = await course('Dashboard selected course', true)
  await api('owner', 'course.unit', { course: c.id, unit })
  const [assignment] = (await api('manager', 'assignment.create', { course: c.id, learners: [ids.learner], dueDate: '2030-10-01', dueTime: '17:00', timezone: 'UTC' })).created
  await api('owner', 'assignment.create', { course: c.id, learners: [ids.other], dueDate: '2030-10-02', dueTime: '17:00', timezone: 'UTC' })
  const fields = ['name', 'course', 'due', 'status', 'completedAt']
  const selection = { name: 'Selected dashboard', course: c.id, team: ids.team, status: 'all', fields }
  for (const creator of ['owner', 'manager', 'dashboardAdmin', 'dashboardCustom']) {
    const created = await api(creator, 'dashboard.create', { ...selection, name: `${creator} saved dashboard` })
    assert.deepEqual((await api(creator, `dashboards/${created.id}`)).filters, { course: c.id, team: ids.team, status: 'all' })
  }
  await api('learner', 'dashboard.create', selection, 403)
  await api('dashboardOutside', 'dashboard.create', selection, 403)
  await api('manager', 'dashboard.create', { ...selection, fields: ['practical'] }, 400)
  await api('manager', 'dashboard.create', { ...selection, fields: [] }, 400)
  const created = await api('manager', 'dashboard.create', selection), id = created.id
  const foreignOrigin = {cookie: cookies.owner, origin: 'https://other.example.test', 'content-type': 'application/json'}
  assert.equal((await h.fetch('/api/beam/dashboard.create', {method: 'POST', headers: foreignOrigin, body: JSON.stringify(selection)})).status, 403)
  assert.equal((await h.fetch('/app/dashboards/link', {method: 'POST', headers: foreignOrigin, body: JSON.stringify({dashboard: id, viewer: ids.manager, expiresAt: new Date(Date.now() + 86_400_000).toISOString()})})).status, 403)
  const named = await api('manager', 'dashboard.share', { dashboard: id, viewer: ids.dashboardAdmin })
  await api('manager', 'dashboard.share', { dashboard: id, viewer: ids.learner }, 403)
  await api('manager', 'dashboard.share', { dashboard: id, viewer: ids.dashboardOutside }, 403)
  await api('dashboardAdmin', 'dashboard.share', { dashboard: id, viewer: ids.owner }, 403)
  await api('dashboardOutside', `dashboards/${id}`, undefined, 404)
  const before = await api('dashboardAdmin', `dashboards/${id}`)
  assert.deepEqual(before.fields, fields)
  assert.deepEqual(Object.keys(before.rows[0]), fields)
  assert.equal(before.rows.length, 1)
  assert.equal(before.rows[0].name, 'learner')
  assert.equal(before.rows[0].completedAt, null)

  // A completion appears on the next read, while saved fields and filters survive tampering with query parameters.
  await lessons(assignment)
  const attempt = await api('learner', 'practical.submit', { assignment, evidence: 'PRIVATE PRACTICAL CONTENT', file: { filename: 'private.txt', type: 'text/plain', base64: Buffer.from('PRIVATE FILE BYTES').toString('base64') } })
  await api('assessor', 'practical.decide', { attempt: attempt.id, decision: 'accepted', note: 'Accepted private evidence' })
  const after = await api('dashboardAdmin', `dashboards/${id}?team=${outside}&status=overdue&fields=practical`)
  assert.deepEqual(after.filters, before.filters)
  assert.equal(after.data, 'live')
  assert.ok(after.asOf >= before.asOf && after.rows[0].completedAt)
  assert.equal(after.rows[0].status, 'completed')
  assert.deepEqual(Object.keys(after.rows[0]), fields)
  const page = await html(`/app/dashboards/${id}`, 'dashboardAdmin')
  assert.equal(page.status, 200)
  assert.equal(page.headers.get('referrer-policy'), 'same-origin')
  assert.ok(page.text.includes('not a snapshot') && page.text.includes('Saved filters:') && page.text.includes('As of'))
  const csv = await html(`/app/dashboards/${id}.csv`, 'dashboardAdmin')
  assert.equal(csv.status, 200)
  assert.ok(csv.text.includes(after.rows[0].course) && csv.text.includes(new Date(after.rows[0].completedAt).toISOString()))
  for (const text of [JSON.stringify(after), page.text, csv.text]) {
    for (const secret of ['PRIVATE PRACTICAL CONTENT', 'PRIVATE FILE BYTES', '/app/files/', '/app/attempts/', '/app/records/', 'bestPercent', 'practical', 'certificateId']) assert.ok(!text.includes(secret))
  }

  // Only selected columns cross JSON, HTML and CSV. A restricted link requires the exact signed-in recipient.
  const narrow = await api('owner', 'dashboard.create', { ...selection, name: 'Course status only', fields: ['course', 'status'] })
  const empty = await api('owner', 'dashboard.create', { ...selection, name: 'No overdue records', status: 'overdue', fields: ['course', 'status'] })
  assert.equal((await api('owner', `dashboards/${empty.id}`)).rows.length, 0)
  const emptyCsv = await html(`/app/dashboards/${empty.id}.csv`, 'owner')
  assert.equal(emptyCsv.status, 200)
  assert.ok(Number.isFinite(Date.parse(emptyCsv.text.split('\r\n')[1].split(',')[2])), 'empty export retains its as-of definition')
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString()
  const beforeLinks = (await api('owner', 'audit?q=dashboard.link')).events.length
  const result = await formResult(h, '/app/dashboards/link', cookies.owner, new URLSearchParams({ dashboard: narrow.id, viewerEmail: 'dashboardadmin@example.test', expiresAt }))
  const resultLink = result.match(/<p class="dashboard-link"><a href="([^"]+)"/)[1].replaceAll('&amp;', '&')
  assert.equal((await html(resultLink, 'dashboardAdmin')).status, 200, 'the redirected result contains a working restricted link')
  assert.equal((await api('owner', 'audit?q=dashboard.link')).events.length, beforeLinks + 1, 'result reload creates no second restricted link')
  await api('owner', 'dashboard.link', { dashboard: narrow.id, viewer: ids.dashboardAdmin, expiresAt: new Date(Date.now() + 91 * 86_400_000).toISOString() }, 400)
  await api('owner', 'dashboard.link', { dashboard: narrow.id, viewer: ids.dashboardAdmin, expiresAt: new Date(Date.now() - 1000).toISOString() }, 400)
  const link = await api('owner', 'dashboard.link', { dashboard: narrow.id, viewer: ids.dashboardAdmin, expiresAt })
  const key = new URL(link.url, h.origin).searchParams.get('key')
  const apiLink = `dashboards/${narrow.id}?key=${key}`
  const narrowJson = await api('dashboardAdmin', apiLink)
  assert.deepEqual(Object.keys(narrowJson.rows[0]), ['course', 'status'])
  await api('dashboardAdmin', `dashboards/${narrow.id}`, undefined, 404)
  await api('owner', apiLink, undefined, 404)
  await api('manager', apiLink, undefined, 404)
  assert.equal((await h.raw(`/api/beam/${apiLink}`)).status, 401)
  const unsigned = await html(link.url)
  assert.equal(unsigned.status, 401)
  assert.equal(unsigned.headers.get('referrer-policy'), 'no-referrer')
  assert.ok(!unsigned.text.includes(key), 'sign-in guidance never forwards the restricted token')
  const narrowHtml = await html(link.url, 'dashboardAdmin')
  const narrowCsv = await html(`/app/dashboards/${narrow.id}.csv?key=${key}`, 'dashboardAdmin')
  assert.equal(narrowHtml.status, 200)
  assert.equal(narrowCsv.status, 200)
  assert.equal(narrowHtml.headers.get('referrer-policy'), 'no-referrer')
  assert.ok(!narrowHtml.text.includes('>learner<') && !narrowHtml.text.includes(new Date(after.rows[0].completedAt).toISOString()))
  assert.ok(!narrowCsv.text.includes('learner') && !narrowCsv.text.includes(new Date(after.rows[0].completedAt).toISOString()))
  const audit = await api('owner', 'audit?q=dashboard.link')
  assert.ok(!JSON.stringify(audit).includes(key), 'audit never retains the reusable link')
  await h.db.prepare('UPDATE beam_dashboard_shares SET expires_at = ? WHERE id = ?').bind(Date.now() - 1, link.id).run()
  await api('dashboardAdmin', apiLink, undefined, 404)
  const expiredHtml = await html(link.url, 'dashboardAdmin')
  assert.equal(expiredHtml.status, 404)
  assert.equal(expiredHtml.headers.get('referrer-policy'), 'no-referrer')
  assert.equal((await html(`/app/dashboards/${narrow.id}.csv?key=${key}`, 'dashboardAdmin')).status, 404)
  const revoked = await api('owner', 'dashboard.link', { dashboard: narrow.id, viewer: ids.dashboardAdmin, expiresAt })
  await api('owner', 'dashboard.share.revoke', { share: revoked.id })
  await api('dashboardAdmin', `dashboards/${narrow.id}${new URL(revoked.url, h.origin).search}`, undefined, 404)

  // Named revocation and current grants affect the next HTML, JSON and download of an existing session.
  await api('owner', 'dashboard.share.revoke', { share: named.id })
  await api('dashboardAdmin', `dashboards/${id}`, undefined, 404)
  await api('manager', 'dashboard.share', { dashboard: id, viewer: ids.dashboardAdmin })
  await api('owner', 'admin.revoke', { grant: adminGrant.id })
  await api('dashboardAdmin', `dashboards/${id}`, undefined, 403)
  assert.equal((await html(`/app/dashboards/${id}`, 'dashboardAdmin')).status, 403)
  assert.equal((await html(`/app/dashboards/${id}.csv`, 'dashboardAdmin')).status, 403)
  await api('manager', 'dashboard.share', { dashboard: id, viewer: ids.dashboardCustom })
  await api('owner', 'role.save', { role: role.id, name: role.name, permissions: ['enrollment'], teams: [ids.team] })
  await api('dashboardCustom', `dashboards/${id}`, undefined, 403)
  await api('owner', 'role.save', { role: role.id, name: role.name, permissions: ['reports'], teams: [ids.team] })
  await api('dashboardCustom', `dashboards/${id}`)
  await api('owner', 'role.revoke', { grant: customGrant.id })
  await api('dashboardCustom', `dashboards/${id}`, undefined, 403)

  // The creator's own team and role are re-read too. Empty common scope is refused, never an empty leak-prone share.
  await api('manager', 'dashboard.share', { dashboard: id, viewer: ids.owner })
  await api('owner', 'team.members', { team: ids.team, members: [] })
  await api('owner', `dashboards/${id}`, undefined, 403)
  assert.equal((await html(`/app/dashboards/${id}.csv`, 'owner')).status, 403)
  await api('owner', 'team.members', { team: ids.team, members: [ids.learner] })
  await api('owner', `dashboards/${id}`)
  await api('owner', 'team.managers', { team: ids.team, members: [] })
  await api('owner', 'person.roles', { member: ids.manager, roles: ['learner'] })
  await api('owner', `dashboards/${id}`, undefined, 403)
  assert.equal((await html(`/app/dashboards/${id}`, 'owner')).status, 403)
  assert.equal((await html(`/app/dashboards/${id}.csv`, 'owner')).status, 403)
  // The owner can immediately revoke a dashboard even after its creator has lost all report authority.
  await api('owner', 'dashboard.revoke', { dashboard: id })
  await api('owner', `dashboards/${id}`, undefined, 404)
  assert.equal((await html(`/app/dashboards/${id}.csv`, 'owner')).status, 404)
  const formCreated = await h.submit('dashboard.create', cookies.owner, { ...selection, name: 'Saved through the form' }, '/app/dashboards/{id}')
  assert.equal(formCreated.searchParams.get('error'), null)
  assert.equal((await html(formCreated.pathname, 'owner')).status, 200)
  assert.equal((await html('/app/dashboards', 'owner')).status, 200)
}

// REPORT-001: requirement coverage over the active roster for a mixed workforce, with a MOVE-009 credit made from
// imported TalentLMS history through the owner's import door. Only the passage of time is moved through the runtime DB.
export async function coverageCheck() {
  const f = await fixture()
  try { await coverage(f) } finally { await f.h.close() }
}

async function coverage(f) {
  const { h, api, cookies, ids, course, request } = f
  const { file } = await import('./harness.mjs'), { workbook } = await import('./fixtures.mjs'), { createHash } = await import('node:crypto')
  const ymd = days => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
  const people = {}
  for (const [name, jobRole, location, employment = 'active'] of [['packer', 'Packer', 'Reno, NV'], ['driver', 'Driver', 'Fresno, CA'], ['seasonal', 'Packer', 'Fresno, CA'], ['cara', 'Picker', 'Reno, NV'], ['old', 'Driver', 'Reno, NV'], ['leaver', 'Picker', 'Fresno, CA', 'leave']]) {
    people[name] = (await api('owner', 'person.invite', { email: `${name}@example.test`, name, roles: ['learner'] })).id
    await api('owner', 'person.directory', { member: people[name], jobRole, location, employment })
  }
  await api('owner', 'person.directory', { member: ids.learner, jobRole: 'Picker', location: 'Fresno, CA' })
  await api('owner', 'team.members', { team: ids.team, members: [ids.learner, ...Object.values(people)] })
  const forklift = await course('Forklift safety')
  const path = (await api('manager', 'path.create', { name: 'Warehouse floor', team: ids.team })).id
  await api('manager', 'path.revise', { path, courses: [forklift.id], dueDays: ['30'] })
  const assign = async learner => (await api('manager', 'assignment.create', { course: forklift.id, learners: [learner], dueDate: '2030-10-01', dueTime: '17:00', timezone: 'UTC' })).created[0]
  const overdue = await assign(ids.learner)
  await h.db.prepare('UPDATE beam_assignments SET due_at = ? WHERE id = ?').bind(Date.now() - 86_400_000, overdue).run()
  const packed = await assign(people.packer)
  cookies.packer = await h.signIn('packer@example.test', { requested: true })
  for (const lesson of (await api('packer', `assignments/${packed}`)).lessons) await api('packer', 'lesson.complete', { assignment: packed, lesson: lesson.id })
  await h.db.prepare('UPDATE beam_completions SET expires_at = ? WHERE assignment_id = ?').bind(Date.now() + 10 * 86_400_000, packed).run()
  await api('owner', 'exception.grant', { assignment: await assign(people.seasonal), kind: 'exemption', endsOn: ymd(60), reason: 'Seasonal role without forklift duty' })

  // TalentLMS history through the owner's import door: one current, one too old for the interval, one unmatched.
  const bundle = Buffer.from(JSON.stringify({ courseList: file('courses.csv', 'ID,Course,Code,Category\r\n301,Forklift safety,FORK,Operations\r\n'), dateFormat: 'YMD', mappings: { 301: forklift.id },
    reports: [{ course: '301', file: file('forklift.xlsx', workbook([['Users', [['User', 'Email', 'Completion date', 'Score'], ['Cara', 'cara@example.test', ymd(-240), 90], ['Old', 'old@example.test', ymd(-900), 80], ['Nobody', 'nobody@example.test', ymd(-240), 85]]]])) }] }))
  const door = async (action, body) => {
    const response = await h.fetch(`/api/operator/import/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: h.origin, 'X-Import-Source': 'talentlms', cookie: cookies.owner }, body: JSON.stringify(body) })
    const value = await response.json()
    assert.equal(response.status, 200, `import ${action}: ${value.error ?? ''}`)
    return value
  }
  const sha = bytes => createHash('sha256').update(bytes).digest('hex')
  const { uploadId } = await door('uploads', { name: 'talentlms.json', bundleSha256: sha(bundle), totalBytes: bundle.length, totalChunks: 1, index: 0, chunkSha256: sha(bundle), base64: bundle.toString('base64') })
  const plan = await door('plan', { uploadId })
  let state = ''
  for (let batch = 0; batch < 50 && state !== 'completed'; batch++) state = (await door('apply', { planId: plan.planId, reviewedFingerprint: plan.fingerprint })).job.state
  assert.equal(state, 'completed')

  // MOVE-009 credit: a write-free preview names each exclusion; only a human owner or unit administrator approves.
  const prep = (await request('/api/beam/agent.issue', { role: 'manager', body: { expiresInSeconds: 600 } })).data.token
  assert.equal((await request('/api/beam/credit.approve', { token: prep, body: { course: forklift.id, intervalDays: 730, reason: 'Agent' } })).status, 403)
  await api('manager', 'credit.approve', { course: forklift.id, intervalDays: 730, reason: 'Not mine' }, 403)
  const preview = await api('owner', 'credit.preview', { course: forklift.id, intervalDays: 730 })
  assert.deepEqual(preview.credit.map(row => row.member), [people.cara])
  assert.deepEqual(preview.excluded.map(row => row.reason).sort(), ['expired', 'unmatched'])
  const decision = await api('owner', 'credit.approve', { course: forklift.id, intervalDays: 730, reason: 'Matches our TalentLMS records' })

  const read = query => api('manager', `coverage${query ?? ''}`)
  const standing = (view, learner) => view.rows.find(row => row.learner === learner && row.course === forklift.id)?.status
  const totals = view => assert.equal(Object.entries(view.summary).reduce((sum, [key, value]) => key === 'required' ? sum : sum + value, 0), view.summary.required, 'statuses add up to the required count')
  let view = await read()
  totals(view)
  assert.deepEqual([ids.learner, people.packer, people.seasonal, people.cara, people.driver, people.old].map(learner => standing(view, learner)), ['overdue', 'expiring', 'exempt', 'current', 'missing', 'missing'])
  assert.equal(standing(view, people.leaver), undefined, 'people on leave are outside the active roster')
  const credited = view.rows.find(row => row.learner === people.cara)
  assert.deepEqual([credited.evidence.label, credited.evidence.decision.reason], ['credited from TalentLMS history', 'Matches our TalentLMS records'])
  assert.ok(credited.evidence.expiresAt > Date.now() + 400 * 86_400_000)
  const creditRecord = await api('manager', `records/${people.cara}`)
  assert.deepEqual([creditRecord.credits[0].source, creditRecord.credits[0].reason, creditRecord.credits[0].state], ['TalentLMS', 'Matches our TalentLMS records', 'current'])
  assert.equal(creditRecord.credits[0].expiresAt, credited.evidence.expiresAt)
  cookies.cara = await h.signIn('cara@example.test', { requested: true })
  assert.deepEqual((await api('cara', 'records/me')).credits, [], 'report-only decision notes do not widen learner reads')
  if (process.env.BEAM_COVERAGE_BROWSER === '1') await coverageBrowserCheck(f, { learner: ids.learner, credited: people.cara })
  assert.equal(view.rows.find(row => row.learner === people.old).importedHistory, 1, 'imported history stays labelled, not current learning')
  const policy = view.groups.requirement.find(entry => entry.id === `path:${path}`)
  assert.ok(policy.effectiveAt && policy.revision === 1 && policy.required === 6)
  assert.deepEqual((await read(`?requirement=${encodeURIComponent(policy.id)}`)).rows.map(row => row.learner).sort(), [ids.learner, ...Object.values(people).filter(id => id !== people.leaver)].sort())
  assert.deepEqual([(await read(`?effective=${ymd(-1)}`)).summary.required, (await read(`?effective=${ymd(0)}`)).summary.required], [0, 6], 'a policy counts from its effective date')
  assert.equal((await read(`?team=${ids.team}`)).summary.required, 6)
  // ORG-001: a custom role holding reports reads coverage but not role or location, and cannot filter by them.
  const role = await api('owner', 'role.save', { name: 'Coverage readers', permissions: ['reports'], teams: [ids.team] })
  await api('owner', 'role.grant', { role: role.id, member: ids.other })
  const custom = await api('other', 'coverage')
  assert.ok(custom.summary.required === 6 && custom.rows.every(row => row.role === null && row.location === null && row.directoryHidden))
  assert.deepEqual([(await api('other', 'coverage?role=Picker')).summary.required, custom.options.roles], [0, []])
  view = await read('?role=Picker')
  assert.deepEqual(view.rows.map(row => row.learner).sort(), [ids.learner, people.cara].sort())
  view = await read(`?location=${encodeURIComponent('Reno, NV')}&status=missing`)
  assert.deepEqual([view.rows.map(row => row.learner), view.summary.required], [[people.old], 3])
  await api('manager', 'coverage?team=foreign', undefined, 403)
  // Drill into the overdue learner: the exact revision-bound record behind the count.
  const record = await api('manager', `records/${ids.learner}`)
  assert.ok(record.assignments.some(row => row.id === overdue && row.state === 'overdue' && row.revisionNumber === 1))

  // The owner's expiring window: 30 days by default; a manager cannot change it; a stale version is refused.
  await api('manager', 'report.window', { days: 7, version: 0 }, 403)
  await api('owner', 'report.window', { days: 7, version: 0 })
  await api('owner', 'report.window', { days: 14, version: 0 }, 409)
  view = await read()
  assert.deepEqual([standing(view, people.packer), view.window.days], ['current', 7])
  assert.equal((await api('manager', 'report')).rows.find(row => row.assignment === packed).status, 'completed', 'the training report uses the same window')
  // A credited person moves to expiring and then missing on the credited expiry.
  const expire = at => h.db.prepare('UPDATE beam_history_credit_people SET expires_at = ? WHERE member_id = ?').bind(at, people.cara).run()
  await expire(Date.now() + 3 * 86_400_000)
  assert.equal(standing(await read(), people.cara), 'expiring')
  await expire(Date.now() - 1000)
  assert.equal(standing(await read(), people.cara), 'missing')
  // Leaving the business takes a person out of every denominator; undoing the credit returns Cara to missing.
  await api('owner', 'person.directory', { member: people.driver, employment: 'terminated' })
  await api('owner', 'credit.undo', { credit: decision.id, reason: 'Wrong course mapping' })
  view = await read()
  totals(view)
  assert.deepEqual([standing(view, people.driver), standing(view, people.cara), view.summary.required], [undefined, 'missing', 5])
  assert.equal((await api('owner', 'history')).filter(row => row.kind === 'completion').length, 3, 'credit decisions never change imported rows')
  assert.equal((await h.raw('/app/coverage?role=Picker', { cookie: cookies.manager })).status, 200)
}

async function coverageBrowserCheck(f, item) {
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const { mkdir } = await import('node:fs/promises'), { join } = await import('node:path')
  const evidence = process.env.BEAM_EVIDENCE_DIR || 'test-results'
  await mkdir(evidence, { recursive: true })
  const browser = await chromium.launch({ ...(process.env.BEAM_BROWSER_EXECUTABLE ? { executablePath: process.env.BEAM_BROWSER_EXECUTABLE } : {}), headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true })
      const page = await context.newPage()
      await context.addCookies(f.cookies.manager.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: f.h.origin })))
      for (const [name, path] of [['coverage', '/app/coverage'], ['coverage-reno', `/app/coverage?location=${encodeURIComponent('Reno, NV')}`], ['record', `/app/records/${item.learner}`], ['credited-record', `/app/records/${item.credited}`]]) {
        await page.goto(`${f.h.origin}${path}`)
        await page.getByRole('heading', { level: 1 }).waitFor()
        if (name === 'credited-record') { await page.getByText('credited from TalentLMS history', { exact: true }).waitFor(); await page.getByText(/Decision by Owner.*Matches our TalentLMS records/).waitFor(); await page.getByText(/Credited until/).waitFor() }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} overflow ${width}`)
        await page.screenshot({ path: join(evidence, `${width}-report-001-${name}.png`), fullPage: true })
      }
      await context.clearCookies()
      await context.addCookies(f.cookies.owner.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: f.h.origin })))
      await page.goto(`${f.h.origin}/app/coverage`)
      await page.getByRole('button', { name: 'Save window', exact: true }).waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `owner window overflow ${width}`)
      await page.screenshot({ path: join(evidence, `${width}-report-001-owner-window.png`), fullPage: true })
      await context.close()
      console.log(`PASS REPORT-001 coverage/drill-down ${width}`)
    }
  } finally { await browser.close() }
}
