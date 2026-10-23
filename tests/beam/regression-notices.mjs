import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { sessionAnnouncementCheck } from './regression-announcement-sessions.mjs'

// NOTICE-006 (in-app): a manager announces to their team and to a course's learners; each recipient sees it with the
// sender and never the other recipients, replies privately, and only the sender reads the reply; a team outside the
// manager's authority is refused, and the delivery is labelled in-app only.
export async function announcementCheck(f) {
  const { api, h, cookies, ids, course } = f
  const page = async (path, role) => await (await h.raw(path, { cookie: cookies[role] })).text()
  const managerName = (await api('manager', 'me')).name, learnerName = (await api('learner', 'me')).name, assessorName = (await api('assessor', 'me')).name
  const team = await f.team('Announce team', [ids.learner, ids.assessor])
  assert.equal((await h.submit('announcement.send', cookies.manager, { audience: `team:${team}`, title: 'Room change', body: 'Thursday training moves to the back office.' }, '/app/announcements')).searchParams.get('error'), null)
  const sent = (await api('manager', 'announcements')).sent.find(row => row.title === 'Room change')
  assert.equal(sent.recipients, 2)

  // Each recipient sees it with its sender and no recipient list.
  const home = await page('/app/learning', 'learner')
  assert.ok(home.includes('Room change') && home.includes(`From ${managerName}`) && !home.includes(assessorName))
  const received = (await api('learner', 'announcements')).received.find(row => row.id === sent.id)
  assert.ok(received && !('recipients' in received))

  // A private reply: the sender reads it; the other recipient and the owner's audit do not.
  assert.equal((await h.submit('announcement.reply', cookies.learner, { announcement: sent.id, body: 'I will be ten minutes late.' }, '/app/learning')).searchParams.get('error'), null)
  assert.deepEqual((await api('manager', 'announcements')).sent.find(row => row.id === sent.id).replies.map(reply => [reply.learnerName, reply.body]), [[learnerName, 'I will be ten minutes late.']])
  assert.ok((await page('/app/announcements', 'manager')).includes('I will be ten minutes late.'))
  assert.deepEqual((await api('assessor', 'announcements')).received.find(row => row.id === sent.id).replies, [])
  const audit = await api('owner', `audit?q=${sent.id}`)
  assert.ok(audit.events.some(event => event.action === 'announcement.reply' && JSON.stringify(event.detail) === '{}') && !JSON.stringify(audit).includes('ten minutes late'))
  await api('other', 'announcement.reply', { announcement: sent.id, body: 'Not mine' }, 404)

  // To a course's learners in the manager's reach; outside their authority, or as a learner, it is refused.
  const c = await course('Announced course')
  await api('manager', 'assignment.create', { course: c.id, learners: [ids.learner], dueDate: '2030-10-01' })
  const toCourse = await api('manager', 'announcement.send', { audience: `course:${c.id}`, title: 'New lesson', body: 'Lesson 2 is live.' })
  assert.deepEqual([toCourse.recipients, toCourse.delivered, toCourse.notSent], [1, ['in_app'], ['email', 'slack', 'teams']])
  const elsewhere = (await api('owner', 'team.create', { name: 'Not managed' })).id
  await api('owner', 'team.members', { team: elsewhere, members: [ids.other] })
  assert.equal((await api('manager', 'announcement.send', { audience: `team:${elsewhere}`, title: 'x', body: 'y' }, 403)).error, 'learner_outside_your_team')
  await api('learner', 'announcement.send', { audience: `team:${team}`, title: 'x', body: 'y' }, 403)
  await announcementAudienceCheck(f, team)
  await sessionAnnouncementCheck(f)
}

async function announcementAudienceCheck(f, team) {
  const { api, ids } = f
  await api('owner', 'person.directory', { member: ids.learner, location: 'Austin: North' })
  await api('owner', 'person.directory', { member: ids.other, location: 'Austin: North' })
  const cohort = await api('owner', 'audience.save', { name: 'North cohort', locations: ['Austin: North'] })
  await api('owner', 'audience.preview', { audience: cohort.id })
  await api('owner', 'audience.state', { audience: cohort.id, state: 'active' })
  for (const audience of ['location:Austin: North', `cohort:${cohort.id}`]) {
    const notice = await api('manager', 'announcement.send', { audience, title: 'North safety', body: 'Paid work time training in the north room.' })
    assert.equal(notice.recipients, 1)
    assert.ok(!(await api('other', 'announcements')).received.some(row => row.id === notice.id))
    await api('learner', 'announcement.reply', { announcement: notice.id, body: 'North room confirmed.' })
    assert.equal((await api('manager', 'announcements')).sent.find(row => row.id === notice.id).replies.length, 1)
    await api('owner', 'team.managers', { team, members: [] })
    await api('owner', 'team.managers', { team: ids.team, members: [] })
    assert.equal((await api('learner', 'announcements')).received.find(row => row.id === notice.id).repliesOpen, false)
    await api('learner', 'announcement.reply', { announcement: notice.id, body: 'After revocation' }, 403)
    assert.deepEqual((await api('manager', 'announcements')).sent.find(row => row.id === notice.id).replies, [])
    await api('owner', 'team.managers', { team, members: [ids.manager] })
    await api('owner', 'team.managers', { team: ids.team, members: [ids.manager] })
    assert.equal((await api('manager', 'announcements')).sent.find(row => row.id === notice.id).replies.length, 1)
  }
  const snapshot = await api('manager', 'announcement.send', { audience: `cohort:${cohort.id}`, title: 'Saved audience', body: 'Audience at send time.' })
  await api('owner', 'person.directory', { member: ids.assessor, location: 'Austin: North' })
  assert.ok(!(await api('assessor', 'announcements')).received.some(row => row.id === snapshot.id))
  await api('learner', 'announcement.send', { audience: `cohort:${cohort.id}`, title: 'No', body: 'No' }, 403)
  await api('manager', 'announcement.send', { audience: 'location:Outside', title: 'No', body: 'No' }, 409)
  if (process.argv.includes('--browser')) await announcementAudienceBrowser(f, cohort)
  await api('owner', 'audience.state', { audience: cohort.id, state: 'paused' })
  await api('manager', 'announcement.send', { audience: `cohort:${cohort.id}`, title: 'Paused', body: 'No' }, 404)
  assert.equal((await api('learner', 'announcements')).received.find(row => row.id === snapshot.id).repliesOpen, false)
  for (const role of ['learner', 'assessor', 'other']) await api('owner', 'person.directory', { member: ids[role], location: '' })
}

