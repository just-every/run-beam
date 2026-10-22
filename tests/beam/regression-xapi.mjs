import { packageArchiveCheck } from './regression-archive.mjs'
import { preparePackage, publishPackage } from './regression-packages.mjs'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { file } from './harness.mjs'
import { activityIri, producerSecret, sendXapi, xapiFixture } from './xapi-fixture.mjs'

export async function prepareXapi(f, suffix = '') {
  const connection = await f.api('owner', 'xapi.connect', { name: 'Authorized training LRS', endpoint: f.lrs.endpoint, key: 'synthetic-beam-1', secret: 'synthetic-beam-2', consent: true })
  const source = await f.api('owner', 'source.create', { title: 'Cold chain SOP', licence: 'owned', licenceEvidence: 'Employer-authored SOP', reviewer: f.ids.reviewer, provenance: 'Operations manual', file: file('sop.txt', 'Keep vaccines between 2 and 8 degrees.') })
  const course = await f.api('owner', 'course.create', { title: `Trusted cold chain activity ${suffix}`, reviewer: f.ids.reviewer })
  const lesson = await f.api('owner', 'course.lesson', { course: course.id, draftVersion: 1, title: 'Native procedure', body: 'Follow the approved vaccine handling procedure.', sources: [] })
  const activity = await f.api('owner', 'xapi.activity', { course: course.id, draftVersion: lesson.draftVersion, connection: connection.id, title: 'Keep vaccines between 2 and 8 degrees', activityIri: f.activityIri || activityIri, launchUrl: f.launchUrl || 'https://synthetic-beam-1.example.test/launch', objectives: 'Keep vaccines between 2 and 8 degrees.', producerSecret, sources: [source.versionId], consent: true })
  const revision = (await f.api('owner', 'course.submit', { course: course.id, draftVersion: activity.draftVersion })).id
  await f.publish(revision)
  const assignment = await f.assign(course)
  return { ...course, connection: connection.id, activity: activity.id, source, revision, assignment, draftVersion: activity.draftVersion }
}
export function xapiStatement(launch, fields = {}) {
  return { id: randomUUID(), actor: launch.actor, verb: { id: 'http://adlnet.gov/expapi/verbs/completed', display: { en: 'completed' } }, object: { objectType: 'Activity', id: launch.activity }, context: { registration: launch.registration }, timestamp: new Date().toISOString(), result: { completion: true, success: true, score: { scaled: 0.9 } }, ...fields }
}
export async function xapiCheck(f) {
  const c = await prepareXapi(f)
  const configuration = await f.api('owner', 'xapi')
  assert.ok(configuration.connections.some(item => item.id === c.connection))
  assert.ok(!JSON.stringify(configuration).includes(producerSecret))
  await f.api('learner', 'xapi', undefined, 403)
  assert.equal((await f.h.raw('/app/integrations', { cookie: f.cookies.owner })).status, 200)
  await f.api('author', 'xapi.connect', { name: 'Forbidden', endpoint: f.lrs.endpoint, key: 'synthetic-beam-1', secret: 'synthetic-beam-2', consent: true }, 403)
  await f.api('owner', 'xapi.connect', { name: 'No consent', endpoint: f.lrs.endpoint, key: 'synthetic-beam-1', secret: 'synthetic-beam-2' }, 422)
  await f.api('owner', 'xapi.connect', { name: 'Unadmitted', endpoint: 'https://unadmitted.example.test/xapi/', key: 'synthetic-beam-1', secret: 'synthetic-beam-2', consent: true }, 403)
  await f.api('other', 'xapi.launch', { assignment: c.assignment, activity: c.activity }, 404)
  const launch = await f.api('learner', 'xapi.launch', { assignment: c.assignment, activity: c.activity })
  assert.ok(!JSON.stringify(launch).includes(producerSecret))
  assert.ok(!JSON.stringify(launch).includes('learner@example.test'))
  assert.notEqual(launch.actor.account.name, f.ids.learner)
  assert.equal(new URL(launch.href).searchParams.get('registration'), launch.registration)
  const original = xapiStatement(launch)
  assert.equal((await sendXapi(f, c.activity, original, { password: 'synthetic-beam-6' })).status, 401)
  assert.equal((await sendXapi(f, c.activity, { ...original, actor: { ...original.actor, account: { ...original.actor.account, name: f.ids.other } } })).status, 403)
  assert.equal((await sendXapi(f, c.activity, { ...original, object: { id: 'https://synthetic-beam-1.example.test/foreign' } })).status, 403)
  assert.equal((await sendXapi(f, c.activity, { ...original, context: { registration: randomUUID() } })).status, 403)
  assert.equal((await sendXapi(f, c.activity, { ...original, authority: { account: { homePage: f.h.origin, name: 'owner' } } })).status, 400)
  // Incomplete evidence is retained without becoming course completion.
  const incomplete = xapiStatement(launch, { result: { completion: false, success: true } })
  assert.equal((await sendXapi(f, c.activity, incomplete)).status, 200)
  assert.equal((await f.view(c.assignment)).xapiActivities[0].passed, false)
  const bytes = Buffer.from('Observed vaccine temperature: 5 degrees.\n'), hash = createHash('sha256').update(bytes).digest('hex')
  const statement = xapiStatement(launch, { attachments: [{ usageType: 'http://adlnet.gov/expapi/attachments/evidence', display: { en: 'Temperature evidence' }, contentType: 'text/plain', length: bytes.length, sha2: hash }] })
  if (!f.live) {
    f.lrs.edge.refuse = true
    assert.equal((await sendXapi(f, c.activity, statement, { bytes })).status, 502)
    assert.equal((await f.view(c.assignment)).xapiActivities[0].passed, false)
    f.lrs.edge.refuse = false
  }
  const accepted = await sendXapi(f, c.activity, statement, { bytes })
  assert.equal(accepted.status, 200, await accepted.text())
  assert.equal((await f.view(c.assignment)).xapiActivities[0].passed, true)
  assert.equal((await f.view(c.assignment)).completion, null, 'trusted LRS result cannot bypass native lesson')
  assert.equal((await sendXapi(f, c.activity, statement, { bytes })).status, 200)
  assert.equal((await sendXapi(f, c.activity, { ...statement, result: { completion: true, success: false } }, { bytes })).status, 409)
  const evidence = await f.api('learner', `xapi-evidence/${c.assignment}`)
  assert.equal(evidence.statements.filter(s => s.id === statement.id).length, 1)
  assert.deepEqual(evidence.statements.find(s => s.id === statement.id).statement, statement)
  const attachment = await f.h.raw(`/app/xapi/attachments/${statement.id}/${hash}`, { cookie: f.cookies.learner })
  assert.deepEqual(Buffer.from(await attachment.arrayBuffer()), bytes)
  assert.equal((await f.h.raw(`/app/xapi/attachments/${statement.id}/${hash}`, { cookie: f.cookies.other })).status, 404)
  await f.lessons(c.assignment)
  assert.equal((await f.view(c.assignment)).completion.revision, c.revision)
  assert.equal((await sendXapi(f, c.activity, statement, { bytes, method: 'PUT' })).status, 204)
  await f.api('owner', 'xapi.remove', { course: c.id, draftVersion: c.draftVersion, activity: c.activity })
  const restored = await f.api('author', 'course.restore', { course: c.id, draftVersion: c.draftVersion + 1, revision: c.revision })
  assert.deepEqual(restored.draft.xapiActivities, [c.activity])
  assert.equal((await f.view(c.assignment)).completion.revision, c.revision)
  const changed = await f.api('owner', 'source.version', { source: c.source.id, provenance: 'Reviewed updated range', file: file('sop.txt', 'Keep vaccines between 2 and 6 degrees.') })
  const notice = (await f.api('owner', `courses/${c.id}`)).notices.find(n => n.new_version_id === changed.id)
  const impact = await f.api('owner', `impact/${notice.id}`)
  assert.ok(impact.packages.some(p => p.id === c.activity && p.type === 'xapi' && p.affected))
  const originalActivity = (await f.api('owner', `revisions/${c.revision}`)).xapiActivities[0]
  const proposal = await f.api('owner', 'impact.propose', { notice: notice.id, draftVersion: restored.draftVersion })
  const proposed = (await f.api('owner', `courses/${c.id}`)).proposals.find(item => item.id === proposal.id)
  assert.ok(proposed.missing.some(item => item.includes(originalActivity.title)), 'affected activity needs human replacement')
  assert.deepEqual((await f.api('owner', `revisions/${c.revision}`)).xapiActivities[0], originalActivity, 'impact preparation does not rewrite the reviewed activity')
  const exported = await f.h.raw('/app/data-export.json', { cookie: f.cookies.owner }).then(r => r.json())
  assert.ok(exported.records.beam_xapi_statements.rows.some(s => s.id === statement.id))
  assert.ok(exported.records.beam_revision_xapi.rows.some(r => r.course_revision_id === c.revision))
  assert.ok(!JSON.stringify(exported).includes(producerSecret))
  assert.ok(!JSON.stringify(exported).includes('authorization_sealed'))
  const exportedFile = exported.files.find(item => item.sha256 === hash)
  assert.ok(exportedFile)
  assert.deepEqual(Buffer.from(await (await f.h.raw(exportedFile.href, { cookie: f.cookies.owner })).arrayBuffer()), bytes)
  const failedAssignment = await f.assign(c)
  const failingLaunch = await f.api('learner', 'xapi.launch', { assignment: failedAssignment, activity: c.activity })
  const failed = xapiStatement(failingLaunch, { result: { completion: true, success: false } })
  assert.equal((await sendXapi(f, c.activity, failed)).status, 200)
  assert.equal((await f.view(failedAssignment)).xapiActivities[0].failed, true)
  assert.equal((await sendXapi(f, c.activity, xapiStatement(failingLaunch))).status, 409)
  const freshLaunch = await f.api('learner', 'xapi.launch', { assignment: failedAssignment, activity: c.activity })
  assert.notEqual(freshLaunch.registration, failingLaunch.registration)
  assert.equal(freshLaunch.actor.account.name, launch.actor.account.name, 'stable actor pseudonym across attempts')
  const competing = xapiStatement(freshLaunch)
  const responses = await Promise.all([sendXapi(f, c.activity, competing), sendXapi(f, c.activity, { ...competing, result: { completion: true, success: true, score: { scaled: 0.8 } } })])
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409], 'conflicting concurrent UUID submissions retain only the admitted statement')
  await f.lessons(failedAssignment)
  assert.ok((await f.view(failedAssignment)).completion)
  const next = await f.assign(c), pending = await f.api('learner', 'xapi.launch', { assignment: next, activity: c.activity })
  await f.api('owner', 'xapi.revoke', { connection: c.connection })
  assert.equal((await sendXapi(f, c.activity, xapiStatement(pending))).status, 403)
  await f.api('learner', 'xapi.launch', { assignment: next, activity: c.activity }, 403)
  assert.equal((await f.view(next)).completion, null)
  return { ...c, statement: statement.id, attachment: hash, registration: launch.registration }
}
export async function isolatedXapiCheck() {
  const f = await xapiFixture()
  try { return await xapiCheck(f) } finally { await f.h.close() }
}

