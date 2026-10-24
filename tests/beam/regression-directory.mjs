import assert from 'node:assert/strict'
import { file } from './harness.mjs'

// ORG-001: a US roster imported through People adds a person with an employee id and mobile number but no email and
// adopts existing people by their email; edits go through the People form; a signed-in person's email change keeps
// their record and sign-in; a leaver's row rehires the same person with
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

  // Rehire: the leaver's row leaves, then the same employee id returns active; learning stays on the same person.
  assert.deepEqual((await roster([['E100', 'learner', 'Lee', '', '', '', 'terminated', '', '', '', '', '', '', '']])).updated, [ids.learner])
  const back = await roster([['E100', 'learner', 'Lee', '', '', '', 'active', '', '', '', '', '2026-10-05', '', '']])
  assert.deepEqual([back.rehired, back.created], [[ids.learner], []])
  assert.equal((await api('owner', `records/${ids.learner}`)).assignments.length, before)
  assert.equal((await api('owner', `directory/${ids.learner}`)).person.hireDate, '2026-10-05')
  // Rehire never revives the terminated session; later journeys need a fresh ordinary sign-in.
  await api('learner', 'me', undefined, 401)
  cookies.learner = await h.signIn('learner@example.test')
  assert.equal((await api('learner', 'me')).id, ids.learner)

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
  const audit = JSON.stringify((await api('owner', 'audit?category=access')).events.filter(event => event.action.startsWith('person.') && [ids.learner, rosa].includes(event.subject)))
  assert.ok(audit.includes('mobile number') && audit.includes('E300') && !/555.?01(00|42)/.test(audit) && !audit.includes('Medium-Tall'))

  // ORG-010 with ORG-001: a custom role limited to a location reaches the people there only.
  const role = (await api('owner', 'role.save', { name: 'Austin trainers', permissions: ['people'], locations: ['Austin, TX'] })).id
  await api('owner', 'role.grant', { role, member: ids.other })
  assert.deepEqual((await api('other', 'people')).members.map(member => member.id), [ids.learner])
  await api('other', `directory/${ids.learner}`, undefined, 404)
  // ORG-010: the same reach limits enrollment and reports to the location: the coordinator enrolls and reports on the
  // Austin learner, is refused the Denver manager, and sees no Denver row in the report or its CSV.
  const coordinator = (await api('owner', 'role.save', { name: 'Austin coordinators', permissions: ['enrollment', 'reports'], locations: ['Austin, TX'] })).id
  await api('owner', 'role.grant', { role: coordinator, member: ids.other })
  const austin = await course('Austin site induction')
  const [enrolled] = (await api('other', 'assignment.create', { course: austin.id, learners: [ids.learner], dueDate: '2030-10-01' })).created
  assert.equal((await api('other', 'assignment.create', { course: austin.id, learners: [ids.manager], dueDate: '2030-10-01' }, 403)).error, 'learner_outside_your_team')
  await api('owner', 'assignment.create', { course: austin.id, learners: [ids.manager, rosa], dueDate: '2030-10-01' })
  assert.deepEqual((await api('owner', `report?course=${austin.id}`)).rows.map(row => row.learner).sort(), [ids.learner, ids.manager, rosa].sort())
  assert.deepEqual((await api('other', `report?course=${austin.id}`)).rows.map(row => row.assignment), [enrolled])
  const exported = await (await h.raw(`/app/reports.csv?course=${austin.id}`, { cookie: cookies.other })).text()
  assert.ok(exported.includes('\r\nlearner,Austin site induction') && !exported.includes('Rosa Diaz') && !exported.includes('\r\nmanager,') && exported.trim().split('\r\n').length === 2)
}