async function announcementAudienceBrowser(f, cohort) {
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const { mkdir } = await import('node:fs/promises')
  const evidence = process.env.BEAM_EVIDENCE_DIR || 'test-results'
  await mkdir(evidence, { recursive: true })
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true })
      try {
        const as = async role => {
          await context.clearCookies()
          await context.addCookies(f.cookies[role].split('; ').map(cookie => { const split = cookie.indexOf('='); return { name: cookie.slice(0, split), value: cookie.slice(split + 1), url: f.h.origin } }))
        }
        await as('manager')
        const page = await context.newPage()
        await page.goto(`${f.h.origin}/app/announcements`)
        const form = page.locator('form[action="/app/do/announcement.send"]')
        assert.ok(await form.locator('option[value="location:Austin: North"]').count())
        await form.getByLabel('To', { exact: true }).selectOption(`cohort:${cohort.id}`)
        await form.getByLabel('Title', { exact: true }).fill(`Cohort training ${width}`)
        await form.getByLabel('Message', { exact: true }).fill('Bring the checklist to paid training.')
        await form.getByRole('button').click()
        await page.waitForURL('**/app/announcements*')
        await page.screenshot({ path: `${evidence}/${width}-announcement-audiences.png`, fullPage: true })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        await as('learner')
        await page.goto(`${f.h.origin}/app/learning`)
        const announcement = page.locator('section.announcement').filter({ has: page.getByRole('heading', { name: `Cohort training ${width}`, exact: true }) })
        await announcement.locator('summary').click()
        await announcement.getByLabel('Your reply', { exact: true }).fill('Checklist ready.')
        await announcement.getByRole('button').click()
        await page.waitForURL('**/app/learning*')
        await page.screenshot({ path: `${evidence}/${width}-announcement-reply.png`, fullPage: true })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        await as('manager')
        await page.goto(`${f.h.origin}/app/announcements`)
        assert.ok(await page.getByText(/Checklist ready/).count())
        await f.api('owner', 'team.managers', { team: f.ids.team, members: [] })
        try {
          await page.reload()
          assert.equal(await page.getByText(/Checklist ready/).count(), 0)
          await page.screenshot({ path: `${evidence}/${width}-announcement-sender-closed.png`, fullPage: true })
          await as('learner')
          await page.goto(`${f.h.origin}/app/learning`)
          const closed = page.locator('section.announcement').filter({ has: page.getByRole('heading', { name: `Cohort training ${width}`, exact: true }) })
          assert.equal(await closed.locator('form').count(), 0)
          assert.ok(await closed.getByText('Replies are closed because the sender no longer has access to this audience.').isVisible())
          await page.screenshot({ path: `${evidence}/${width}-announcement-learner-closed.png`, fullPage: true })
        } finally {
          await f.api('owner', 'team.managers', { team: f.ids.team, members: [f.ids.manager] })
        }
      } finally { await context.close() }
    }
  } finally { await browser.close() }
}

