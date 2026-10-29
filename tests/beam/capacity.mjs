// Outside push Verify: bounded local-runtime capacity qualification through public HTTP doors.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fixture } from './regression-fixture.mjs'
import { file } from './harness.mjs'
import { syntheticAudio, syntheticImage, syntheticVideo } from './fixtures.mjs'
import { sourceProcedurePdf } from './source-fixtures.mjs'
import { preparePackage } from './regression-packages.mjs'

const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(), '', 'capacity proof requires a committed candidate')
const started = performance.now()
const f = await fixture({ clock: Date.UTC(2026, 9, 27, 12) })
try {
  const { api, h, ids } = f
  const learners = [], sessions = []
  for (let index = 0; index < 10; index++) {
    const email = `synthetic-beam-${index}@example.test`
    learners.push((await api('owner', 'person.invite', { email, name: `Synthetic colleague ${index}`, roles: ['learner'] })).id)
    sessions.push(await h.signIn(email, { requested: true }))
  }
  const roster = ['Employee ID,Name', ...Array.from({ length: 183 }, (_, index) => `synthetic-beam-${100 + index},Synthetic colleague ${100 + index}`)].join('\n')
  const imported = await api('owner', 'people.import', { file: file('synthetic-beam-capacity.csv', roster) })
  assert.deepEqual([imported.created.length, imported.conflicts.length, imported.errors.length], [183, 0, 0])
  const people = (await api('owner', 'people')).members
  assert.equal(people.length, 200)
  assert.equal(people.filter(person => person.employment === 'active').length, 200)
  // Retain an independently attested historical revision for every employee.
  const historical = await f.course('Synthetic retained induction')
  await api('assessor', 'offline.record', { ...f.offline(historical), learners: people.filter(person => person.id !== ids.assessor).map(person => person.id) })
  await api('owner', 'offline.record', { ...f.offline(historical), learners: [ids.assessor] })
  assert.equal((await api('owner', 'operations')).usage.completions, 200)
  const retained = await Promise.all(learners.map(id => api('owner', `records/${id}`)))
  assert.ok(retained.every(record => record.completions.length === 1 && record.completions[0].revision === historical.revision))
  // Owned mixed media are real inert files; this synthetic workload does not qualify production media sizes.
  const mixed = await api('owner', 'course.create', { title: 'Synthetic mixed media induction', reviewer: ids.reviewer })
  let draft = await api('owner', 'course.lesson', { course: mixed.id, draftVersion: 1, title: 'Inspect the station', body: 'Inspect and record the station.', sources: [] })
  const lesson = draft.draft.lessons[0].id, originals = []
  for (const [kind, filename, bytes] of [['image', 'synthetic-beam.png', syntheticImage], ['audio', 'synthetic-beam.mp3', syntheticAudio], ['video', 'synthetic-beam.webm', syntheticVideo], ['document', 'synthetic-beam.pdf', sourceProcedurePdf()]]) {
    const source = await api('owner', 'source.create', { title: `Synthetic ${kind}`, licence: 'owned', licenceEvidence: 'Employer-authored synthetic qualification fixture', reviewer: ids.reviewer, provenance: 'Synthetic capacity qualification', file: file(filename, bytes) })
    originals.push({ id: source.versionId, bytes })
    draft = await api('owner', 'course.block', { course: mixed.id, draftVersion: draft.draftVersion, lesson, content: { kind, text: `Synthetic ${kind}`, source: source.versionId } })
  }
  const mixedRevision = (await api('owner', 'course.submit', { course: mixed.id, draftVersion: draft.draftVersion })).id
  await f.publish(mixedRevision)
  const cohort = [...learners, ...imported.created.slice(0, 10)]
  const assigned = (await api('owner', 'assignment.create', { course: mixed.id, learners: cohort, dueDate: '2026-11-27', dueTime: '17:00', timezone: 'UTC' })).created
  assert.equal(assigned.length, 20)
  // Ten independent authenticated learners read mixed media and complete concurrently.
  const completed = await Promise.all(sessions.map(async (cookie, index) => {
    const mine = (await h.api(`records/${learners[index]}`, cookie)).assignments.find(item => item.course === mixed.id)
    assert.ok(mine)
    const view = await h.api(`assignments/${mine.id}`, cookie)
    assert.equal(view.lessons[0].blocks.length, 4)
    for (const original of originals) {
      const response = await h.raw(`/api/beam/source-files/${original.id}`, { cookie })
      assert.equal(response.status, 200)
      assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), createHash('sha256').update(original.bytes).digest('hex'))
    }
    await h.api('lesson.complete', cookie, { assignment: mine.id, lesson: view.lessons[0].id })
    const record = await h.api(`records/${learners[index]}`, cookie)
    assert.deepEqual(record.completions.map(item => item.revision).sort(), [historical.revision, mixedRevision].sort())
    return mine.id
  }))
  assert.equal(new Set(completed).size, 10)
  // Package launch, retained resume and result evidence coexist with the native cohort.
  const packaged = await preparePackage(f, '1.2', { title: 'Synthetic packaged induction' })
  const packageRevision = (await api('owner', 'course.submit', { course: packaged.id, draftVersion: packaged.draftVersion })).id
  await f.publish(packageRevision)
  const assignment = (await api('owner', 'assignment.create', { course: packaged.id, learners: [learners[0]], dueDate: '2026-11-27' })).created[0]
  const run = async () => h.api('package.launch', sessions[0], { assignment, package: packaged.package, sco: 'one' })
  const first = await run()
  await h.api('package.runtime', sessions[0], { session: first.id, version: 0, event: 'terminate', values: { 'cmi.core.lesson_status': 'incomplete', 'cmi.core.lesson_location': 'synthetic-beam-checkpoint', 'cmi.suspend_data': 'synthetic-beam-resume' } })
  const resumed = await run()
  const html = await (await h.raw(`/beam-package/${resumed.id}/index.html`)).text()
  assert.ok(html.includes('synthetic-beam-checkpoint') && html.includes('synthetic-beam-resume'))
  await h.api('package.runtime', sessions[0], { session: resumed.id, version: 0, event: 'terminate', values: { 'cmi.core.lesson_status': 'passed', 'cmi.core.score.raw': '100' } })
  assert.equal((await h.api(`assignments/${assignment}`, sessions[0])).completion.revision, packageRevision)
  const health = await api('owner', 'operations')
  assert.deepEqual([health.usage.activePeople, health.usage.assignments, health.usage.completions, health.usage.packages], [200, 21, 211, 1])
  console.log(JSON.stringify({ result: 'PASS', head, run: 'sx-beam-c-f1-capacity', runtime: 'local emitted Worker with isolated D1 and R2', activePeople: 200, retainedHistoricalCompletions: 200, cohort: 20, concurrentLearners: 10, originalFiles: 4, packageResume: true, completions: 211, elapsedMs: Math.round(performance.now() - started), boundary: 'Synthetic small media and local runtime only; hosted quotas, production media sizes and actual provider charges unqualified' }))
} finally { await f.h.close() }
