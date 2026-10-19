import assert from 'node:assert/strict'
import { fixture } from './regression-fixture.mjs'

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
