// The first-release journey in a real browser at 1440 and 390 pixels, run from
// a disposable fresh clone through `rer`: setup, dev with dev
// identity, the owner publishing a reviewed course, a learner completing it,
// then build, preview, export and restore into a second fresh clone.
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { command, serving } from './cli.mjs'
import { procedureV1 } from './fixtures.mjs'
import { restoreJourney } from './restore.mjs'

assert.equal(process.env.BEAM_TEST_CHECKOUT, '1', 'Set BEAM_TEST_CHECKOUT=1 only in a disposable fresh git clone')
const root = process.cwd()
await access(join(root, '.dev.vars')).then(() => { throw new Error('The journey needs an unconfigured fresh clone') }, error => { if (error.code !== 'ENOENT') throw error })
const socket = createServer()
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
const port = socket.address().port
await new Promise(resolve => socket.close(resolve))
const origin = `http://127.0.0.1:${port}`
const scratch = await mkdtemp(join(tmpdir(), 'beam-journey-'))
// Screenshots go to BEAM_EVIDENCE_DIR when set (outside the checkout), else test-results/.
const evidence = process.env.BEAM_EVIDENCE_DIR || join(root, 'test-results')
await mkdir(evidence, { recursive: true })
let server, browser

async function shot(page, name) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  assert.ok(overflow <= 0, `${name} scrolls sideways by ${overflow}px at ${page.viewportSize().width}`)
  await page.screenshot({ path: join(evidence, `${page.viewportSize().width}-${name}.png`), fullPage: true })
}

async function enter(width, url) {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await context.newPage()
  await page.goto(url)
  // Dev identity trades the key for the gate cookie, then signs in and lands in the app.
  await page.waitForURL(url => /^\/(app|setup)/.test(url.pathname))
  return page
}