// Archive custody is a separate public command flow, sharded with durability in push CI.
export async function isolatedXapiArchiveCheck() {
  const f = await xapiFixture()
  try {
    const c = await prepareXapi(f, 'archive custody')
    const launch = await f.api('learner', 'xapi.launch', { assignment: c.assignment, activity: c.activity })
    const bytes = Buffer.from('Archived observed vaccine temperature: 5 degrees.\n'), hash = createHash('sha256').update(bytes).digest('hex')
    const statement = xapiStatement(launch, { attachments: [{ usageType: 'http://adlnet.gov/expapi/attachments/evidence', display: { en: 'Archived temperature observation' }, contentType: 'text/plain', length: bytes.length, sha2: hash }] })
    assert.equal((await sendXapi(f, c.activity, statement, { bytes })).status, 200)
    await f.lessons(c.assignment)
    const completion = (await f.view(c.assignment)).completion.id
    const pending = await f.assign(c)
    await f.api('learner', 'xapi.launch', { assignment: pending, activity: c.activity })
    const pkg = await publishPackage(f, await preparePackage(f, '1.2', { title: 'Archive cold chain package' }))
    const run = await f.api('learner', 'package.launch', { package: pkg.package, assignment: pkg.assignment })
    await f.api('learner', 'package.runtime', { session: run.id, version: 0, event: 'terminate', values: { 'cmi.core.lesson_status': 'passed', 'cmi.core.score.raw': '90' } })
    const packageCompletion = (await f.view(pkg.assignment)).completion.id
    const preview = await f.api('owner', 'package.launch', { package: pkg.package, preview: true })
    assert.equal((await f.h.raw(`/beam-package/${preview.id}/index.html`)).status, 200)
    await packageArchiveCheck(f, { packageAssignment: pkg.assignment, packageSession: preview.id, xapiAssignment: c.assignment, xapiConnection: c.connection, xapiActivity: c.activity, xapiStatement: statement.id, completion, packageCompletion })
  } finally { await f.h.close() }
}
