import assert from 'node:assert/strict'
import { microsoftFixture, microsoftSite } from './microsoft-fixture.mjs'
import { file } from './harness.mjs'
import { sourceDocx, sourceParagraph, sourceProcedureDocx } from './source-fixtures.mjs'
export async function microsoftSourceCheck() {
  const f = await microsoftFixture()
  try {
    const { api, h, state, ids, cookies } = f
    await api('author', 'microsoft.configure', { operation: 'connect' }, 403)
    await api('manager', 'microsoft', undefined, 403)
    await api('learner', 'microsoft.preview', { item: 'synthetic-beam-procedure' }, 403)
    assert.equal(state.requests.length, 0)
    await api('owner', 'microsoft.configure', { operation: 'connect', consent: false }, 409)
    const probe = await api('owner', 'microsoft.check', { consent: true })
    assert.equal(probe.token, 'accepted'); assert.equal(probe.directoryUsers, 1); assert.equal(probe.licensedUsers, 0)
    assert.deepEqual(probe.sites, [{ id: microsoftSite, name: 'Sierra Lakes operations' }])
    await f.connect()
    const listed = await api('owner', 'microsoft.browse', {})
    assert.deepEqual(listed.items.map(row => [row.id, row.name]), [['synthetic-beam-procedure', 'Opening procedure.docx']])
    state.wrongBoundary = true
    await api('owner', 'microsoft.preview', { item: 'synthetic-beam-procedure' }, 409)
    state.wrongBoundary = false
    state.redirect = 'synthetic-beam-9006 invalid destination'
    await api('owner', 'microsoft.preview', { item: 'synthetic-beam-procedure' }, 409)
    state.redirect = 'https://outside.example.test/private'
    await api('owner', 'microsoft.preview', { item: 'synthetic-beam-procedure' }, 409)
    state.redirect = 'https://synthetic-beam.sharepoint.com/download?code=synthetic-beam-4'
    const p = await f.preview()
    assert.equal(p.lessons.length, 2); assert.equal(p.lessons[0].body, 'Wash hands & inspect tools.')
    assert.deepEqual(p.permissions, [{ id: 'synthetic-beam-1', roles: ['read'], inheritedFrom: null }])
    assert.equal(state.requests.findLast(row => row.operation === 'download').authorization, false)
    assert.equal((await api('author', 'sources')).length, 0, 'preview creates no source')
    await api('owner', 'microsoft.import', { ...p, reviewed: false }, 409)
    state.version = 2
    await api('owner', 'microsoft.import', { ...p, reviewed: true }, 409)
    state.version = 1
    const source = await f.imported()
    const saved = (await api('author', 'sources')).find(row => row.id === source.id)
    assert.equal(saved.licenceEvidence, 'Employer authored work procedure')
    const provenance = JSON.parse(saved.versions[0].provenance)
    assert.equal(provenance.site, microsoftSite); assert.equal(provenance.library, 'synthetic-beam-library'); assert.equal(provenance.item, 'synthetic-beam-procedure'); assert.equal(provenance.etag, 'synthetic-beam-1')
    assert.deepEqual(provenance.permissions, p.permissions)
    const extraction = await api('author', `sources/${source.versionId}/extraction`)
    const c = await api('author', 'course.create', { title: 'Opening safety', reviewer: ids.reviewer })
    await api('author', 'source.convert', { course: c.id, draftVersion: 1, sourceVersion: source.versionId, reviewed: false, lessons: extraction.lessons }, 409)
    const converted = await api('author', 'source.convert', { course: c.id, draftVersion: 1, sourceVersion: source.versionId, reviewed: true, lessons: extraction.lessons, resolvedUncertainties: extraction.uncertainties.map(row => row.id) })
    assert.equal((await api('author', `courses/${c.id}`)).publishedRevision, null)
    const revision = await api('author', 'course.submit', { course: c.id, draftVersion: converted.draftVersion })
    await f.publish(revision.id)
    const assignment = await f.assign({ id: c.id, revision: revision.id })
    assert.equal((await f.view(assignment)).lessons[0].body, 'Wash hands & inspect tools.')
    const original = await h.raw(`/api/beam/source-files/${source.versionId}`, { cookie: cookies.author })
    assert.deepEqual(Buffer.from(await original.arrayBuffer()), state.document)
    await api('author', 'source.version', { source: source.id, provenance: 'Bypass', file: file('synthetic-beam-1.txt', 'Altered') }, 409)
    state.version = 2
    state.document = sourceDocx(sourceParagraph('Wear clean gloves before inspecting the probe.'))
    const sync = await api('owner', 'microsoft.sync', { source: source.id })
    assert.equal(sync.changed, true); assert.deepEqual(sync.affectedCourses, [c.id])
    const changedDocument = await api('author', `sources/${sync.versionId}/extraction`)
    assert.equal(changedDocument.lessons[0].body, 'Wear clean gloves before inspecting the probe.')
    const retainedOriginal = await h.raw(`/api/beam/source-files/${source.versionId}`, { cookie: cookies.author })
    assert.deepEqual(Buffer.from(await retainedOriginal.arrayBuffer()), sourceProcedureDocx)
    const course = await api('author', `courses/${c.id}`)
    assert.deepEqual(course.notices.map(row => [row.previous_version_id, row.new_version_id, row.state]), [[source.versionId, sync.versionId, 'open']])
    assert.deepEqual(await api('owner', 'microsoft.sync', { source: source.id }), { changed: false, source: source.id })
    state.permissions = [{ id: 'synthetic-beam-removed', roles: ['read'] }]
    await api('owner', 'microsoft.sync', { source: source.id }, 409)
    for (const [role, path] of [['author', `source-files/${source.versionId}`], ['author', `sources/${source.versionId}/extraction`], ['author', `courses/${c.id}`], ['learner', `assignments/${assignment}`]]) await api(role, path, undefined, 409)
    assert.equal((await api('author', 'sources')).length, 0)
    await api('owner', 'assignment.create', { course: c.id, learners: [ids.assessor], dueDate: '2030-10-01', dueTime: '17:00', timezone: 'UTC' }, 409)
    const deniedExport = await h.raw('/app/data-export.json', { cookie: cookies.owner })
    assert.equal(deniedExport.status, 409)
    const statuses = await api('owner', 'microsoft-sources')
    assert.deepEqual(statuses.map(row => [row.source, row.state]), [[source.id, 'revoked']])
    assert.deepEqual(JSON.parse(statuses[0].affectedRevisions), [revision.id])
    state.permissions = [{ id: 'synthetic-beam-1', roles: ['read'] }]
    await api('author', `source-files/${source.versionId}`, undefined, 409)
    await f.connect()
    const replacement = await f.imported()
    state.denied = true
    await api('author', `source-files/${replacement.versionId}`, undefined, 409)
    state.denied = false
    await api('owner', 'microsoft.configure', { operation: 'revoke' })
    const calls = state.requests.length
    await api('owner', 'microsoft.preview', { item: 'synthetic-beam-procedure' }, 409)
    assert.equal(state.requests.length, calls, 'revoked connection makes no provider call')
    const audit = await api('owner', 'audit')
    assert.ok(audit.events.some(row => row.action === 'microsoft.import'))
    assert.ok(audit.events.some(row => row.action === 'microsoft.rights_revoked'))
    assert.ok(!JSON.stringify(audit).includes('synthetic-beam-9 private detail'))
  } finally { await f.h.close() }
}