// NOTICE-005's explicitly partial in-app slice: configured completion events,
// real relationship recipients, language templates and private inboxes. Delivered
// email and the remaining event/channel acceptance stay owed in the contract.
export async function notificationRulesCheck(f) {
  const { api, h, cookies, ids, course, lessons } = f
  const first = await course('Safe loading'), second = await course('Safe unloading')
  await api('owner', 'person.directory', { member: ids.learner, location: 'Austin', manager: ids.other })
  const fields = { name: 'Completion to current managers', recipient: 'manager', team: ids.team, location: 'Austin', subject: '{learner_name} completed {course_name}', body: 'Reviewed <em>result</em>. {assignment_link} · due {due_date}', variantLanguage: 'es', variantSubject: '{learner_name} completó {course_name}', variantBody: 'Consulta {assignment_link}.' }
  assert.equal((await h.submit('notification.save', cookies.owner, fields, '/app/notifications')).searchParams.get('error'), null)
  const rules = () => api('owner', 'notification-rules')
  const rule = (await rules()).rules.find(r => r.name === fields.name)
  const inbox = role => api(role, 'notifications')
  const complete = async c => {
    const assignment = (await api('owner', 'assignment.create', { course: c.id, learners: [ids.learner], dueDate: '2030-10-01' })).created[0]
    await lessons(assignment)
    return assignment
  }
  await api('manager', 'notification.save', fields, 403)
  await api('learner', 'notification-rules', undefined, 403)
  await api('owner', 'notification.state', { rule: rule.id, enabled: true }, 409)
  assert.equal((await h.submit('notification.test', cookies.owner, { rule: rule.id }, '/app/notifications')).searchParams.get('error'), null)
  const actualCourses = await api('owner', 'courses')
  assert.ok((await inbox('owner')).some(n => n.test === 1 && actualCourses.some(c => n.subject === `Owner completed ${c.title}`) && n.body.includes('/app/learning')))
  assert.deepEqual(await inbox('manager'), [])
  assert.equal((await h.submit('notification.state', cookies.owner, { rule: rule.id, enabled: 'true' }, '/app/notifications')).searchParams.get('error'), null)
  const initialMails = h.mails.length
  const firstAssignment = await complete(first)
  const initial = await inbox('manager')
  assert.equal(initial.length, 1)
  assert.equal(initial[0].subject, 'learner completed Safe loading')
  assert.equal(initial[0].assignmentId, firstAssignment)
  assert.deepEqual(await inbox('other'), []) // Directory manager_id alone grants no result.
  assert.deepEqual(await inbox('learner'), [])
  let page = await h.raw('/app/learning', { cookie: cookies.manager }).then(r => r.text())
  assert.ok(page.includes('&lt;em&gt;result&lt;/em&gt;') && !page.includes('<em>result</em>'))

  // A manager retains authority through any current team. It ends only when every
  // applicable management grant ends; prior unrelated journeys must not define it.
  const sharedTeam = await f.team('Shared loading crew', [ids.learner])
  await api('owner', 'person.directory', { member: ids.other, language: 'es-MX' })
  await api('owner', 'team.managers', { team: ids.team, members: [ids.other] })
  await complete(second)
  assert.equal((await inbox('manager')).length, 2)
  await api('owner', 'team.managers', { team: sharedTeam, members: [] })
  assert.deepEqual(await inbox('manager'), [])
  let other = await inbox('other')
  assert.equal(other.length, 1)
  assert.equal(other[0].subject, 'learner completó Safe unloading')
  await api('owner', 'notification.replay', { rule: rule.id })
  assert.equal((await inbox('other')).length, 1) // No duplicate and no earlier event reassigned to this manager.
  assert.equal((await h.raw(`/api/beam/notifications/${ids.other}`, { cookie: cookies.learner })).status, 404)
  assert.equal((await h.raw('/app/notifications', { cookie: cookies.manager })).status, 403)

  // Unknown fields fail before any new version is saved.
  const invalid = await api('owner', 'notification.save', { rule: rule.id, version: rule.version, ...fields, variants: { default: { subject: 'Hello', body: '{secret_score}' } } }, 400)
  assert.equal(invalid.error, 'unknown_merge_field')
  assert.equal((await rules()).rules.find(r => r.id === rule.id).version, rule.version)
  // Both location and team filters apply at the event; suppressed events stay suppressed on replay.
  await api('owner', 'person.directory', { member: ids.learner, location: 'Denver' })
  await complete(first)
  assert.equal((await inbox('other')).length, 1)
  await api('owner', 'person.directory', { member: ids.learner, location: 'Austin' })
  await api('owner', 'team.members', { team: ids.team, members: [] })
  await complete(first)
  assert.equal((await inbox('other')).length, 0) // The earlier result is hidden while authority is absent.
  await api('owner', 'team.members', { team: ids.team, members: [ids.learner] })
  await api('owner', 'notification.replay', { rule: rule.id })
  assert.equal((await inbox('other')).length, 1)

  // Editing a message creates a version and switches it off. Course filters apply.
  const edited = await api('owner', 'notification.save', { rule: rule.id, version: rule.version, ...fields, course: second.id })
  assert.equal((await rules()).rules.find(r => r.id === rule.id).enabled, 0)
  await complete(second)
  assert.equal((await inbox('other')).length, 1)
  await api('owner', 'notification.state', { rule: rule.id, enabled: true }, 409)
  await api('owner', 'notification.test', { rule: rule.id })
  await api('owner', 'notification.state', { rule: rule.id, enabled: true })
  await complete(first)
  assert.equal((await inbox('other')).length, 1)

  // An in-app event also obeys AUTO-008's global pause and explicitly replays.
  const policy = (await api('owner', 'automation-controls')).policy
  const savePolicy = fields => api('owner', 'automation.policy', { version: policy.version, paused: !!policy.paused, quietStart: policy.quietStart, quietEnd: policy.quietEnd, dailyLimit: policy.dailyLimit, ...fields })
  const stopped = await savePolicy({ paused: true })
  await complete(second)
  assert.equal((await inbox('other')).length, 1)
  assert.ok((await api('owner', 'automation-controls')).executions.some(e => e.kind === 'notification' && e.outcome === 'paused'))
  await savePolicy({ version: stopped.version, paused: false })
  await api('owner', 'notification.replay', { rule: rule.id })
  const after = await inbox('other')
  assert.ok(after.length >= 2)
  await api('owner', 'notification.replay', { rule: rule.id })
  assert.equal((await inbox('other')).length, after.length)
  assert.equal(h.mails.length, initialMails)
  assert.ok((await api('owner', 'audit?q=notification.in_app')).events.some(e => e.detail.ruleVersion === edited.version && e.detail.channel === 'in_app'))
  assert.ok((await rules()).messages.some(m => m.recipient === ids.other && !m.test))
  // No inactive recipient is added; removing access also ends its live session.
  await api('owner', 'person.access', { member: ids.other, status: 'inactive' })
  const delivered = (await rules()).messages.filter(m => !m.test).length
  await complete(second)
  assert.equal((await rules()).messages.filter(m => !m.test).length, delivered)
  await api('owner', 'person.access', { member: ids.other, status: 'active' })
  cookies.other = await h.signIn('other@example.test')
  await api('owner', 'person.directory', { member: ids.other, language: '' })
  // Restore the fixture's original manager and leave this tested rule off.
  await api('owner', 'notification.state', { rule: rule.id, enabled: false })
  await api('owner', 'team.managers', { team: ids.team, members: [ids.manager] })
  await api('owner', 'person.directory', { member: ids.learner, manager: '', location: '' })

  // Scoped administrators configure a real path notice through the same public doors.
  const unit = await api('owner', 'unit.create', { name: 'Notice unit', teams: [ids.team] })
  const grant = await api('owner', 'admin.grant', { unit: unit.id, member: ids.other })
  const pathCourse = await course('Path safety')
  const path = await api('owner', 'path.create', { name: 'Safety path', team: ids.team })
  const revision = await api('owner', 'path.revise', { path: path.id, courses: [pathCourse.id], dueDays: ['7'] })
  const scopedFields = { name: 'Path completion', recipient: 'learner', team: ids.team, path: path.id, subject: '{course_name} finished', body: 'Paid training: {assignment_link}' }
  await api('other', 'notification.save', { ...scopedFields, team: '' }, 403)
  const outsideTeam = await api('owner', 'team.create', { name: 'Outside notification scope' })
  await api('other', 'notification.save', { ...scopedFields, team: outsideTeam.id }, 403)
  await api('other', 'notification.save', { ...scopedFields, rule: rule.id, version: edited.version, team: outsideTeam.id }, 403)
  const scopedRule = await api('other', 'notification.save', scopedFields)
  assert.equal((await api('other', 'notification-rules')).rules.find(row => row.id === scopedRule.id).path_id, path.id)
  await api('other', 'notification.state', { rule: scopedRule.id, enabled: true }, 409)
  await api('other', 'notification.test', { rule: scopedRule.id })
  assert.ok((await inbox('other')).some(row => row.rule_id === scopedRule.id && row.test))
  await api('other', 'notification.state', { rule: scopedRule.id, enabled: true })
  const pathAssignment = (await api('owner', 'path.assign', { path: path.id })).created[0]
  // Change the current path revision before completion: the assignment's original path still matches.
  await api('owner', 'path.revise', { path: path.id, courses: [pathCourse.id], dueDays: ['9'] })
  assert.equal((await api('owner', `assignments/${pathAssignment}`)).assignment.pathRevision, revision.id)
  await lessons(pathAssignment)
  const pathInbox = async () => (await inbox('learner')).filter(row => row.rule_id === scopedRule.id)
  assert.equal((await pathInbox()).length, 1)
  await complete(pathCourse) // Same course, direct enrollment: not this path.
  assert.equal((await pathInbox()).length, 1)
  await api('other', 'notification.replay', { rule: scopedRule.id })
  assert.equal((await pathInbox()).length, 1)
  if (process.argv.includes('--browser')) await notificationScopeBrowser(f, path, scopedRule)

  // Revocation removes the configuration door and holds future work until explicit authorized replay.
  await api('owner', 'admin.revoke', { grant: grant.id })
  await api('other', 'notification-rules', undefined, 403)
  await api('other', 'notification.replay', { rule: scopedRule.id }, 403)
  const heldAssignment = (await api('owner', 'path.assign', { path: path.id })).created[0]
  await lessons(heldAssignment)
  assert.equal((await pathInbox()).length, 1)
  assert.ok((await api('owner', 'automation-controls')).executions.some(row => row.kind === 'notification' && row.outcome === 'scope_revoked'))
  const custom = await api('owner', 'role.save', { name: 'Scoped notices', permissions: ['notifications'], teams: [ids.team] })
  const customGrant = await api('owner', 'role.grant', { role: custom.id, member: ids.other })
  await api('other', 'notification.state', { rule: scopedRule.id, enabled: true })
  await api('other', 'notification.replay', { rule: scopedRule.id })
  assert.equal((await pathInbox()).length, 2)
  await api('other', 'notification.save', { ...scopedFields, team: outsideTeam.id }, 403)
  await api('owner', 'role.revoke', { grant: customGrant.id })
  await api('other', 'notification.test', { rule: scopedRule.id }, 403)
  await api('owner', 'notification.state', { rule: scopedRule.id, enabled: false })
  await notificationRelationshipCheck(f, unit.id)
}

