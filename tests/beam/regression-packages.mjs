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
  const source = await f.api('owner', 'source.create', { title: '2004 vaccine procedure', licence: 'owned', licenceEvidence: 'Employer-authored SOP', reviewer: f.ids.reviewer, provenance: 'Operations manual', file: file('vaccines.txt', 'Keep vaccines between 2 and 8 degrees.') })
  const created = []
  for (const standard of ['2004-2', '2004-3', '2004-4']) {
    const c = await publishPackage(f, await preparePackage(f, standard, { multi: true, sources: [source.versionId] }))
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
  for (const kind of ['xml', 'launch', 'unsupported']) {
    const result = await f.api('owner', 'package.import', { course: invalid.id, draftVersion: 1, licence: 'owned', licenceEvidence: 'CC0 1.0', file: file('invalid.zip', scormPackage('2004-4', { invalid: kind })) }, 422)
    assert.equal(result.error, kind === 'unsupported' ? 'package_unsupported_feature' : 'package_invalid_manifest')
    assert.ok(result.detail.feature)
  }
  assert.deepEqual((await f.api('owner', `courses/${invalid.id}`)).draft.packages || [], [])
  const revised = await f.api('owner', 'source.version', { source: source.id, provenance: 'New approved range', file: file('vaccines.txt', 'Keep vaccines between 2 and 6 degrees.') })
  for (const c of created) {
    const notice = (await f.api('owner', `courses/${c.id}`)).notices.find(notice => notice.new_version_id === revised.id)
    assert.ok(notice)
    const impact = await f.api('owner', `impact/${notice.id}`)
    assert.ok(impact.packages.some(pkg => pkg.id === c.package && pkg.affected))
  }
  // Every edition inherits the same independent interchange and restricted-file contract.
  const baseline = await preparePackage(f, '1.2')
  const native = await f.course('Mixed estate native procedure')
  const restricted = await preparePackage(f, '2004-4', { multi: true, restriction: 'Internal training license: no redistribution' })
  const exported = await f.h.raw('/app/data-export.json', { cookie: f.cookies.owner }).then(response => response.json())
  assert.ok(exported.records.beam_lesson_revisions.rows.some(row => row.course_revision_id === native.revision))
  assert.ok(exported.files.some(item => item.id === baseline.package))
  for (const c of created) {
    const original = exported.files.find(item => item.id === c.package)
    assert.ok(original)
    assert.deepEqual(Buffer.from(await (await f.h.raw(original.href, { cookie: f.cookies.owner })).arrayBuffer()), c.bytes)
    assert.ok(exported.records.beam_revision_packages.rows.some(row => row.course_revision_id === c.revision && row.package_id === c.package))
    assert.ok(exported.records.beam_package_events.rows.some(row => JSON.parse(row.payload_json)['cmi.interactions.0.learner_response'] === '5'))
  }
  const withheld = exported.exclusions.filter(item => item.packageId === restricted.package)
  assert.equal(withheld.length, exported.records.beam_package_assets.rows.filter(row => row.package_id === restricted.package).length + 1)
  assert.ok(withheld.every(item => item.reason.includes('no redistribution') && item.sha256 && item.size && item.retrievalHref))
  for (const item of withheld) assert.equal((await f.h.raw(item.retrievalHref, { cookie: f.cookies.owner })).status, 200)
  return created
}

