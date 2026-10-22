// The local-only entry never ships in dist: qualify it against the real dev
// server over HTTP in a disposable checkout, without launching a browser.
import assert from 'node:assert/strict'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { command, devKey, enter, serving } from './cli.mjs'

assert.equal(process.env.BEAM_TEST_CHECKOUT, '1', 'Use a disposable fresh checkout')
const root = process.cwd()
await access(join(root, '.dev.vars')).then(() => assert.fail('Use an unconfigured checkout'), error => { if (error.code !== 'ENOENT') throw error })
const socket = createServer()
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
const port = socket.address().port
await new Promise(resolve => socket.close(resolve))
const origin = `http://127.0.0.1:${port}`
let server
try {
  await mkdir(join(root, 'exports'), { recursive: true })
  await writeFile(join(root, 'exports/dev-personas-answers.json'), JSON.stringify({ OWNER_EMAIL: 'synthetic-beam-1@example.test' }), { mode: 0o600 })
  await command(root, ['setup', '--answers', 'exports/dev-personas-answers.json', '--non-interactive', '--port', String(port)])
  server = await serving(root, 'dev', port)
  const key = await devKey(root), cookies = {}, ids = {}
  const request = (role, path, body, form) => fetch(new URL(path, origin), {
    method: body !== undefined || form ? 'POST' : 'GET', redirect: 'manual',
    headers: { cookie: cookies[role] ?? '', 'x-rer-dev-key': key, ...(body !== undefined || form ? { origin } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : form,
  })
  const api = async (role, path, body, status = 200) => {
    const response = await request(role, `/api/beam/${path}`, body)
    assert.equal(response.status, status, path)
    return response.json()
  }
  const submit = async (role, action, fields) => {
    const form = new URLSearchParams({ returnTo: '/app/people' })
    for (const [name, value] of Object.entries(fields)) for (const item of [value].flat()) form.append(name, item)
    const response = await request(role, `/app/do/${action}`, undefined, form)
    assert.equal(response.status, 303, action)
    const url = new URL(response.headers.get('location'), origin)
    assert.equal(url.searchParams.get('error'), null, action)
  }
  for (const role of ['owner', 'manager', 'reviewer', 'learner']) {
    const session = await enter(origin, key, role)
    assert.equal(session.status, 303, 'dev sign-in')
    cookies[role] = session.cookie
    ids[role] = (await api(role, 'me')).id
    if (role === 'owner') {
      assert.equal((await request(role, '/setup', undefined, new URLSearchParams({ confirm: 'yes' }))).status, 303)
      await api(role, 'business.configure', { name: 'Synthetic Beam role test', timezone: 'UTC' })
    }
  }
  assert.ok((await api('manager', 'me')).roles.includes('assessor'), 'the first dev sign-in seeds the assessor role')
  const created = await api('owner', 'course.create', { title: 'Synthetic practical', reviewer: ids.reviewer })
  const lesson = await api('owner', 'course.lesson', { course: created.id, draftVersion: created.draftVersion, title: 'Procedure', body: 'Demonstrate the procedure.', sources: [] })
  const assessed = await api('owner', 'course.assessment', { course: created.id, draftVersion: lesson.draftVersion, practicalInstructions: 'Show the procedure.', assessor: ids.manager })
  const revision = await api('owner', 'course.submit', { course: created.id, draftVersion: assessed.draftVersion })
  await submit('reviewer', 'revision.decide', { revision: revision.id, decision: 'publish' })
  const assignment = (await api('owner', 'assignment.create', { course: created.id, learners: [ids.learner], dueDate: '2030-10-01', dueTime: '17:00', timezone: 'UTC' })).created[0]
  for (const item of (await api('learner', `assignments/${assignment}`)).lessons) await api('learner', 'lesson.complete', { assignment, lesson: item.id })
  const attempt = await api('learner', 'practical.submit', { assignment, evidence: 'Demonstrated the procedure.' })
  await submit('owner', 'person.roles', { member: ids.manager, roles: ['learner', 'manager'] })
  for (let read = 0; read < 2; read++) {
    assert.deepEqual((await api('manager', 'me')).roles.sort(), ['learner', 'manager'])
    assert.deepEqual((await api('owner', 'people')).members.find(member => member.id === ids.manager).roles.sort(), ['learner', 'manager'])
    const people = await request('owner', '/app/people')
    assert.equal(people.status, 200)
    const row = (await people.text()).match(/<tr>[^]*?<\/tr>/g)?.find(item => item.includes(`href="/app/records/${ids.manager}"`))
    const summary = row?.match(/<summary>([^<]*)<\/summary>/)?.[1]
    assert.ok(summary && !summary.includes('Assessor'), 'People drops the removed role')
    const home = await request('manager', '/app/learning')
    assert.equal(home.status, 200)
    const roleLine = (await home.text()).match(/<div class="who">[^]*?<strong>[^<]*<\/strong><span>([^<]*)<\/span>/)?.[1]
    assert.ok(roleLine && !roleLine.includes('Assessor'), 'the signed-in header drops the removed role')
  }
  if (process.argv.includes('--browser')) {
    const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
    const directory = process.env.BEAM_EVIDENCE_DIR || join(root, 'test-results')
    await mkdir(directory, { recursive: true })
    const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
    try {
      for (const width of [1440, 390]) for (const role of ['owner', 'manager']) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, extraHTTPHeaders: { 'x-rer-dev-key': key } })
        try {
          await context.addCookies(cookies[role].split('; ').map(cookie => { const at = cookie.indexOf('='); return { name: cookie.slice(0, at), value: cookie.slice(at + 1), url: origin } }))
          const page = await context.newPage()
          await page.goto(origin + (role === 'owner' ? '/app/people' : '/app/learning'))
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
          await page.screenshot({ path: join(directory, `${width}-dev-roles-${role}.png`), fullPage: true })
        } finally { await context.close() }
      }
    } finally { await browser.close() }
  }
  assert.equal((await api('manager', 'practical.decide', { attempt: attempt.id, decision: 'accepted', note: 'Role removed.' }, 403)).error, 'forbidden')
  assert.equal((await api('learner', `attempts/${attempt.id}`)).state, 'awaiting_review', 'a refused decision leaves evidence pending')
  // Re-entering a real persona must preserve explicit removals too, including
  // an empty role set; seeding is tied to the new member, not the server process.
  await submit('owner', 'person.roles', { member: ids.manager, roles: [] })
  cookies.manager = (await enter(origin, key, 'manager')).cookie
  assert.deepEqual((await api('manager', 'me')).roles, [])
  console.log('PASS dev persona role removal survives requests and sign-in; practical decision refused')
} finally {
  await server?.stop()
}