async function notificationScopeBrowser(f, path, rule) {
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const { mkdir } = await import('node:fs/promises')
  const evidence = process.env.BEAM_EVIDENCE_DIR || 'test-results'
  await mkdir(evidence, { recursive: true })
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true })
      try {
        await context.addCookies(f.cookies.other.split('; ').map(cookie => { const split = cookie.indexOf('='); return { name: cookie.slice(0, split), value: cookie.slice(split + 1), url: f.h.origin } }))
        const page = await context.newPage()
        await page.goto(`${f.h.origin}/app/notifications`)
        const edit = page.locator('form[action="/app/do/notification.save"]').filter({ has: page.locator(`input[name="rule"][value="${rule.id}"]`) })
        await edit.locator('..').locator('summary').click()
        assert.equal(await edit.getByLabel('Path', { exact: true }).inputValue(), path.id)
        await page.evaluate(() => scrollTo(0, 0))
        await page.screenshot({ path: `${evidence}/${width}-notification-scope.png`, fullPage: true })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        const test = page.locator('form[action="/app/do/notification.test"]').filter({ has: page.locator(`input[name="rule"][value="${rule.id}"]`) })
        await test.getByRole('button').click()
        await page.waitForURL('**/app/notifications*')
        await page.goto(`${f.h.origin}/app/learning`)
        assert.ok(await page.locator('#notifications').isVisible())
        await page.screenshot({ path: `${evidence}/${width}-notification-inbox.png`, fullPage: true })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      } finally { await context.close() }
    }
  } finally { await browser.close() }
}

