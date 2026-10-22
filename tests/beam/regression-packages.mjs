import assert from 'node:assert/strict'
import { file } from './harness.mjs'
import { scormPackage } from './scorm-fixtures.mjs'

export async function preparePackage(f, standard = '1.2', options = {}) {
  const c = await f.api('owner', 'course.create', { title: options.title || `Cold chain ${standard}`, reviewer: f.ids.reviewer })
  const bytes = scormPackage(standard, options)
  const uploaded = await f.api('owner', 'package.import', { course: c.id, draftVersion: 1, licence: 'owned', licenceEvidence: 'Original Beam package, CC0 1.0 Universal', sources: options.sources || [], exportRestriction: options.restriction || '', file: file('cold-chain.zip', bytes) })
  return { ...c, package: uploaded.id, manifest: uploaded.manifest, draftVersion: uploaded.draftVersion, bytes }
}
export async function publishPackage(f, c) {
  const revision = (await f.api('owner', 'course.submit', { course: c.id, draftVersion: c.draftVersion })).id
  await f.publish(revision)
  const assignment = (await f.api('manager', 'assignment.create', { course: c.id, learners: [f.ids.learner], dueDate: '2030-10-01' })).created[0]
  return { ...c, revision, assignment }
}
const launch = (f, c, sco = 'one') => f.api('learner', 'package.launch', { package: c.package, assignment: c.assignment, sco })
const save = (f, session, values, event = 'terminate', version = 0) => f.api('learner', 'package.runtime', { session: session.id, version, event, values })

