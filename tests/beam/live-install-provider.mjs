// OPS-006 provider step, run in a disposable fresh clone after the local journey: a locally installed Beam
// refuses its provider-dependent feature with an actionable diagnostic until the owner connects a real model
// account, then returns a real provider answer. Opt in outside push Verify, on the committed candidate:
// BEAM_LIVE_PROOF=1 BEAM_TEST_CHECKOUT=1 _od08-env.py BEAM_MODEL_KEY=OPENAI_API_KEY -- node tests/beam/live-install-provider.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { command, devKey, enter, serving } from './cli.mjs'
import { file } from './harness.mjs'
import { evidence } from './live-provider-runtime.mjs'

assert.equal(process.env.BEAM_LIVE_PROOF, '1', 'Explicit held-account qualification required')
assert.equal(process.env.BEAM_TEST_CHECKOUT, '1', 'Use a disposable fresh checkout')
assert.ok(process.env.BEAM_MODEL_KEY, 'Inject the held key only through the approved env door')
const root = process.cwd()
await access(join(root, '.dev.vars')).then(() => assert.fail('Use an unconfigured checkout'), error => { if (error.code !== 'ENOENT') throw error })
const socket = createServer()
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
const port = socket.address().port
await new Promise(resolve => socket.close(resolve))
const origin = `http://127.0.0.1:${port}`
let server
try {
  // Hosted missing-credential diagnostics are offline and name the setting to supply.
  const diagnose = settings => spawnSync(process.execPath, ['scripts/diagnose-configuration.mjs'], { cwd: root, input: JSON.stringify(settings), encoding: 'utf8' })
  const hosted = { AUTH_ORIGIN: 'https://training.example.test', OWNER_EMAIL: 'owner@example.test', SESSION_SECRET: 'synthetic-beam-session-secret-0001', MAIL_PROVIDER: 'sendgrid', MAIL_FROM: 'learning@example.test' }
  const unconnected = diagnose(hosted)
  assert.equal(unconnected.status, 1, 'a hosted install without its mail credential is invalid')
  const issue = JSON.parse(unconnected.stdout).issues.find(row => row.setting === 'MAIL_API_KEY')
  assert.ok(issue && issue.action.length > 20, 'the missing mail credential is named with an action')

  await mkdir(join(root, 'exports'), { recursive: true })
  await writeFile(join(root, 'exports/live-answers.json'), JSON.stringify({ OWNER_EMAIL: 'synthetic-beam-1@example.test' }), { mode: 0o600 })
  await command(root, ['install'])
  await command(root, ['setup', '--answers', 'exports/live-answers.json', '--non-interactive', '--port', String(port)])
  server = await serving(root, 'dev', port)
  const key = await devKey(root), cookies = {}
  const request = (path, body, form) => fetch(new URL(path, origin), {
    method: body !== undefined || form ? 'POST' : 'GET', redirect: 'manual',
    headers: { cookie: cookies.owner ?? '', 'x-rer-dev-key': key, ...(body !== undefined || form ? { origin } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : form,
  })
  const api = async (path, body, status = 200) => {
    const response = await request(`/api/beam/${path}`, body)
    const text = await response.text()
    assert.equal(response.status, status, `${path}: ${response.status} ${text.slice(0, 300)}`)
    return text ? JSON.parse(text) : null
  }
  const session = await enter(origin, key, 'owner')
  assert.equal(session.status, 303, 'local sign-in')
  cookies.owner = session.cookie
  assert.equal((await request('/setup', undefined, new URLSearchParams({ confirm: 'yes' }))).status, 303)
  await api('business.configure', { name: 'Synthetic Beam install proof', timezone: 'UTC' })
  const me = await api('me')
  assert.equal((await enter(origin, key, 'reviewer')).status, 303, 'the reviewer persona exists after its first sign-in')
  const reviewer = (await api('people')).members.find(member => member.email.startsWith('reviewer@')).id
  const source = await api('source.create', { title: 'Clean tool procedure', reviewer, licence: 'owned', licenceEvidence: 'Synthetic employer procedure', provenance: 'Original qualification procedure', file: file('synthetic-beam-6.txt', 'Use clean tools before work. Set dirty tools aside. The tool replacement interval is not specified.\n') })
  const course = await api('course.create', { title: 'Safe tool preparation', reviewer })
  const previewPath = `courses/${course.id}/model-preview?${new URLSearchParams({ inputs: source.versionId })}`

  // Before connecting: no key, no answer, and the refusal says what the owner must do.
  const before = await api('model-account')
  assert.equal(before.hasKey, false)
  assert.equal(before.enabled, false)
  const refusedPreview = await request(`/api/beam/${previewPath}`)
  assert.equal(refusedPreview.status, 409, 'a preview needs a connected account')
  assert.equal((await refusedPreview.json()).error, 'model_disabled')
  const page = await request(`/app/courses/${course.id}/generate?${new URLSearchParams({ inputs: source.versionId })}`)
  const html = await page.text()
  assert.ok(new RegExp('Connect the employer model account').test(html) && html.includes('No request has been sent'), 'the generation page tells the owner to connect the model account')
  assert.equal((await api(`courses/${course.id}`)).proposals.length, 0, 'nothing is simulated before a provider is connected')

  // Connect the real account through the owner door, request one draft, inspect it, revoke the key.
  await api('model.configure', { operation: 'enable', apiKey: process.env.BEAM_MODEL_KEY, maxCostCents: 1000, consent: true })
  const connected = await api('model-account')
  assert.equal(connected.hasKey, true)
  assert.ok(!JSON.stringify(connected).includes(process.env.BEAM_MODEL_KEY) && !JSON.stringify(connected).includes('key_cipher'), 'the key is never shown again')
  const preview = await api(previewPath)
  const proposed = await api('course.model.run', { ...preview, course: course.id, consent: true })
  const proposal = (await api(`courses/${course.id}`)).proposals.find(row => row.id === proposed.id)
  assert.ok(proposal.model && proposal.modelEstimateCents > 0, 'the draft shows its actual model and USD estimate')
  assert.ok(proposal.passages.length > 0 && proposal.passages.every(passage => passage.sourceVersion === source.versionId), 'the draft cites the selected procedure')
  const account = await api('model-account')
  assert.ok(account.runs[0].provider_response_id && !account.runs[0].provider_response_id.startsWith('synthetic'), 'a real provider response id is retained')
  assert.equal((await api(`courses/${course.id}`)).publishedRevision, null, 'nothing publishes without a named human')
  await api('model.configure', { operation: 'revoke' })
  assert.equal((await api('model-account')).hasKey, false)
  await evidence('live-install-provider', { owner: me.id, model: proposal.model, providerResponseId: account.runs[0].provider_response_id, usage: account.runs[0].usage })
  console.log('PASS OPS-006 provider connect: missing-credential diagnostics, refused generation, real model draft, key revoked')
} finally {
  await server?.stop().catch(() => {})
}