// NOTICE-004: every policy/routing/delivery/resolution assertion uses the Worker
// doors. Only the stored due instant moves to advance the scenario's clock.
export async function escalationCheck(f) {
  const { api, h, ids, course, lessons } = f
  const assign = async c => (await api('owner', 'assignment.create', { course: c.id, learners: [ids.learner], dueDate: '2030-10-01' })).created[0]
  const hour = 3_600_000
  const tick = async () => assert.equal((await h.scheduled()).outcome, 'ok')
  const due = async (id, hours) => h.db.prepare('UPDATE beam_assignments SET due_at=? WHERE id=?').bind(Date.now() - hours * hour, id).run()
  const mails = () => h.mails.filter(mail => mail.subject === 'Overdue learning needs attention')
  const queue = async role => (await api(role, 'queues')).escalations
  const item = async (role, id) => (await queue(role)).find(row => row.assignment === id)
  const policy = { version: 0, enabled: true, reminderHours: 1, managerHours: 3, fallbackHours: 6 }
  await api('manager', 'escalation.policy', policy, 403)
  await api('owner', 'escalation.policy', { ...policy, managerHours: 0 }, 400)
  assert.equal((await api('owner', 'escalation.policy', policy)).version, 1)
  await api('owner', 'escalation.policy', policy, 409)
  await api('learner', 'escalation-policy', undefined, 403)
  await api('manager', 'escalation.run', {}, 403)
  const c = await course('Escalated training'), a = await assign(c)
  const original = (await api('learner', `assignments/${a}`)).assignment
  await due(a, 0.5)
  await tick()
  assert.equal(mails().length, 0, 'no reminder before its delay')
  await due(a, 2)
  await api('owner', 'person.directory', { member: ids.learner, employment: 'leave' })
  await tick()
  assert.equal(mails().length, 0, 'learner reminders pause on leave')
  assert.equal((await item('manager', a)).onLeave, true)
  await api('owner', 'person.directory', { member: ids.learner, employment: 'active' })
  // AUTO-008 per-rule approval is available on this new unattended door too.
  const automation = (await api('owner', 'automation-controls')).policy
  await api('owner', 'automation.policy', { version: automation.version, kind: 'escalation', rule: 'overdue-work', mode: 'approval' })
  await tick()
  let controls = await api('owner', 'automation-controls')
  const waiting = controls.executions.find(row => row.kind === 'escalation' && row.input.assignment === a)
  assert.equal(waiting.outcome, 'approval_required')
  assert.equal(mails().length, 0, 'approval mode never calls the provider before a human decision')
  await api('manager', 'automation.approve', { execution: waiting.id, version: controls.policy.version }, 403)
  await api('owner', 'automation.approve', { execution: waiting.id, version: controls.policy.version })
  await api('owner', 'automation.policy', { version: controls.policy.version, kind: 'escalation', rule: 'overdue-work', mode: 'approval' })
  await api('owner', 'escalation.run', {})
  assert.equal(mails().length, 0, 'a policy version change invalidates the old approval')
  controls = await api('owner', 'automation-controls')
  assert.equal(controls.executions.find(row => row.id === waiting.id).outcome, 'approval_required')
  await api('owner', 'automation.approve', { execution: waiting.id, version: controls.policy.version })
  h.edge.refuse = true
  await api('owner', 'escalation.run', {})
  h.edge.refuse = false
  controls = await api('owner', 'automation-controls')
  await api('owner', 'automation.policy', { version: controls.policy.version, kind: 'escalation', rule: 'overdue-work', mode: 'automatic' })
  let row = await item('manager', a)
  assert.match(row.failures[0].failure, /^mail_rejected:/)
  assert.equal(row.messages.length, 0, 'rejected mail is never labelled accepted')
  await tick()
  assert.equal(mails().length, 0, 'no hidden automatic retry')
  await api('owner', 'person.directory', { member: ids.learner, employment: 'leave' })
  const blocker = await api('learner', 'blocker.report', { assignment: a, kind: 'leave', note: 'Return date not yet confirmed.' })
  await api('owner', 'team.managers', { team: ids.team, members: [ids.other] })
  await due(a, 4)
  await tick()
  row = await item('other', a)
  assert.deepEqual(row.reachesNow, [{ id: ids.other, route: 'direct' }])
  assert.equal(row.onLeave, true)
  assert.deepEqual(row.messages.map(message => [message.recipient, message.route, message.status]), [[ids.other, 'direct', 'accepted']])
  assert.ok(row.failures.some(failure => failure.route === 'learner'))
  assert.ok((await api('other', 'queues')).blockers.some(row => row.id === blocker.id))
  assert.deepEqual(await queue('manager'), [], 'former manager loses the private queue immediately')
  assert.equal(mails().length, 1)
  assert.ok(mails()[0].to.includes('other@example.test') && mails()[0].text.includes('paid work time'))
  assert.ok(!mails()[0].text.includes('Return date'), 'blocker text stays behind current sign-in authority')
  await tick()
  assert.equal(mails().length, 1, 'manager delivery is deduplicated')
  // A temporary cover supersedes the direct manager; revoking it rechecks the route.
  const cover = await api('owner', 'team.coverage', { team: ids.team, member: ids.manager, expiresOn: '2030-12-01', reason: 'Cover the shift' })
  await tick()
  assert.deepEqual((await item('manager', a)).reachesNow, [{ id: ids.manager, route: 'coverage' }])
  assert.equal(mails().length, 2)
  await api('owner', 'team.coverage.end', { grant: cover.id })
  assert.deepEqual(await queue('manager'), [])
  await due(a, 7)
  await tick()
  row = await item('other', a)
  assert.deepEqual(row.reachesNow, [{ id: ids.owner, route: 'owner' }])
  assert.equal(mails().length, 3)
  assert.ok(mails()[2].to.includes('owner@example.test'))
  // Unit administration keeps the existing course boundary on enrollment writes.
  const unit = await api('owner', 'unit.create', { name: 'Escalation unit', teams: [ids.team] })
  await api('owner', 'admin.grant', { unit: unit.id, member: ids.author, expiresOn: '2030-12-31' })
  await api('author', 'escalation.resolve', { assignment: a, reason: 'Course outside the administered unit' }, 403)
  // Resolve the reported blocker under the existing exception policy, then the
  // escalation with a reason; neither operation rewrites the original due date.
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  await api('other', 'exception.grant', { assignment: a, blocker: blocker.id, kind: 'deferral', endsOn: tomorrow, reason: 'Leave approved; manager arranged a return session.' })
  assert.deepEqual(await queue('other'), [])
  await tick()
  assert.equal(mails().length, 3, 'active deferral pauses scheduled escalation')
  await api('learner', 'escalation.resolve', { assignment: a, reason: 'Self approval' }, 404)
  await api('manager', 'escalation.resolve', { assignment: a, reason: 'Former manager' }, 404)
  await api('other', 'escalation.resolve', { assignment: a, reason: 'Replacement session arranged on return.' })
  await h.db.prepare('UPDATE beam_exceptions SET ends_at=? WHERE assignment_id=?').bind(Date.now() - 1000, a).run()
  await tick()
  assert.deepEqual(await queue('other'), [])
  assert.equal(mails().length, 3)
  assert.equal((await api('learner', `assignments/${a}`)).assignment.dueDate, original.dueDate)
  // No email has no SMS delivery capability today: expose no contact route, not a
  // fictitious send. Attempt exhaustion and full assessor sessions are actionable.
  const practical = await course('Full practical calendar', true)
  const pa = await assign(practical)
  await api('owner', 'assignment.create', { course: practical.id, learners: [ids.assessor], dueDate: '2030-10-01' })
  const instructor = await api('owner', 'instructor.grant', { member: ids.assessor, expiresOn: '2030-12-31' })
  const session = await api('owner', 'session.schedule', { course: practical.id, title: 'Assessor fully booked', instructor: ids.assessor, date: '2030-12-03', time: '09:00', minutes: 60, timezone: 'UTC', format: 'classroom', location: 'Yard', capacity: 1 })
  await api('assessor', 'session.register', { session: session.id })
  await due(pa, 2)
  assert.equal((await item('other', pa)).missingAssessorCapacity, true)
  await api('owner', 'session.seats', { session: session.id, capacity: 2 })
  assert.equal((await item('other', pa)).missingAssessorCapacity, false)
  await api('owner', 'instructor.revoke', { grant: instructor.id })
  assert.equal((await item('other', pa)).missingAssessorCapacity, true, 'revoked instructor access provides no available capacity')
  await api('owner', 'person.directory', { member: ids.learner, email: '', emailSent: true })
  assert.equal((await item('other', pa)).noContactRoute, true)
  await api('owner', 'person.directory', { member: ids.learner, email: 'learner@example.test', employment: 'active' })
  const quiz = await api('author', 'course.create', { title: 'Exhausted retry', reviewer: ids.reviewer })
  let version = (await api('author', 'course.lesson', { course: quiz.id, draftVersion: quiz.draftVersion, title: 'Stop safely', body: 'Stop first.', sources: [] })).draftVersion
  version = (await api('author', 'course.question', { course: quiz.id, draftVersion: version, prompt: 'First action?', choices: 'Stop\nContinue', correct: '1' })).draftVersion
  version = (await api('author', 'course.assessment', { course: quiz.id, draftVersion: version, passPercent: 100, maxAttempts: 1 })).draftVersion
  await f.publish((await api('author', 'course.submit', { course: quiz.id, draftVersion: version })).id)
  const qa = await assign(quiz)
  await lessons(qa)
  const question = (await api('learner', `assignments/${qa}`)).quiz.questions[0]
  await api('learner', 'quiz.submit', { assignment: qa, [`q_${question.id}`]: ['1'] })
  await due(qa, 4)
  assert.equal((await item('other', qa)).attemptsExhausted, true)
  await api('other', 'escalation.resolve', { assignment: qa, reason: 'Manager is arranging a supported retry.' })
  // Completion before replay suppresses the formerly failed queued reminder.
  const done = await course('Complete before queued mail'), da = await assign(done)
  await due(da, 2)
  h.edge.refuse = true
  await tick()
  h.edge.refuse = false
  const before = mails().length
  await lessons(da)
  await api('owner', 'escalation.run', {})
  assert.equal(mails().length, before + 1, 'only the other open practical reminder replays')
  assert.ok(!(await queue('other')).some(row => row.assignment === da))
  assert.ok((await api('owner', 'audit?q=escalation')).events.some(event => event.action === 'escalation.resolve'))
  // OPS-002 remains true as NOTICE-004 adds record kinds: independently read
  // populated policy, delivery and resolution records through the owner export.
  const exported = await (await h.raw('/app/data-export.json', { cookie: f.cookies.owner })).json()
  for (const table of ['beam_escalation_policy', 'beam_escalation_messages', 'beam_escalation_resolutions']) {
    const record = exported.records[table]
    assert.ok(record.count > 0)
    assert.equal(record.count, record.rows.length)
    assert.equal(record.sha256, createHash('sha256').update(JSON.stringify(record.rows)).digest('hex'))
  }
  assert.ok(exported.records.beam_escalation_messages.rows.some(row => row.assignment_id === a && row.recipient_id === ids.other && row.status === 'accepted'))
  assert.ok(exported.records.beam_escalation_resolutions.rows.some(row => row.assignment_id === a && row.resolved_by === ids.other))
  // The same NOTICE-004 provider door must obey every shared AUTO-008 hold.
  const saveControls = async fields => {
    const current = (await api('owner', 'automation-controls')).policy
    return api('owner', 'automation.policy', { ...current, ...fields })
  }
  await api('owner', 'assignment.cancel', { assignment: pa, reason: 'Practical moved to supervised program.' })
  const heldCourse = await course('Escalation controls'), held = await assign(heldCourse)
  await due(held, 4)
  const sentBeforeHold = mails().length
  for (const [settings, outcome] of [
    [{ paused: true }, 'paused'],
    [{ paused: false, quietStart: new Date().getUTCHours(), quietEnd: (new Date().getUTCHours() + 1) % 24 }, 'quiet_hours'],
    [{ quietStart: 0, quietEnd: 0, dailyLimit: 0 }, 'rate_limited'],
  ]) {
    await saveControls(settings)
    await api('owner', 'escalation.run', {})
    const execution = (await api('owner', 'automation-controls')).executions.find(row => row.input.assignment === held)
    assert.equal(execution.outcome, outcome)
    assert.equal(mails().length, sentBeforeHold)
  }
  await saveControls({ dailyLimit: 100 })
  await tick()
  assert.equal(mails().length, sentBeforeHold, 'lifting a hold does not silently replay')
  // No active manager: the owner is reached before the fallback delay, even if
  // a directory manager field points elsewhere. Restoring grants never duplicates.
  await api('owner', 'team.managers', { team: ids.team, members: [] })
  await api('owner', 'person.directory', { member: ids.learner, manager: ids.other })
  assert.deepEqual((await item('owner', held)).reachesNow, [{ id: ids.owner, route: 'owner' }])
  await api('owner', 'escalation.run', {})
  assert.equal(mails().length, sentBeforeHold + 1)
  assert.ok(mails().at(-1).to.includes('owner@example.test'))
  await api('owner', 'assignment.cancel', { assignment: held, reason: 'Requirement replaced.' })
  await tick()
  await api('owner', 'escalation.run', {})
  assert.equal(mails().length, sentBeforeHold + 1, 'cancellation stops future sends')
  assert.ok(!(await queue('owner')).some(row => row.assignment === held))
  // Combined recovery: leave, a reported bounce and a full assessor calendar, approved through Agent work.
  await api('owner', 'team.managers', { team: ids.team, members: [ids.other] })
  await api('owner', 'person.directory', { member: ids.learner, employment: 'active' })
  const recoveryCourse = await course('Combined blocked-work recovery', true), recoveryAssignment = await assign(recoveryCourse)
  await api('owner', 'instructor.grant', { member: ids.assessor, expiresOn: '2030-12-31' })
  await api('owner', 'assignment.create', { course: recoveryCourse.id, learners: [ids.assessor], dueDate: '2030-10-01' })
  const full = await api('owner', 'session.schedule', { course: recoveryCourse.id, title: 'Full recovery assessor calendar', instructor: ids.assessor, date: '2030-12-03', time: '09:00', minutes: 60, timezone: 'UTC', format: 'classroom', location: 'Yard', capacity: 1 })
  await api('assessor', 'session.register', { session: full.id })
  const originalRecovery = (await api('learner', `assignments/${recoveryAssignment}`)).assignment
  await due(recoveryAssignment, 2)
  await tick()
  const learnerDelivery = (await item('other', recoveryAssignment)).messages.find(m => m.route === 'learner')
  // The queue exposes the exact delivery id used by the in-product bounce report.
  assert.ok(learnerDelivery.id)
  await api('other', 'recovery.delivery', { assignment: recoveryAssignment, team: ids.team, message: learnerDelivery.id })
  await api('owner', 'person.directory', { member: ids.learner, employment: 'leave' })
  await due(recoveryAssignment, 4)
  const payload = { assignment: recoveryAssignment, team: ids.team, substitute: ids.manager, expiresOn: '2030-12-01' }
  const token = (await api('other', 'agent.issue', { expiresInSeconds: 900 })).token
  const agent = async (path, body, status = 200) => {
   const response = await h.fetch(`/api/beam/${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, origin: h.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
   const text = await response.text(); assert.equal(response.status, status, text.slice(0,300)); return JSON.parse(text)
  }
  const proposalInput = { kind: 'process_change', title: 'Arrange paid recovery after leave', inputs: [{ type: 'assignment', id: recoveryAssignment }], reasons: ['Current leave, bounced learner mail and unavailable assessor capacity.'], payload: { recovery: payload } }
  const proposal = await agent('agent.propose', proposalInput)
  const prepared = await api('other', `proposals/${proposal.id}`)
  assert.deepEqual([prepared.payload.recovery.facts.onLeave, prepared.payload.recovery.facts.missingAssessorCapacity], [true,true])
  assert.ok(prepared.payload.recovery.facts.failures.some(f => f.failure === 'mail_bounced' && f.source === 'human_report' && f.sourceId === learnerDelivery.id))
  assert.ok(prepared.payload.recovery.plan.includes('paid-work') && prepared.payload.recovery.plan.includes('No assessment is passed'))
  await agent('agent.decide', { proposal: proposal.id, sha256: proposal.sha256, decision: 'approve' }, 403)
  await agent('recovery.delivery', { assignment: recoveryAssignment, team: ids.team, message: learnerDelivery.id }, 403)
  await api('manager', 'agent.decide', { proposal: proposal.id, sha256: proposal.sha256, decision: 'approve' }, 409)
  await agent('agent.propose', { ...proposalInput, payload: { recovery: { ...payload, backdate: '2020-01-01' } } }, 400)
  await agent('agent.propose', { ...proposalInput, payload: { recovery: { ...payload, passed: true } } }, 400)
  await agent('agent.propose', { ...proposalInput, payload: { recovery: { ...payload, unpaidWork: true } } }, 400)
  await api('other', 'agent.decide', { proposal: proposal.id, sha256: '0'.repeat(64), decision: 'approve' }, 409)
  await api('owner', 'person.directory', { member: ids.learner, employment: 'active' })
  assert.equal((await api('other', 'agent.decide', { proposal: proposal.id, sha256: proposal.sha256, decision: 'approve' }, 409)).error, 'recovery_changed')
  await api('owner', 'person.directory', { member: ids.learner, employment: 'leave' })
  const beforeRecovery = mails().length
  if (process.env.BEAM_RECOVERY_BROWSER === '1') await recoveryBrowser(f, proposal.id, false)
  const approved = await api('other', 'agent.decide', { proposal: proposal.id, sha256: proposal.sha256, decision: 'approve' })
  assert.equal(approved.result.coverage.member, ids.manager)
  assert.equal((await item('manager', recoveryAssignment)).dueAt, prepared.payload.recovery.originalDueAt)
  assert.ok(approved.result.delivery.some(d => d.recipient === ids.manager))
  assert.equal(mails().length, beforeRecovery + 1)
  assert.ok(mails().at(-1).to.includes('manager@example.test') && mails().at(-1).text.includes('paid work time'))
  assert.equal((await api('learner', `assignments/${recoveryAssignment}`)).assignment.dueDate, originalRecovery.dueDate)
  assert.equal((await api('learner', `assignments/${recoveryAssignment}`)).completion, null)
  assert.equal((await item('manager', recoveryAssignment)).messages.at(-1).status, 'accepted')
  if (process.env.BEAM_RECOVERY_BROWSER === '1') await recoveryBrowser(f, proposal.id, true)
  await api('other', 'agent.decide', { proposal: proposal.id, sha256: proposal.sha256, decision: 'approve' }, 409)
  await api('owner', 'team.coverage.end', { grant: approved.result.coverage.id })
  await api('owner', 'assignment.cancel', { assignment: recoveryAssignment, reason: 'Recovery proof complete.' })
  await api('owner', 'team.managers', { team: ids.team, members: [] })
  await api('other', `proposals/${proposal.id}`, undefined, 404)
  await api('other', 'proposals?state=approved', undefined, 403)
  const p = await api('owner', 'escalation-policy')
  await api('owner', 'escalation.policy', { ...policy, version: p.version, enabled: false })
  await tick()
  assert.deepEqual(await queue('owner'), [])
}

async function recoveryBrowser(f, proposal, approved) {
 const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
 const { mkdir } = await import('node:fs/promises')
 const out = process.env.BEAM_DIAGNOSIS_EVIDENCE || 'test-results'
 await mkdir(out, { recursive: true })
 const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
 try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  await context.addCookies(f.cookies.other.split('; ').map(pair => { const i=pair.indexOf('='); return { name: pair.slice(0,i), value: pair.slice(i+1), url: f.h.origin, secure: true } }))
  const page = await context.newPage()
  for (const width of [1440,390]) {
   await page.setViewportSize({ width, height: 1000 })
   await page.goto(`${f.h.origin}/app/agent${approved ? '?state=approved' : ''}`)
   const card = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Arrange paid recovery after leave', exact: true }) })
   await card.getByText('Bounced email reported by a manager', { exact: true }).waitFor()
   assert.ok(await card.getByText('On leave', { exact: true }).isVisible())
   if (approved) await card.getByText(/Temporary coverage granted/).waitFor()
   assert.ok(await page.locator('body').evaluate(body => body.scrollWidth<=innerWidth))
   assert.ok((await page.getByRole('button').allTextContents()).every(text => text.trim().length>0), 'every button has a visible text label')
   await page.screenshot({ path: `${out}/AGENT-006-${approved ? 'approved' : 'waiting'}-${width}.png`, fullPage: true })
  }
  await context.close()
 } finally { await browser.close() }
}

async function notificationRelationshipCheck(f, unit) {
  const { api, ids, course, lessons } = f
  const practical = await course('Observed safety', true)
  await api('owner', 'course.unit', { course: practical.id, unit })
  const grant = await api('owner', 'admin.grant', { unit, member: ids.other })
  const rules = {}
  for (const recipient of ['assessor', 'admin']) {
    rules[recipient] = await api('owner', 'notification.save', { name: `Completion for ${recipient}`, recipient, course: practical.id, team: ids.team, subject: '{learner_name} finished {course_name}', body: 'Training record: {assignment_link}' })
    await api('owner', 'notification.test', { rule: rules[recipient].id })
    await api('owner', 'notification.state', { rule: rules[recipient].id, enabled: true })
  }
  const pendingRule = await api('owner', 'notification.save', { name: 'Evidence awaiting assessor', event: 'evidence_pending', recipient: 'assessor', course: practical.id, team: ids.team, subject: '{learner_name}: evidence waiting', body: 'Review during paid work time: {assignment_link}' })
  await api('owner', 'notification.test', { rule: pendingRule.id })
  await api('owner', 'notification.state', { rule: pendingRule.id, enabled: true })
  const assignment = (await api('owner', 'assignment.create', { course: practical.id, learners: [ids.learner], dueDate: '2030-10-01' })).created[0]
  await lessons(assignment)
  const attempt = await api('learner', 'practical.submit', { assignment, evidence: 'Demonstrated the observed procedure.' })
  const pendingNotices = async role => (await api(role, 'notifications')).filter(row => row.rule_id === pendingRule.id && !row.test)
  assert.equal((await pendingNotices('assessor')).length, 1)
  assert.equal((await pendingNotices('other')).length, 0)
  assert.ok((await pendingNotices('assessor'))[0].body.includes(`/app/attempts/${attempt.id}`))
  assert.ok(!JSON.stringify(await api('learner', `attempts/${attempt.id}`)).includes('notice_resolutions'))
  await api('owner', 'notification.replay', { rule: pendingRule.id })
  assert.equal((await pendingNotices('assessor')).length, 1)
  await api('owner', 'person.roles', { member: ids.assessor, roles: ['learner'] })
  assert.equal((await pendingNotices('assessor')).length, 0)
  await api('owner', 'person.roles', { member: ids.assessor, roles: ['assessor', 'learner'] })
  if (process.argv.includes('--browser')) await pendingEvidenceBrowser(f, attempt.id)
  await api('assessor', 'practical.decide', { attempt: attempt.id, decision: 'accepted', note: 'Observed complete procedure.' })
  assert.equal((await pendingNotices('assessor')).length, 0)
  await api('owner', 'notification.replay', { rule: pendingRule.id })
  assert.equal((await pendingNotices('assessor')).length, 0)
  await api('owner', 'notification.state', { rule: pendingRule.id, enabled: false })
  const notices = async (role, recipient) => (await api(role, 'notifications')).filter(row => row.rule_id === rules[recipient].id && !row.test)
  assert.equal((await notices('assessor', 'assessor')).length, 1)
  assert.equal((await notices('other', 'assessor')).length, 0)
  assert.equal((await notices('other', 'admin')).length, 1)
  assert.equal((await notices('owner', 'admin')).length, 1)
  await api('owner', 'person.roles', { member: ids.assessor, roles: ['learner'] })
  await api('owner', 'admin.revoke', { grant: grant.id })
  assert.equal((await notices('assessor', 'assessor')).length, 0)
  assert.equal((await notices('other', 'admin')).length, 0)
  await api('owner', 'person.roles', { member: ids.assessor, roles: ['assessor', 'learner'] })
  assert.equal((await notices('assessor', 'assessor')).length, 1)
  for (const rule of Object.values(rules)) await api('owner', 'notification.state', { rule: rule.id, enabled: false })
}

async function pendingEvidenceBrowser(f, attempt) {
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const evidence = process.env.BEAM_EVIDENCE_DIR || 'test-results'
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true })
      try {
        await context.addCookies(f.cookies.assessor.split('; ').map(cookie => { const split = cookie.indexOf('='); return { name: cookie.slice(0, split), value: cookie.slice(split + 1), url: f.h.origin } }))
        const page = await context.newPage()
        await page.goto(`${f.h.origin}/app/learning`)
        const link = page.locator(`a[href="/app/attempts/${attempt}"]`).first()
        assert.ok(await link.isVisible())
        await page.screenshot({ path: `${evidence}/${width}-pending-evidence-notice.png`, fullPage: true })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        await link.click()
        await page.waitForURL(`**/app/attempts/${attempt}`)
        assert.ok(await page.locator('form[action="/app/do/practical.decide"]').isVisible())
      } finally { await context.close() }
    }
  } finally { await browser.close() }
}