// Email-less web identity through the real verifier and Base session admission.
export async function frontlineCheck(f) {
  const { api, h, ids, course } = f
  const issued = await api('owner', 'people.import', { file: file('frontline.csv', 'Employee ID,Name,Team\nsynthetic-beam-1,Frontline learner,Regression floor\n', 'text/csv') })
  const member = issued.created[0]
  assert.ok(member)
  const login = (secret, newPassword, username = 'synthetic-beam-1') => h.raw('/auth/frontline', { body: { username, secret, ...(newPassword ? { newPassword } : {}) } })
  const password = 'synthetic-beam-2-long-password'
  await api('manager', 'frontline.policy', { enabled: true }, 403)
  await api('manager', 'frontline.issue', { member, username: 'synthetic-beam-1' }, 403)
  const defaultIssuedAt = Date.now()
  const credential = await api('owner', 'frontline.issue', { member, username: 'synthetic-beam-1' })
  assert.ok(credential.expiresAt >= defaultIssuedAt + 7 * 86400000 && credential.expiresAt <= Date.now() + 7 * 86400000)
  assert.equal((await login(credential.initialSecret, password)).status, 403)
  await api('owner', 'frontline.policy', { enabled: true })
  assert.equal((await login(credential.initialSecret, '123456')).status, 400)
  const first = await login(credential.initialSecret, password)
  assert.equal(first.status, 200)
  const cookie = first.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  assert.equal((await h.api('me', cookie)).id, member)
  assert.equal((await api('owner', `directory/${member}`)).signIn, null)
  assert.ok(!(await (await h.raw(`/app/records/${member}`, { cookie })).text()).includes('@frontline.invalid'))
  assert.equal((await login(credential.initialSecret, password)).status, 401)
  const c = await course('Frontline learning')
  const draft = await api('author', `courses/${c.id}`)
  const question = await api('author', 'course.question', { course: c.id, draftVersion: draft.draftVersion, prompt: 'What comes first?', choices: 'Check the procedure\nSkip the check', correct: '1' })
  const assessment = await api('author', 'course.assessment', { course: c.id, draftVersion: question.draftVersion, passPercent: 100, maxAttempts: 2 })
  c.revision = (await api('author', 'course.submit', { course: c.id, draftVersion: assessment.draftVersion })).id
  await f.publish(c.revision)
  const assignment = (await api('manager', 'assignment.create', { course: c.id, learners: [member], dueDate: '2030-10-01' })).created[0]
  const view = await h.api(`assignments/${assignment}`, cookie)
  for (const lesson of view.lessons) await h.api('lesson.complete', cookie, { assignment, lesson: lesson.id })
  assert.ok(!(await h.api(`records/${member}`, cookie)).completions.some(value => value.course === c.id))
  await h.api('quiz.submit', cookie, { assignment, [`q_${view.quiz.questions[0].id}`]: ['0'] })
  const record = await h.api(`records/${member}`, cookie)
  const completion = record.completions.find(value => value.course === c.id)
  assert.ok(completion?.certificate)
  assert.equal((await h.raw(`/app/certificates/${completion.certificate}.pdf`, { cookie })).status, 200)
  await api('other', 'frontline.issue', { member }, 403)
  await api('other', 'frontline.unlock', { member }, 403)
  const reset = await api('manager', 'frontline.issue', { member, mode: 'pin' })
  assert.equal((await h.raw('/api/beam/me', { cookie })).status, 401)
  assert.equal((await login(password)).status, 401)
  assert.equal((await login(reset.initialSecret, '12345')).status, 400)
  assert.equal((await login(reset.initialSecret, '123456')).status, 200)
  for (let i = 0; i < 5; i++) assert.equal((await login('synthetic-beam-3')).status, 401)
  assert.equal((await login('123456')).status, 401)
  await api('manager', 'frontline.unlock', { member })
  const unlocked = await login('123456')
  assert.equal(unlocked.status, 200)
  const pinCookie = unlocked.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  await api('owner', 'frontline.policy', { pinEnabled: false })
  assert.equal((await h.raw('/api/beam/me', { cookie: pinCookie })).status, 401)
  assert.equal((await login('123456')).status, 403)
  await api('owner', 'frontline.policy', { pinEnabled: true })
  assert.equal((await h.raw('/api/beam/me', { cookie: pinCookie })).status, 401, 'enabling a method never revives a revoked session')
  const renewed = await login('123456')
  assert.equal(renewed.status, 200)
  const account = await (await h.raw('/auth/session', { cookie: renewed.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') })).json()
  assert.equal((await h.raw('/auth/operator/role', { cookie: f.cookies.owner, body: { operatorId: account.operator.id, role: 'admin' } })).status, 200)
  assert.equal((await login('123456')).status, 401, 'account administrators keep workplace recovery')
  await api('owner', 'frontline.issue', { member }, 403)
  assert.equal((await h.raw('/auth/operator/role', { cookie: f.cookies.owner, body: { operatorId: account.operator.id, role: 'member' } })).status, 200)
  await api('owner', 'person.access', { member, status: 'inactive' })
  assert.equal((await h.raw('/api/beam/me', { cookie: pinCookie })).status, 401)
  assert.equal((await login('123456')).status, 401)
  await api('owner', 'person.access', { member, status: 'active' })
  await api('owner', 'frontline.policy', { enabled: false })
  assert.equal((await login('123456')).status, 403)
  await api('owner', 'frontline.policy', { enabled: true })
  await api('owner', 'frontline.policy', { passwordEnabled: true, pinEnabled: false, initialDays: 2 })
  assert.equal((await login('123456')).status, 403)
  for (const initialDays of [0, 31]) await api('owner', 'frontline.policy', { initialDays }, 400)
  for (const initialDays of [1, 30]) {
    await api('owner', 'frontline.policy', { initialDays })
    const started = Date.now()
    const bounded = await api('owner', 'frontline.issue', { member })
    assert.ok(bounded.expiresAt >= started + initialDays * 86400000 && bounded.expiresAt <= Date.now() + initialDays * 86400000)
  }
  await api('owner', 'frontline.policy', { initialDays: 2 })
  const issuedAt = Date.now()
  const expiring = await api('owner', 'frontline.issue', { member })
  assert.ok(expiring.expiresAt >= issuedAt + 2 * 86400000 && expiring.expiresAt <= Date.now() + 2 * 86400000)
  await api('owner', 'frontline.policy', { passwordEnabled: false })
  assert.equal((await login(expiring.initialSecret, password)).status, 403)
  await api('owner', 'frontline.policy', { passwordEnabled: true })
  // Put the initial secret at its expiry boundary; admission at or after it must fail.
  await h.db.prepare('UPDATE beam_frontline_credentials SET initial_expires=? WHERE member_id=?').bind(Date.now(), member).run()
  assert.equal((await login(expiring.initialSecret, password)).status, 401)
  const fresh = await api('owner', 'frontline.issue', { member })
  const simultaneous = await Promise.all([login(fresh.initialSecret, password), login(fresh.initialSecret, password)])
  assert.deepEqual(simultaneous.map(value => value.status).sort(), [200, 401])
  await api('owner', 'person.directory', { member, employment: 'terminated' })
  for (const response of simultaneous) if (response.status === 200) assert.equal((await h.raw('/api/beam/me', { cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') })).status, 401)
  await api('owner', 'person.directory', { member, employment: 'active' })
  assert.equal((await login(password)).status, 401)
  const events = (await api('owner', 'audit?category=access')).events
  const audit = JSON.stringify(events)
  assert.ok(events.some(value => value.action === 'frontline.reset' && value.actor === ids.manager && value.subject === member))
  assert.ok(!audit.includes(fresh.initialSecret) && !audit.includes(reset.initialSecret) && !audit.includes(password))
  await api('owner', 'frontline.issue', { member: ids.owner, username: 'owner' }, 403)
  assert.equal((await h.fetch('/auth/frontline', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://elsewhere.invalid' }, body: JSON.stringify({ username: 'synthetic-beam-1', secret: password }) })).status, 403)
  for (let i = 0; i < 31; i++) {
    const response = await h.fetch('/auth/frontline', { method: 'POST', headers: { 'content-type': 'application/json', origin: h.origin, 'CF-Connecting-IP': '192.0.2.1' }, body: JSON.stringify({ username: 'absent', secret: 'synthetic-beam-4' }) })
    assert.equal(response.status, i < 30 ? 401 : 429)
  }
}

export async function portalThemeCheck(f) {
  const { api, h, cookies } = f
  const { syntheticImage } = await import('./fixtures.mjs')
  const settings = { primary: '#173f5f', accent: '#325f8b', signinHeading: 'Sierra Lakes training', signinText: 'Use your workplace identity.', senderName: 'Sierra Lakes Learning' }
  await api('manager', 'theme.save', settings, 403)
  await api('learner', 'theme', undefined, 403)
  const saved = await api('owner', 'theme.save', { ...settings, logo: file('logo.png', syntheticImage), favicon: file('favicon.png', syntheticImage) })
  assert.equal(saved.primary, settings.primary)
  assert.equal(saved.logo.mediaType, 'image/png')
  for (const name of ['primary', 'accent']) {
    const response = await h.raw('/api/beam/theme.save', { cookie: cookies.owner, body: { ...settings, [name]: '#eeeeee' } })
    assert.equal(response.status, 400)
    assert.deepEqual((await response.json()).detail.pair, `${name} and white`)
  }
  await api('owner', 'theme.save', { ...settings, primary: 'red;display:none' }, 400)
  await api('owner', 'theme.save', { ...settings, senderName: 'Injected\r\nBcc: stranger@example.test' }, 400)
  await api('owner', 'theme.save', { ...settings, logo: file('active.svg', '<svg onload="alert(1)"></svg>') }, 400)
  assert.equal((await api('owner', 'theme')).version, saved.version, 'invalid saves leave the admitted theme intact')
  const css = await h.raw('/beam-theme.css')
  assert.equal(css.status, 200)
  assert.match(await css.text(), /background:#173f5f/)
  for (const path of ['/beam-theme/logo', '/beam-theme/favicon']) {
    const response = await h.raw(path)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), syntheticImage)
    assert.equal((await h.raw(path, { method: 'HEAD' })).status, 200)
    assert.equal((await h.raw(path, { body: {} })).status, 405)
  }
  for (const [role, path] of [['owner', '/app/business'], ['learner', '/app/learning'], ['manager', '/app/manage']]) {
    const response = await h.raw(path, { cookie: cookies[role] })
    assert.equal(response.status, 200)
    const html = await response.text()
    assert.match(html, /href="\/beam-theme.css"/)
    assert.match(html, /src="\/beam-theme\/logo"/)
    assert.match(html, /href="\/beam-theme\/favicon"/)
    assert.ok(!response.headers.get('content-security-policy').includes('unsafe-inline'))
  }
  const signin = await (await h.raw('/signin')).text()
  assert.ok(signin.includes(settings.signinHeading) && signin.includes(settings.signinText))
  assert.match(signin, /src="\/beam-theme\/logo"/)
  assert.equal((await h.raw('/api/beam/people')).status, 401, 'public brand images confer no learning authority')
  const c = await f.course('Portal theme safety'), assignment = await f.assign(c)
  await h.db.prepare('UPDATE beam_assignments SET due_at=? WHERE id=?').bind(Date.now() - 3600000, assignment).run()
  await api('owner', 'escalation.policy', { version: 0, enabled: true, reminderHours: 0, managerHours: 48, fallbackHours: 72 })
  await api('owner', 'escalation.run', {})
  const mail = h.mails.findLast(value => value.to.includes('learner@example.test') && value.text?.includes(c.title || 'Portal theme safety'))
  assert.ok(mail)
  assert.equal(mail.from, 'Sierra Lakes Learning <auth@example.test>')
  assert.ok(mail.html.includes('#173f5f') && mail.html.includes('/beam-theme/logo'))
  assert.ok(mail.text.includes(`/app/learn/${assignment}`))
  await f.lessons(assignment)
  const certificate = (await api('learner', 'records/me')).completions.find(value => value.course === c.id).certificate
  const pdf = await h.raw(`/app/certificates/${certificate}.pdf`, { cookie: cookies.learner })
  assert.equal(pdf.status, 200)
  const pdfBytes = Buffer.from(await pdf.arrayBuffer())
  assert.ok(pdfBytes.toString('latin1').includes('0.090 0.247 0.373 RG'), 'certificate uses the admitted primary color')
  const { getDocumentProxy } = await import('unpdf')
  const document = await getDocumentProxy(new Uint8Array(pdfBytes))
  try {
    const page = await document.getPage(1), operators = await page.getOperatorList()
    assert.ok(operators.fnArray.includes(85), 'downloaded certificate contains a decoded employer image')
  } finally { await document.destroy() }
  if (process.argv.includes('--browser')) {
    await f.assign(await f.course('Pending portal learning'))
    await portalThemeBrowserCheck(f, settings)
  }
}

async function portalThemeBrowserCheck(f, settings) {
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const { mkdir } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const directory = process.env.BEAM_EVIDENCE_DIR || 'test-results'
  await mkdir(directory, { recursive: true })
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic', '--ignore-certificate-errors'] })
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true })
      try {
        const page = await context.newPage()
        const visit = async (role, path) => {
          await context.clearCookies()
          if (role) await context.addCookies(f.cookies[role].split('; ').map(cookie => { const at = cookie.indexOf('='); return { name: cookie.slice(0, at), value: cookie.slice(at + 1), url: f.h.origin } }))
          await page.goto(f.h.origin + path)
          await page.locator('h1').waitFor()
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${path} at ${width}`)
          for (const image of await page.locator('img[src="/beam-theme/logo"]').all()) assert.ok(await image.evaluate(element => element.complete && element.naturalWidth > 0))
          await page.screenshot({ path: join(directory, `${width}-portal-${role || 'signin'}.png`), fullPage: true })
        }
        await visit('owner', '/app/business')
        await page.getByLabel('Primary color', { exact: true }).fill('#eeeeee')
        await page.getByRole('button', { name: 'Save theme', exact: true }).click()
        await page.getByRole('alert').waitFor()
        assert.match(await page.getByRole('alert').innerText(), /contrast/)
        await page.getByLabel('Primary color', { exact: true }).fill(settings.primary)
        await page.getByRole('button', { name: 'Save theme', exact: true }).click()
        await page.getByRole('status').waitFor()
        await visit('learner', '/app/learning')
        await visit('manager', '/app/manage')
        const actions = page.locator('summary[data-tooltip]').first()
        await actions.focus()
        assert.equal(await actions.evaluate(element => getComputedStyle(element, '::after').opacity), '1')
        await page.screenshot({ path: join(directory, `${width}-portal-keyboard-tooltip.png`), fullPage: true })
        await actions.evaluate(element => element.blur())
        await actions.hover()
        await page.waitForTimeout(350)
        assert.equal(await actions.evaluate(element => getComputedStyle(element, '::after').opacity), '1')
        await page.screenshot({ path: join(directory, `${width}-portal-hover-tooltip.png`), fullPage: true })
        await visit(null, '/signin')
        assert.equal(await page.locator('h1').innerText(), settings.signinHeading)
      } finally { await context.close() }
    }
  } finally { await browser.close() }
}
