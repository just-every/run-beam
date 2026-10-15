// Export the journey's installation, restore it into a second fresh clone and
// prove every portable row and stored file came back, with credentials excluded.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readArchive } from '@runeditrun/rer/modules/portability'
import { command, devKey, enter, serving } from './cli.mjs'
import { procedureV1 } from './fixtures.mjs'

async function archive(path) {
  const data = await readFile(path), records = []
  for await (const record of readArchive(new ReadableStream({ start(controller) { controller.enqueue(data); controller.close() } }))) records.push(record)
  return records
}
const items = records => records.filter(record => record.kind === 'part').flatMap(record => record.items).map(({ index, ...item }) => item)

export async function restoreJourney({ root, target, port }) {
  // An archive in public/ would ship with the deployed assets: export refuses to
  // write there, and a build refuses one copied there by hand.
  await command(root, ['export', '--output', 'public/exposed.rer'], { refuse: true })
  await command(root, ['export', '--output', 'exports/journey.rer'])
  await copyFile(join(root, 'exports/journey.rer'), join(root, 'public/exposed.rer'))
  await command(root, ['build'], { refuse: true })
  await rm(join(root, 'public/exposed.rer'))
  const before = await archive(join(root, 'exports/journey.rer'))
  const header = before[0]
  assert.ok(header.tables.some(table => table.name === 'beam_completions'))
  assert.ok(header.excludedTables.includes('oa_sessions'), 'sessions never leave the installation')
  assert.ok(header.objects.length > 0, 'stored source files are in the archive')
  const rows = table => items(before).filter(item => item.kind === 'row' && item.table === table).map(item => item.row)
  assert.equal(rows('beam_courses').length, 2)
  assert.equal(rows('beam_completions').length, 2)
  assert.equal(rows('beam_certificates').length, 2)

  const clone = spawn('git', ['clone', '--quiet', '--no-local', root, target], { stdio: 'ignore' })
  assert.equal(await new Promise(resolve => clone.once('exit', resolve)), 0, 'fresh target clone')
  await command(target, ['install'])
  await mkdir(join(target, 'exports'), { recursive: true })
  await copyFile(join(root, 'exports/journey.rer'), join(target, 'exports/journey.rer'))
  const corrupt = (await readFile(join(target, 'exports/journey.rer'), 'utf8')).replace('"kind":"part"', '"kind":"bad"')
  await writeFile(join(target, 'exports/corrupt.rer'), corrupt, { mode: 0o600 })
  await command(target, ['import', '--input', 'exports/corrupt.rer', '--yes'], { refuse: true })
  await command(target, ['import', '--input', 'exports/journey.rer', '--yes'])
  await command(target, ['import', '--input', 'exports/journey.rer', '--yes'], { refuse: true })
  await command(target, ['export', '--output', 'exports/restored.rer'])
  assert.deepEqual(items(await archive(join(target, 'exports/restored.rer'))), items(before), 'every portable row and file chunk survives an empty-target restore')

  const answers = join(target, 'exports/answers.json')
  await writeFile(answers, JSON.stringify({ OWNER_EMAIL: 'owner@example.test' }), { mode: 0o600 })
  await command(target, ['setup', '--answers', 'exports/answers.json', '--non-interactive', '--port', String(port)])
  const server = await serving(target, 'dev', port)
  const origin = `http://127.0.0.1:${port}`
  try {
    const key = await devKey(target)
    const owner = await enter(origin, key, 'owner')
    assert.equal(owner.status, 303)
    const cookie = owner.cookie
    // First-run confirmation belongs to the installation, not the archive: the new owner confirms it again.
    const confirmed = await fetch(`${origin}/setup`, { method: 'POST', redirect: 'manual', headers: { cookie, origin, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=yes' })
    assert.equal(confirmed.status, 303)
    const get = async path => { const response = await fetch(`${origin}/api/beam/${path}`, { headers: { cookie } }); assert.equal(response.status, 200, path); return response.json() }
    const sources = await get('sources')
    for (const source of sources) {
      const response = await fetch(`${origin}/app/files/source/${source.versions[0].id}?download=1`, { headers: { cookie } })
      assert.equal(response.status, 200)
      const bytes = Buffer.from(await response.arrayBuffer())
      assert.equal(createHash('sha256').update(bytes).digest('hex'), createHash('sha256').update(procedureV1).digest('hex'))
    }
    const learners = (await get('people')).members.filter(member => member.email.endsWith('@dev.localhost'))
    let certificates = 0
    for (const learner of learners) for (const completion of (await get(`records/${learner.id}`)).completions) {
      assert.equal((await get(`certificates/${completion.certificate}`)).issuer, 'Harbour Physio')
      certificates++
    }
    assert.equal(certificates, 2)
    // Archives carry no sign-in accounts. The owner restores a learner's access from People; the learner
    // signs in (local dev sign-in, as no mail leaves a local run) and reaches their own restored record and certificate.
    const learner = learners.find(member => member.email.startsWith('learner@'))
    const restore = new URLSearchParams({ returnTo: '/app/people', email: learner.email, status: 'active' })
    const restored = await fetch(`${origin}/app/do/person.access`, { method: 'POST', redirect: 'manual', headers: { cookie, origin, 'content-type': 'application/x-www-form-urlencoded' }, body: restore })
    assert.equal(restored.status, 303)
    assert.equal(new URL(restored.headers.get('location'), origin).searchParams.get('error'), null, 'restoring access is accepted')
    const signedIn = await enter(origin, key, 'learner')
    assert.equal(signedIn.status, 303)
    const learnerCookie = signedIn.cookie
    const own = await fetch(`${origin}/api/beam/records/me`, { headers: { cookie: learnerCookie } })
    assert.equal(own.status, 200, 'the restored learner reaches their own record')
    const mine = await own.json()
    assert.equal(mine.completions.length, 1)
    assert.equal((await fetch(`${origin}/app/certificates/${mine.completions[0].certificate}`, { headers: { cookie: learnerCookie } })).status, 200)
  } finally {
    await server.stop()
  }
  console.log('BEAM-16 passed: rer export, public-path refusal, corrupt and nonempty import refused, fresh-clone restore with identical rows and file bytes, records and certificates readable after a new sign-in, a restored learner let back in by the owner and signed in locally')
}
