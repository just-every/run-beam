import assert from 'node:assert/strict'
import { zip, pdf } from './fixtures.mjs'
import { file } from './harness.mjs'

// A real deflated Office Open XML document. The foreign URL is document data,
// never a resource the extractor may fetch. All application behavior uses HTTP.
const document = body => zip([
  ['[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
  ['_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
  ['word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr/></w:body></w:document>`],
  ['word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdExternal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://untrusted.example.test/procedure" TargetMode="External"/></Relationships>'],
])
const paragraph = text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
const heading = text => `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
const original = document(heading('Prepare the station') + paragraph('Wash hands &amp; inspect tools.') + '<w:tbl><w:tr><w:tc>' + paragraph('Tool') + '</w:tc><w:tc>' + paragraph('Condition') + '</w:tc></w:tr><w:tr><w:tc>' + paragraph('Probe') + '</w:tc><w:tc>' + paragraph('Clean') + '</w:tc></w:tr></w:tbl>' + '<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Diagram" descr="Probe position"/></wp:inline></w:drawing></w:r></w:p>' + heading('Close the station') + paragraph('&lt;script&gt;do not execute&lt;/script&gt; Store tools.'))

export async function sourceExtractionCheck(f) {
  const { api, h, cookies, ids } = f
  const upload = (name, bytes) => api('author', 'source.create', { title: 'Station procedure', licence: 'owned', licenceEvidence: 'Employer-authored procedure', reviewer: ids.reviewer, provenance: 'Operations manual', file: file(name, bytes) })
  const source = await upload('station.docx', original)
  const course = await api('author', 'course.create', { title: 'Station training', reviewer: ids.reviewer })
  const before = await api('author', `courses/${course.id}`)
  const preview = await api('author', `sources/${source.versionId}/extraction`)
  assert.equal(preview.provenance, 'Operations manual')
  assert.deepEqual(preview.lessons.map(lesson => lesson.title), ['Prepare the station', 'Close the station'])
  assert.match(preview.lessons[0].body, /Wash hands & inspect tools\./)
  assert.match(preview.lessons[0].body, /Tool\tCondition\nProbe\tClean/)
  assert.match(preview.lessons[0].body, /\[Image: Probe position\]/)
  assert.match(preview.lessons[1].body, /<script>do not execute<\/script>/)
  assert.ok(preview.warnings.some(warning => warning.includes('Image bytes are not converted')))
  assert.equal(preview.reviewRequired, true)
  assert.deepEqual(await api('author', `courses/${course.id}`), before) // preview writes no draft or revision
  const bytes = await h.raw(preview.original, { cookie: cookies.author })
  assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), original)
  await api('learner', `sources/${source.versionId}/extraction`, undefined, 403)
  await api('manager', `sources/${source.versionId}/extraction`, undefined, 403)

  // Corrections and approval are explicit; no conversion may publish or replace
  // a concurrently edited draft. Both JSON and ordinary form doors work.
  const lessons = preview.lessons.map(lesson => ({ ...lesson }))
  lessons[0].body = lessons[0].body.replace('inspect tools', 'sanitize and inspect tools')
  const convert = { course: course.id, draftVersion: before.draftVersion, sourceVersion: source.versionId, lessons }
  await api('author', 'source.convert', convert, 409)
  await api('learner', 'source.convert', { ...convert, reviewed: true }, 403)
  const denied = await api('author', 'source.convert', { ...convert, reviewed: true, lessons: [null] }, 400)
  assert.equal(denied.error, 'invalid_lesson')
  const applied = await api('author', 'source.convert', { ...convert, reviewed: true })
  assert.deepEqual(applied.draft.lessons.map(lesson => [lesson.title, lesson.body, lesson.sources]), lessons.map(lesson => [lesson.title, lesson.body, [source.versionId]]))
  assert.equal((await api('author', `courses/${course.id}`)).publishedRevision, null)
  await api('author', 'source.convert', { ...convert, reviewed: true }, 409)
  assert.equal((await api('author', `courses/${course.id}`)).draft.lessons.length, 2)
  const frozen = (await api('author', 'course.submit', { course: course.id, draftVersion: applied.draftVersion })).id
  const refused = await h.submit('revision.decide', cookies.author, { revision: frozen, decision: 'publish' })
  assert.equal(refused.searchParams.get('error'), 'named_reviewer_required')
  await f.publish(frozen)
  const assigned = (await api('manager', 'assignment.create', { course: course.id, learners: [ids.learner], dueDate: '2030-10-01' })).created[0]
  const learned = await api('learner', `assignments/${assigned}`)
  const rendered = await h.raw(`/app/learn/${assigned}/lessons/${learned.lessons[1].id}`, { cookie: cookies.learner }).then(response => response.text())
  assert.ok(rendered.includes('&lt;script&gt;do not execute&lt;/script&gt;') && !rendered.includes('<script>do not execute</script>'))
  const published = await api('reviewer', `revisions/${frozen}`)
  assert.match(published.lessons[0].body, /sanitize and inspect tools/)
  assert.deepEqual(published.lessons[0].sources, [source.versionId])

  // A replacement original is a separate version: extraction and published
  // attribution still refer to exactly the chosen version, never today's file.
  const replacement = await api('author', 'source.version', { source: source.id, provenance: 'Revised manual', file: file('station.txt', '# New procedure\nUse a different tool.') })
  assert.deepEqual((await api('author', `sources/${source.versionId}/extraction`)).lessons, preview.lessons)
  const text = await api('author', `sources/${replacement.id}/extraction`)
  assert.deepEqual(text.lessons, [{ title: 'New procedure', body: 'Use a different tool.' }])
  const form = await h.submit('source.convert', cookies.author, { course: course.id, draftVersion: applied.draftVersion, sourceVersion: replacement.id, lessons: JSON.stringify(text.lessons), reviewed: 'yes' }, `/app/courses/${course.id}`)
  assert.equal(form.searchParams.get('error'), null)
  assert.deepEqual((await api('reviewer', `revisions/${frozen}`)).lessons, published.lessons)
  const audit = await api('owner', `audit?q=${course.id}`)
  assert.ok(audit.events.some(event => event.action === 'source.convert' && event.detail.sourceVersion === source.versionId && event.detail.reviewed === true))

  // Unsupported formats, corrupt packages, external entities and oversized
  // documents are actionable refusals, never made-up text or partial success.
  for (const [name, data, code] of [
    ['scanned.pdf', pdf, 'source_extraction_unsupported'],
    ['page.html', '<html><script>active()</script></html>', 'source_extraction_unsupported'],
    ['broken.docx', 'not an Office file', 'document_invalid_zip'],
    ['external.docx', document('<!DOCTYPE w:p [<!ENTITY leak SYSTEM "https://untrusted.example.test/leak">]>' + paragraph('&leak;')), 'document_invalid_xml'],
    ['malformed.docx', document('<w:p><w:r></w:p>'), 'document_invalid_xml'],
    ['oversize.docx', document(paragraph('x'.repeat(2_000_000))), 'document_xml_size'],
    ['too-long.txt', 'x'.repeat(50_001), 'document_lesson_limit'],
    ['not-utf8.txt', Buffer.from([0xff, 0xfe, 0x00]), 'document_not_utf8'],
  ]) {
    const unsupported = await upload(name, data)
    assert.equal((await api('author', `sources/${unsupported.versionId}/extraction`, undefined, 422)).error, code)
  }
  assert.deepEqual((await api('reviewer', `revisions/${frozen}`)).lessons, published.lessons)
}