// PACK-004 through import/review/assignment and the AU's public protocol, with only the remote LRS edge faked.
export async function cmi5Check() {
  const { xapiFixture } = await import('./xapi-fixture.mjs')
  const { cmi5Package } = await import('./scorm-fixtures.mjs')
  const { randomUUID } = await import('node:crypto')
  const f = await xapiFixture()
  try {
    const connection = await f.api('owner', 'xapi.connect', { name: 'cmi5 LRS', endpoint: f.lrs.endpoint, key: 'synthetic-beam-1', secret: 'synthetic-beam-2', consent: true })
    const source = await f.api('owner', 'source.create', { title: 'Vaccine SOP', licence: 'owned', licenceEvidence: 'Employer-authored SOP', reviewer: f.ids.reviewer, provenance: 'Operations manual', file: file('sop.txt', 'Keep vaccines between 2 and 8 degrees.') })
    const c = await f.api('owner', 'course.create', { title: 'cmi5 cold chain', reviewer: f.ids.reviewer })
    const imported = await f.api('owner', 'package.import', { course: c.id, draftVersion: 1, licence: 'owned', licenceEvidence: 'Original CC0 AU', file: file('cmi5.zip', cmi5Package()), connection: connection.id, consent: true, sources: [source.versionId] })
    assert.equal(imported.manifest.standard, 'cmi5')
    assert.equal(imported.manifest.scos[0].moveOn, 'CompletedAndPassed')
    const au = imported.manifest.scos[0].id
    const native = await f.api('owner', 'course.lesson', { course: c.id, draftVersion: imported.draftVersion, title: 'Native required procedure', body: 'Follow the approved SOP.', sources: [source.versionId] })
    const assessed = await f.api('owner', 'course.question', { course: c.id, draftVersion: native.draftVersion, prompt: 'Safe vaccine temperature?', choices: '5 degrees\n20 degrees', correct: '1', explanation: '2 to 8 degrees.' })
    const rules = await f.api('owner', 'course.assessment', { course: c.id, draftVersion: assessed.draftVersion, passPercent: 80, maxAttempts: 3 })
    const revision = (await f.api('owner', 'course.submit', { course: c.id, draftVersion: rules.draftVersion })).id
    await f.publish(revision)
    const assignment = await f.assign(c)
    await f.api('other', 'package.launch', { package: imported.id, assignment }, 404)
    async function launch(assignmentId = assignment) {
      const result = await f.api('learner', 'package.launch', { package: imported.id, assignment: assignmentId })
      const player = await f.h.raw(result.href, { cookie: f.cookies.learner }).then(r => r.text())
      const escaped = player.match(/<iframe[^>]+src="([^"]+)"/)[1]
      const asset = new URL(escaped.replaceAll('&amp;', '&').replaceAll('&#39;', "'"), f.h.origin)
      const fetchUrl = new URL(asset.searchParams.get('fetch'))
      const token = await f.h.fetch(fetchUrl.pathname, { method: 'POST' }).then(r => r.json())
      assert.ok(token['auth-token'])
      const duplicateFetch = await f.h.fetch(fetchUrl.pathname, { method: 'POST' }).then(r => r.json())
      assert.equal(duplicateFetch.error.code, '1')
      const headers = { authorization: `Basic ${token['auth-token']}`, 'x-experience-api-version': '1.0.3', 'content-type': 'application/json' }
      const stateUrl = id => { const u = new URL(asset.searchParams.get('endpoint') + 'activities/state'); for (const [k,v] of Object.entries({ stateId: id, agent: asset.searchParams.get('actor'), activityId: au, registration: result.registration })) u.searchParams.set(k, v); return u.pathname + u.search }
      const data = await f.h.fetch(stateUrl('LMS.LaunchData'), { headers }).then(r => r.json())
      assert.equal(data.moveOn, 'CompletedAndPassed'); assert.equal(data.contextTemplate.extensions['https://w3id.org/xapi/cmi5/context/extensions/sessionid'], result.sessionId)
      const make = (verb, resultValue) => ({ id: randomUUID(), actor: JSON.parse(asset.searchParams.get('actor')), object: { objectType: 'Activity', id: au }, verb: { id: `http://adlnet.gov/expapi/verbs/${verb}` }, context: { ...structuredClone(data.contextTemplate), ...(resultValue?.success !== undefined || resultValue?.completion !== undefined ? { contextActivities: { ...data.contextTemplate.contextActivities, category: [...data.contextTemplate.contextActivities.category, { id: 'https://w3id.org/xapi/cmi5/context/categories/moveon' }] } } : {}) }, timestamp: new Date().toISOString(), ...(resultValue ? { result: resultValue } : {}) })
      const send = async (statement, status = 200, extra = {}) => { const r = await f.h.fetch(`/api/beam/cmi5/${result.id}/statements`, { method: 'POST', headers, body: JSON.stringify(statement), ...extra }); assert.equal(r.status, status, await r.text()); return statement }
      return { ...result, asset, headers, stateUrl, data, make, send }
    }
    const first = await launch()
    await first.send(first.make('completed', { completion: true, duration: 'PT1S' }), 409)
    await first.send(first.make('initialized'))
    const foreign = first.make('completed', { completion: true, duration: 'PT1S' }); foreign.actor.account.name = 'synthetic-beam-99'
    await first.send(foreign, 403)
    const wrongSession = first.make('completed', { completion: true, duration: 'PT1S' }); wrongSession.context.extensions['https://w3id.org/xapi/cmi5/context/extensions/sessionid'] = randomUUID()
    await first.send(wrongSession, 403)
    assert.equal((await f.h.fetch(first.stateUrl('LMS.LaunchData'), { method: 'PUT', headers: first.headers, body: '{}' })).status, 403)
    const bookmark = await f.h.fetch(first.stateUrl('bookmark'), { method: 'PUT', headers: { ...first.headers, 'if-none-match': '*' }, body: '{"place":"temperature-check"}' })
    assert.equal(bookmark.status, 204)
    assert.equal((await f.h.fetch(first.stateUrl('bookmark'), { method: 'PUT', headers: { ...first.headers, 'if-match': '"wrong"' }, body: '{}' })).status, 412)
    // New session marks an interrupted AU abandoned and preserves both registration and resume state.
    const resumed = await launch()
    assert.equal(resumed.registration, first.registration); assert.notEqual(resumed.sessionId, first.sessionId)
    assert.deepEqual(await f.h.fetch(resumed.stateUrl('bookmark'), { headers: resumed.headers }).then(r => r.json()), { place: 'temperature-check' })
    await first.send(first.make('terminated', { duration: 'PT1S' }), 401)
    await resumed.send(resumed.make('initialized'))
    await resumed.send(resumed.make('passed', { success: true, duration: 'PT1S', score: { scaled: 0.4 } }), 422)
    await resumed.send(resumed.make('failed', { success: false, duration: 'PT1S', score: { scaled: 0.4 } }))
    await resumed.send(resumed.make('passed', { success: true, duration: 'PT1S', score: { scaled: 0.9 } }), 409)
    await resumed.send(resumed.make('terminated', { duration: 'PT1S' }))
    assert.equal((await f.view(assignment)).completion, null)
    const passing = await launch()
    await passing.send(passing.make('initialized'))
    const completed = passing.make('completed', { completion: true, duration: 'PT1S' })
    f.lrs.edge.refuse = true
    await passing.send(completed, 502)
    assert.equal((await f.view(assignment)).packages[0].scos[0].completed, false)
    f.lrs.edge.refuse = false
    await passing.send(completed)
    await passing.send(completed)
    assert.equal((await f.view(assignment)).packages[0].scos[0].completed, false, 'CompletedAndPassed requires both distinct verbs')
    await passing.send(passing.make('passed', { success: true, duration: 'PT1S', score: { scaled: 0.9 } }))
    await passing.send(passing.make('terminated', { duration: 'PT1S' }))
    assert.equal((await f.view(assignment)).completion, null, 'native lesson and quiz remain required')
    await f.lessons(assignment)
    assert.equal((await f.view(assignment)).completion, null, 'required native quiz is retained')
    const question = (await f.view(assignment)).quiz.questions[0]
    const quiz = await f.api('learner', 'quiz.submit', { assignment, [`q_${question.id}`]: ['0'] })
    assert.ok(quiz)
    assert.equal((await f.view(assignment)).completion.revision, revision)
    await passing.send(completed)
    const evidence = await f.api('learner', `cmi5-evidence/${assignment}`)
    assert.deepEqual(evidence.sessions.map(s => s.lifecycle), ['abandoned', 'terminated', 'terminated'])
    assert.equal(evidence.sessions[1].resumed, 1)
    assert.equal(evidence.statements.filter(s => s.id === completed.id).length, 1)
    assert.deepEqual(evidence.statements.find(s => s.id === completed.id).statement, completed)
    assert.equal(evidence.statements.filter(s => s.verb === 'satisfied').length, 1)
    assert.ok(f.lrs.records.has(completed.id))
    await f.api('other', `cmi5-evidence/${assignment}`, undefined, 404)
    const exported = await f.h.raw('/app/data-export.json', { cookie: f.cookies.owner }).then(r => r.json())
    assert.ok(exported.records.beam_cmi5_statements.rows.some(s => s.id === completed.id))
    assert.ok(!JSON.stringify(exported).includes(passing.headers.authorization))
    assert.ok(!JSON.stringify(exported).includes('fetch_hash'))
    const changed = await f.api('owner', 'source.version', { source: source.id, provenance: 'Updated reviewed range', file: file('sop.txt', 'Keep vaccines between 2 and 6 degrees.') })
    const notice = (await f.api('owner', `courses/${c.id}`)).notices.find(n => n.new_version_id === changed.id)
    assert.ok((await f.api('owner', `impact/${notice.id}`)).packages.some(p => p.id === imported.id && p.type === 'cmi5' && p.affected))
    const pending = await f.assign(c), revoked = await launch(pending)
    await f.api('owner', 'xapi.revoke', { connection: connection.id })
    await revoked.send(revoked.make('initialized'), 403)
    await f.api('learner', 'package.launch', { package: imported.id, assignment: pending }, 403)
    // The five declared moveOn rules are tested through actual imported/assigned AUs below.
    for (const rule of ['Passed', 'Completed', 'CompletedOrPassed', 'NotApplicable']) {
      const conn = await f.api('owner', 'xapi.connect', { name: rule, endpoint: f.lrs.endpoint, key: 'synthetic-beam-1', secret: 'synthetic-beam-2', consent: true })
      const course = await f.api('owner', 'course.create', { title: rule, reviewer: f.ids.reviewer })
      const pkg = await f.api('owner', 'package.import', { course: course.id, draftVersion: 1, licence: 'owned', licenceEvidence: 'Original CC0 AU', file: file('cmi5.zip', cmi5Package({ moveOn: rule })), connection: conn.id, consent: true })
      const rev = (await f.api('owner', 'course.submit', { course: course.id, draftVersion: pkg.draftVersion })).id
      await f.publish(rev)
      const assigned = await f.assign(course), launch = await f.api('learner', 'package.launch', { package: pkg.id, assignment: assigned })
      const html = await f.h.raw(launch.href, { cookie: f.cookies.learner }).then(r => r.text())
      const asset = new URL(html.match(/<iframe[^>]+src="([^"]+)"/)[1].replaceAll('&amp;', '&'), f.h.origin)
      const token = await f.h.fetch(new URL(asset.searchParams.get('fetch')).pathname, { method: 'POST' }).then(r => r.json())
      const headers = { authorization: `Basic ${token['auth-token']}`, 'content-type': 'application/json', 'x-experience-api-version': '1.0.3' }
      const session = launch.sessionId
      async function send(verb, result) {
        const context = { registration: launch.registration, extensions: { 'https://w3id.org/xapi/cmi5/context/extensions/sessionid': session }, contextActivities: { grouping: [{ id: au }], category: [{ id: 'https://w3id.org/xapi/cmi5/context/categories/cmi5' }, ...(result?.success !== undefined || result?.completion !== undefined ? [{ id: 'https://w3id.org/xapi/cmi5/context/categories/moveon' }] : [])] } }
        const response = await f.h.fetch(`/api/beam/cmi5/${launch.id}/statements`, { method: 'POST', headers, body: JSON.stringify({ id: randomUUID(), actor: JSON.parse(asset.searchParams.get('actor')), verb: { id: `http://adlnet.gov/expapi/verbs/${verb}` }, object: { id: au }, context, timestamp: new Date().toISOString(), ...(result ? { result } : {}) }) })
        assert.equal(response.status, 200, await response.text())
      }
      await send('initialized')
      assert.equal((await f.view(assigned)).completion, null)
      if (rule === 'Passed') await send('passed', { success: true, duration: 'PT1S' })
      if (rule === 'Completed' || rule === 'CompletedOrPassed') await send('completed', { completion: true, duration: 'PT1S' })
      await send('terminated', { duration: 'PT1S' })
      assert.equal((await f.view(assigned)).completion.revision, rev, rule)
    }
    return { assignment, revision, package: imported.id }
  } finally { await f.h.close() }
}