async function journey(width, ownerOpen, learnerOpen, learnerName) {
  const course = `Opening the clinic (${width})`
  const visitor = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage()
  await visitor.goto(`${origin}/`)
  await visitor.getByRole('link', { name: /sign in|finish setup/i }).first().waitFor()
  await shot(visitor, 'lobby')
  await visitor.goto(`${origin}/signin`)
  await shot(visitor, 'signin')
  await visitor.context().close()
  const owner = await enter(width, ownerOpen)
  await owner.goto(`${origin}/app`)
  if (new URL(owner.url()).pathname === '/setup') {
    await owner.getByRole('checkbox').check()
    await owner.getByRole('button', { name: 'Finish setup' }).click()
  }
  if (new URL(owner.url()).pathname !== '/app/business') await owner.goto(`${origin}/app/business`)
  await shot(owner, 'business')
  await owner.getByLabel('Business name').fill('Harbour Physio')
  await owner.getByLabel('Time zone for due dates').selectOption('Australia/Sydney')
  await owner.getByRole('button', { name: 'Save' }).click()
  // The owner manages training, so /app takes them to Manage.
  await owner.waitForURL(`${origin}/app/manage?notice=Saved.`)

  await owner.goto(`${origin}/app/sources`)
  const sourceFile = join(scratch, `opening-${width}.txt`)
  await writeFile(sourceFile, procedureV1)
  await owner.getByLabel('Title', { exact: true }).fill(`Opening procedure (${width})`)
  await owner.locator('form[action="/app/do/source.create"] input[type=file]').setInputFiles(sourceFile)
  await owner.getByLabel('License evidence').fill('Written by the clinic manager.')
  await owner.getByLabel('Where it came from').fill('Clinic shared drive')
  await owner.getByRole('button', { name: 'Add source' }).click()
  await owner.getByText(`opening-${width}.txt`).waitFor()
  await shot(owner, 'sources')

  await owner.goto(`${origin}/app/courses`)
  await owner.getByLabel('Title', { exact: true }).fill(course)
  await owner.getByRole('button', { name: 'Create course' }).click()
  await owner.getByRole('heading', { name: course, level: 1 }).waitFor()
  await owner.getByLabel('Lesson title').last().fill('Opening steps')
  await owner.getByLabel('Lesson text').last().fill('Disarm the alarm, then check the fridge log.')
  await owner.getByLabel(`Opening procedure (${width}) v1`).last().check()
  await owner.getByRole('button', { name: 'Add lesson' }).click()
  await owner.getByText('1. Opening steps').waitFor()
  await owner.getByLabel('Question').last().fill('What do you do first?')
  await owner.getByLabel('Choices, one per line').last().fill('Disarm the alarm\nOpen the till')
  await owner.getByLabel('Correct choice numbers').last().fill('1')
  await owner.getByRole('button', { name: 'Add question' }).click()
  await owner.getByText('1. What do you do first?').waitFor()
  await owner.getByLabel('Pass mark (%)').fill('100')
  await owner.getByLabel('Quiz attempts allowed').fill('2')
  await owner.getByRole('button', { name: 'Save rules' }).click()
  await owner.getByRole('button', { name: 'Submit for review' }).click()
  await shot(owner, 'course')
  await owner.getByRole('link', { name: 'Revision 1' }).click()
  await owner.getByRole('button', { name: 'Publish this revision' }).click()
  await owner.getByText('published').first().waitFor()
  await shot(owner, 'revision')

  const learner = await enter(width, learnerOpen)
  await learner.goto(`${origin}/app`)
  await owner.goto(`${origin}/app/manage`)
  await owner.getByLabel('Course', { exact: true }).first().selectOption({ label: course })
  await owner.locator('form[action="/app/do/assignment.create"]').getByLabel(learnerName).check()
  await owner.locator('form[action="/app/do/assignment.create"]').getByRole('button', { name: 'Assign' }).click()
  await owner.waitForURL(/notice=Saved/)
  await shot(owner, 'manage')

  await learner.goto(`${origin}/app`)
  await shot(learner, 'my-learning')
  await learner.getByRole('link', { name: course }).click()
  await learner.getByRole('link', { name: 'Start' }).click()
  await learner.getByRole('heading', { name: 'Opening steps' }).waitFor()
  await shot(learner, 'lesson')
  await learner.getByRole('button', { name: 'Mark done' }).click()
  await learner.getByRole('link', { name: 'Take the quiz' }).click()
  await learner.getByLabel('Disarm the alarm').check()
  await shot(learner, 'quiz')
  await learner.getByRole('button', { name: 'Submit answers' }).click()
  await learner.getByRole('link', { name: 'Certificate' }).click()
  await learner.getByText('Issued by Harbour Physio').waitFor()
  await learner.getByRole('heading', { name: course }).waitFor()
  await shot(learner, 'certificate')
  await owner.goto(`${origin}/app/people`)
  await shot(owner, 'people')
  for (const [path, name] of [['/app/courses', 'courses'], ['/app/paths', 'paths'], ['/app/import', 'move-in']]) {
    await owner.goto(origin + path)
    await shot(owner, name)
  }

  // Agent-prepared work, drafted through the JSON door and decided in the page.
  const json = async (path, data) => {
    const response = data === undefined ? await owner.request.get(`${origin}/api/beam/${path}`) : await owner.request.post(`${origin}/api/beam/${path}`, { data, headers: { origin } })
    assert.equal(response.status(), 200, `${path}: ${await response.text()}`)
    return await response.json()
  }
  const courseId = (await json('courses')).find(row => row.title === course).id
  const revision = (await json(`courses/${courseId}`)).publishedRevision
  const cited = (await json(`revisions/${revision}`)).lessons[0].sources[0]
  const learnerId = (await json('members')).find(row => row.name === learnerName).id
  const closesOn = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)
  await json('agent.propose', { kind: 'question_plan', title: `How opening works (${width})`, agent: 'claude-code', reasons: ['The fridge log was missed on four mornings.'], excluded: [{ item: 'Retraining everyone', reason: 'No evidence of a knowledge gap yet.' }], payload: { title: `How opening works (${width})`, purpose: 'Find out what gets in the way of the fridge log.', questions: ['What gets in the way of the fridge log?', 'What would help?'], participants: [learnerId], closesOn } })
  await json('agent.propose', { kind: 'scenario', title: `A patient arrives early (${width})`, agent: 'claude-code', inputs: [{ type: 'course_revision', id: revision }, { type: 'source_version', id: cited }], reasons: ['Practise the door step before the busy season.'], payload: { course: courseId, courseRevision: revision, title: 'A patient arrives early', rubric: 'The door stays locked until the alarm is off.', steps: [{ id: 'door', situation: 'A patient knocks on the door before opening. The alarm is still armed.', choices: [{ label: 'Let them in', feedback: 'Not yet: the alarm is still armed.', next: null }, { label: 'Keep the door locked and disarm the alarm first', feedback: 'Good call. The procedure disarms the alarm before anything else.', next: null, sources: [cited] }] }] } })
  await json('agent.propose', { kind: 'process_change', title: `Put the fridge log by the door (${width})`, agent: 'claude-code', reasons: ['The log lives in the back room.'], payload: { summary: 'Move the fridge log', change: 'Keep the fridge log on the front counter.' } })
  await owner.goto(`${origin}/app/agent`)
  await shot(owner, 'agent-work')
  for (const title of [`How opening works (${width})`, `A patient arrives early (${width})`]) {
    const card = owner.locator('article', { has: owner.getByRole('heading', { name: title }) })
    await card.getByLabel('Note (optional)').fill('Approved for this week.')
    await card.getByRole('button', { name: 'Approve' }).click()
    await owner.waitForURL(/notice=Saved/)
  }

  await learner.goto(`${origin}/app`)
  await learner.getByRole('link', { name: `How opening works (${width})` }).click()
  await learner.getByLabel('1. What gets in the way of the fridge log?').fill('It is in the back room.')
  await shot(learner, 'questions')
  await learner.getByRole('button', { name: 'Send answers' }).click()
  await learner.getByText('answers were sent without your name').waitFor()
  const mine = await (await learner.request.get(`${origin}/api/beam/records/me`)).json()
  await learner.goto(`${origin}/app/learn/${mine.assignments.find(row => row.courseTitle === course).id}`)
  await learner.getByRole('link', { name: 'A patient arrives early' }).click()
  await learner.getByRole('button', { name: 'Keep the door locked and disarm the alarm first' }).click()
  await learner.getByText('Good call.').waitFor()
  await shot(learner, 'practice')

  await owner.goto(`${origin}/app/reports`)
  await owner.getByRole('cell', { name: learnerName }).first().waitFor()
  await shot(owner, 'reports')
  await owner.goto(`${origin}/app/records/${learnerId}`)
  await shot(owner, 'record')
  await owner.context().close()
  await learner.context().close()
}