export async function package12Check(f) {
  const { api, h, cookies, ids } = f
  const source = await api('owner', 'source.create', { title: 'Cold chain procedure', licence: 'owned', licenceEvidence: 'Employer-authored procedure', reviewer: ids.reviewer, provenance: 'Operations manual', file: file('cold-chain.txt', 'Keep vaccines between 2 and 8 degrees.\nRecord the reading.') })
  const invalidCourse = await api('owner', 'course.create', { title: 'Unsafe package admission', reviewer: ids.reviewer })
  for (const invalid of ['remote', 'unsupported', 'duplicate', 'traversal']) {
    const response = await api('owner', 'package.import', { course: invalidCourse.id, draftVersion: 1, licence: 'owned', licenceEvidence: 'CC0 1.0', file: file('unsafe.zip', scormPackage('1.2', { invalid })) }, 422)
    assert.ok(response.detail)
    if (invalid === 'unsupported') assert.equal(response.error, 'package_unsupported_feature')
  }
  assert.deepEqual((await api('owner', `courses/${invalidCourse.id}`)).draft.packages || [], [])
  await api('learner', 'package.import', { course: invalidCourse.id, draftVersion: 1 }, 403)
  const c = await publishPackage(f, await preparePackage(f, '1.2', { sources: [source.versionId] }))
  const revision = await api('reviewer', `revisions/${c.revision}`)
  assert.equal(revision.packages[0].id, c.package)
  assert.equal((await f.view(c.assignment)).completion, null)
  const preview = await api('owner', 'package.launch', { package: c.package, preview: true })
  const player = await h.raw(preview.href, { cookie: cookies.owner })
  assert.match(await player.text(), /sandbox="allow-scripts"/)
  assert.equal((await f.view(c.assignment)).completion, null, 'preview never records learning')
  await api('owner', 'package.runtime', { session: preview.id, version: 0, event: 'commit', values: {} }, 409)
  const first = await launch(f, c)
  const content = await h.raw(`/beam-package/${first.id}/index.html`)
  assert.equal(content.status, 200, 'narrow asset capability is usable within an opaque sandbox')
  assert.match(content.headers.get('content-security-policy'), /sandbox allow-scripts/)
  assert.match(content.headers.get('content-security-policy'), /connect-src 'none'/)
  assert.match(await content.text(), /LMSInitialize/)
  assert.equal((await h.raw(`/beam-package/${first.id}/missing.js`)).status, 404)
  assert.equal((await h.raw(`/beam-package/${first.id}/%2e%2e%2fsecret`)).status, 404)
  await api('other', 'package.runtime', { session: first.id, version: 0, event: 'commit', values: {} }, 403)
  await api('learner', 'package.runtime', { session: first.id, version: 0, event: 'commit', values: { 'cmi.core.student_id': ids.other } }, 422)
  await save(f, first, { 'cmi.core.lesson_status': 'incomplete', 'cmi.core.lesson_location': 'temperature-check', 'cmi.suspend_data': 'temperature=5;checked=true', 'cmi.core.exit': 'suspend', 'cmi.core.session_time': '0000:01:05.25' })
  assert.equal((await f.view(c.assignment)).completion, null)
  const resumed = await launch(f, c)
  const resumedHtml = await h.raw(`/beam-package/${resumed.id}/index.html`).then(r => r.text())
  assert.ok(resumedHtml.includes('temperature-check') && resumedHtml.includes('temperature=5;checked=true') && resumedHtml.includes('resume'))
  assert.ok(resumedHtml.includes('0000:01:05.25'), 'accumulated time survives a new launch')
  const failed = await save(f, resumed, { 'cmi.core.lesson_status': 'failed', 'cmi.core.score.raw': '95', 'cmi.core.session_time': '0000:00:10.00' })
  assert.equal(failed.failed, true)
  assert.equal(failed.completion, null, 'an explicitly failed package never becomes a completion from its high score')
  const passed = await save(f, await launch(f, c), { 'cmi.core.lesson_status': 'passed', 'cmi.core.score.raw': '90', 'cmi.core.session_time': '0000:00:12.00', 'cmi.interactions.0.id': 'cold-chain-check', 'cmi.interactions.0.type': 'choice', 'cmi.interactions.0.student_response': 'a', 'cmi.interactions.0.result': 'correct' })
  assert.equal(passed.passed, true)
  assert.ok(passed.completion)
  const view = await f.view(c.assignment)
  assert.equal(view.completion.revision, c.revision)
  assert.equal(view.packages[0].id, c.package)
  const evidence = await api('learner', `package-evidence/${c.assignment}`)
  assert.equal(evidence.runs[0].total_time, 87.25)
  assert.equal(evidence.runs[0].state['cmi.core.lesson_location'], 'temperature-check')
  assert.ok(evidence.events.some(e => e.values['cmi.core.lesson_status'] === 'failed'))
  assert.ok(evidence.events.some(e => e.values['cmi.interactions.0.result'] === 'correct'))
  await api('other', `package-evidence/${c.assignment}`, undefined, 404)

  // Published package metadata is a first-class cited carrier, without any native lesson citation.
  const changed = await api('owner', 'source.version', { source: source.id, provenance: 'Revised temperature range', file: file('cold-chain.txt', 'Keep vaccines between 2 and 6 degrees.\nRecord the reading.') })
  const notice = (await api('owner', `courses/${c.id}`)).notices.find(n => n.new_version_id === changed.id)
  assert.ok(notice)
  const impact = await api('owner', `impact/${notice.id}`)
  assert.equal(impact.packages.find(p => p.id === c.package).affected, true)
  const proposal = await api('owner', 'impact.propose', { notice: notice.id, draftVersion: c.draftVersion })
  const proposed = (await api('owner', `courses/${c.id}`)).proposals.find(p => p.id === proposal.id)
  assert.ok(proposed.missing.some(text => /package/i.test(text)))
  assert.equal((await api('reviewer', `revisions/${c.revision}`)).packages[0].id, c.package)

  await api('owner', 'package.remove', { course: c.id, draftVersion: c.draftVersion, package: c.package })
  const restored = await api('owner', 'course.restore', { course: c.id, draftVersion: c.draftVersion + 1, revision: c.revision })
  assert.deepEqual(restored.draft.packages, [c.package])
  assert.equal((await f.view(c.assignment)).completion.revision, c.revision)
  const restricted = await preparePackage(f, '1.2', { restriction: 'Training license forbids redistribution' })
  const native = await f.course('Native vaccine induction')
  const nativeAssignment = await f.assign(native)
  await f.lessons(nativeAssignment)
  const exported = await h.raw('/app/data-export.json', { cookie: cookies.owner }).then(r => { assert.equal(r.status, 200); return r.json() })
  assert.ok(exported.records.beam_lesson_revisions.rows.some(r => r.course_revision_id === native.revision))
  assert.ok(exported.records.beam_completions.rows.some(r => r.assignment_id === nativeAssignment))
  assert.ok(exported.records.beam_package_runs.rows.some(r => r.assignment_id === c.assignment))
  assert.ok(exported.records.beam_package_events.rows.some(e => JSON.parse(e.payload_json)['cmi.core.lesson_status'] === 'failed'))
  const zip = exported.files.find(item => item.id === c.package)
  assert.ok(zip && zip.sha256 && zip.licenceEvidence)
  assert.deepEqual(Buffer.from(await (await h.raw(zip.href, { cookie: cookies.owner })).arrayBuffer()), c.bytes)
  const excluded = exported.exclusions.filter(item => item.package === restricted.package || item.packageId === restricted.package || item.id === restricted.package)
  assert.ok(excluded.length, JSON.stringify(exported.exclusions))
  assert.match(excluded[0].reason, /redistribution/)
  assert.equal((await h.raw(excluded[0].retrievalHref || excluded[0].href, { cookie: cookies.owner })).status, 200)
  assert.ok(!JSON.stringify(exported).includes(first.id), 'export excludes playback asset capabilities')
  assert.equal((await h.raw(zip.href, { cookie: cookies.learner })).status, 403)
  assert.equal((await h.raw(zip.href)).status, 303)
  return c
}

export async function package2004Check(f) {
  const created = []
  for (const standard of ['2004-2', '2004-3', '2004-4']) {
    const c = await publishPackage(f, await preparePackage(f, standard, { multi: true }))
    created.push(c)
    assert.equal(c.manifest.standard, standard)
    assert.deepEqual(c.manifest.scos[1].prerequisites, ['one'])
    await f.api('learner', 'package.launch', { package: c.package, assignment: c.assignment, sco: 'two' }, 409)
    const first = await launch(f, c)
    await save(f, first, { 'cmi.completion_status': 'incomplete', 'cmi.success_status': 'unknown', 'cmi.location': 'step-two', 'cmi.suspend_data': 'range=2-8', 'cmi.exit': 'suspend', 'cmi.session_time': 'PT20S' })
    const resumed = await launch(f, c)
    const html = await f.h.raw(`/beam-package/${resumed.id}/index.html`).then(r => r.text())
    assert.ok(html.includes('step-two') && html.includes('range=2-8') && html.includes('resume'))
    const failed = await save(f, resumed, { 'cmi.completion_status': 'completed', 'cmi.success_status': 'failed', 'cmi.score.scaled': '0.4', 'cmi.session_time': 'PT5S' })
    assert.equal(failed.completed, true)
    assert.equal(failed.failed, true)
    assert.equal(failed.passed, false)
    assert.equal(failed.completion, null)
    await f.api('learner', 'package.launch', { package: c.package, assignment: c.assignment, sco: 'two' }, 409)
    const incomplete = await save(f, await launch(f, c), { 'cmi.completion_status': 'incomplete', 'cmi.success_status': 'passed', 'cmi.score.scaled': '0.9', 'cmi.session_time': 'PT2S' })
    assert.equal(incomplete.completion, null, 'passed but incomplete cannot complete the course')
    const navigating = await save(f, await launch(f, c), { 'cmi.completion_status': 'completed', 'cmi.success_status': 'passed', 'cmi.session_time': 'PT3S', 'adl.nav.request': 'continue' })
    assert.ok(navigating.next?.startsWith('/app/packages/play/'))
    const second = { id: navigating.next.split('/').at(-1) }
    const values = { 'cmi.completion_status': 'completed', 'cmi.success_status': 'passed', 'cmi.score.raw': '90', 'cmi.score.scaled': '0.9', 'cmi.session_time': 'PT4S', 'cmi.objectives.0.id': 'two.objective', 'cmi.objectives.0.success_status': 'failed', 'cmi.objectives.0.completion_status': 'incomplete', 'cmi.interactions.0.id': 'thermometer', 'cmi.interactions.0.type': 'numeric', 'cmi.interactions.0.learner_response': '5', 'cmi.interactions.0.result': 'correct' }
    const objectiveFailed = await save(f, second, values, 'commit')
    assert.equal(objectiveFailed.completion, null)
    assert.equal(objectiveFailed.passed, false)
    const passed = await save(f, second, { ...values, 'cmi.objectives.0.success_status': 'passed', 'cmi.objectives.0.completion_status': 'completed' }, 'terminate', 1)
    assert.ok(passed.completion)
    const evidence = await f.api('learner', `package-evidence/${c.assignment}`)
    assert.equal(evidence.runs.find(r => r.sco_id === 'two').state['cmi.interactions.0.learner_response'], '5')
    assert.equal((await f.view(c.assignment)).completion.revision, c.revision)
  }
  const invalid = await f.api('owner', 'course.create', { title: 'Invalid import', reviewer: f.ids.reviewer })
  for (const kind of ['xml', 'launch']) {
    const result = await f.api('owner', 'package.import', { course: invalid.id, draftVersion: 1, licence: 'owned', licenceEvidence: 'CC0 1.0', file: file('invalid.zip', scormPackage('2004-4', { invalid: kind })) }, 422)
    assert.equal(result.error, 'package_invalid_manifest')
    assert.ok(result.detail.feature)
  }
  assert.deepEqual((await f.api('owner', `courses/${invalid.id}`)).draft.packages || [], [])
  return created
}