try {
  await command(root, ['describe'])
  await command(root, ['check', '--profile', 'first-party'])
  await command(root, ['install'])
  // Setup reads answers only from inside the checkout; exports/ is ignored by Git and never served.
  await mkdir(join(root, 'exports'), { recursive: true })
  const answers = join(root, 'exports/answers.json')
  await writeFile(answers, JSON.stringify({ OWNER_EMAIL: 'owner@example.test' }), { mode: 0o600 })
  await chmod(answers, 0o600)
  await command(root, ['setup', '--answers', 'exports/answers.json', '--non-interactive', '--port', String(port)])
  server = await serving(root, 'dev', port)
  const ownerOpen = server.open()
  assert.ok(ownerOpen && server.output().includes('RER_SIGNED_IN owner@example.test'))
  const personaOpen = async as => (await command(root, ['dev', '--port', String(port), '--as', as])).match(/RER_OPEN (\S+)/)[1]
  browser = await chromium.launch({ headless: true })
  for (const [width, persona, name] of [[1440, 'learner', 'Sam Lee (new staff)'], [390, 'author', 'Ana Ruiz (author)']]) {
    try { await journey(width, ownerOpen, await personaOpen(persona), name) } catch (error) {
      for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) await page.screenshot({ path: join(evidence, `${width}-failure-${index}.png`), fullPage: true }).catch(() => {})
      throw error
    }
  }
  await browser.close(); browser = null
  await server.stop(); server = null
  console.log('Journey passed at 1440 and 390: Lobby, setup, dev identity, source, course, review, publish, assign, lesson, quiz, certificate, agent work, questions, practice, report')

  await command(root, ['build'])
  server = await serving(root, 'preview', port)
  assert.equal((await fetch(`${origin}/health`)).status, 200)
  assert.equal((await fetch(`${origin}/signin`)).status, 200)
  await server.stop(); server = null
  // A production deploy needs its declared mail provider's key (rer refuses production without sign-in mail).
  await command(root, ['deploy', '--dry-run'], { extraEnv: { MAIL_API_KEY: 'synthetic-fixture-dry-run-mail-key' } })
  await restoreJourney({ root, target: join(scratch, 'target'), port })
} finally {
  await browser?.close()
  await server?.stop().catch(() => {})
  await rm(scratch, { recursive: true, force: true })
}
