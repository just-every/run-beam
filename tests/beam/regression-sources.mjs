import assert from 'node:assert/strict'
import { pdf, syntheticImage } from './fixtures.mjs'
import { file } from './harness.mjs'

import { sourceProcedureDocx, sourceMergedDocx, sourceProcedurePptx, sourceProcedureHtml, sourceProcedurePdf, sourceTaggedPdf, sourceUntaggedTablePdf, sourceDocx as document, sourceParagraph as paragraph } from './source-fixtures.mjs'
const original = sourceProcedureDocx

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
  assert.deepEqual(preview.lessons[0].blocks.find(block => block.kind === 'table').table.map(row => row.map(cell => cell.text)), [['Tool', 'Condition'], ['Probe', 'Clean']])
  assert.equal(preview.lessons[0].blocks.find(block => block.kind === 'table').table[0][0].header, true)
  assert.equal(preview.lessons[0].blocks.find(block => block.kind === 'image').text, 'Probe position')
  assert.deepEqual(Buffer.from(await (await h.raw(preview.assets[0].href, { cookie: cookies.author })).arrayBuffer()), syntheticImage)
  assert.equal((await h.raw(preview.assets[0].href, { cookie: cookies.learner })).status, 404)
  assert.ok(preview.passages.some(passage => passage.kind === 'table' && passage.location.startsWith('Document block')))
  assert.match(preview.lessons[1].body, /<script>do not execute<\/script>/)
  assert.ok(preview.warnings.length > 0)
  assert.equal(preview.reviewRequired, true)
  assert.deepEqual(await api('author', `courses/${course.id}`), before) // preview writes no draft or revision
  const bytes = await h.raw(preview.original, { cookie: cookies.author })
  assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), original)
  await api('learner', `sources/${source.versionId}/extraction`, undefined, 403)
  await api('manager', `sources/${source.versionId}/extraction`, undefined, 403)

  // Corrections and approval are explicit; no conversion may publish or replace
  // a concurrently edited draft. Both JSON and ordinary form doors work.
  const lessons = structuredClone(preview.lessons)
  lessons[0].body = lessons[0].body.replace('inspect tools', 'sanitize and inspect tools')
  lessons[0].blocks.find(block => block.kind === 'image').text = 'Probe position after sanitation'
  lessons[0].blocks.find(block => block.kind === 'table').table[1][1].text = 'Sanitized'
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
  assert.equal(published.lessons[0].blocks.find(block => block.kind === 'table').table[1][1].text, 'Sanitized')
  const imageBlock = published.lessons[0].blocks.find(block => block.kind === 'image')
  assert.equal(imageBlock.source, source.versionId)
  const preparedLesson = await h.raw(`/app/learn/${assigned}/lessons/${learned.lessons[0].id}`, { cookie: cookies.learner }).then(response => response.text())
  assert.ok(preparedLesson.includes('<table') && preparedLesson.includes('Sanitized') && preparedLesson.includes('Probe position after sanitation'))
  const allowedAsset = await h.raw(preview.assets[0].href, { cookie: cookies.learner })
  assert.equal(allowedAsset.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual(Buffer.from(await allowedAsset.arrayBuffer()), syntheticImage)
  assert.equal((await h.raw(preview.assets[0].href, { cookie: cookies.other })).status, 404)

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

  // The same public preparation door parses real presentations, HTML and PDF.
  const formats = [
    ['synthetic-beam-1.pptx', sourceProcedurePptx(), ['Prepare', 'Close']],
    ['synthetic-beam-8-merged.docx', sourceMergedDocx, ['Prepare']],
    ['synthetic-beam-9-merged.pptx', sourceProcedurePptx(true), ['Prepare', 'Close']],
    ['synthetic-beam-2.html', sourceProcedureHtml, ['Prepare', 'Close']],
    ['synthetic-beam-3.md', '# Prepare\nInspect tools.\n# Close\nStore tools.', ['Prepare', 'Close']],
    ['synthetic-beam-4.pdf', sourceProcedurePdf(), ['Page 1']],
    ['synthetic-beam-6-tagged.pdf', sourceTaggedPdf(), ['Prepare the station']],
    ['synthetic-beam-7-grid.pdf', sourceUntaggedTablePdf(), ['Page 1']],
  ]
  for (const [filename, data, titles] of formats) {
    const imported = await upload(filename, data)
    const extracted = await api('author', `sources/${imported.versionId}/extraction`)
    assert.deepEqual(extracted.lessons.map(lesson => lesson.title), titles)
    assert.ok(extracted.passages.every(passage => passage.location))
    assert.ok(!JSON.stringify(extracted.lessons).includes('neverRead'))
    if (/html|pptx/.test(filename)) {
      assert.ok(extracted.lessons[0].blocks.some(block => block.kind === 'table'))
      assert.deepEqual(Buffer.from(await (await h.raw(extracted.assets[0].href, { cookie: cookies.author })).arrayBuffer()), syntheticImage)
    }
    if (filename.includes('merged')) {
      const table = extracted.lessons[0].blocks.find(block => block.kind === 'table').table
      assert.deepEqual(table.map(row => row.map(cell => cell.text)), [['Equipment', 'Condition', 'Action'], ['Probe', 'Clean', 'Inspect'], ['Ready', 'Store']])
      assert.deepEqual(table.map(row => row.map(({ colSpan, rowSpan }) => [colSpan, rowSpan])), [[[2, 1], [1, 1], [1, 1]], [[2, 2], [1, 1], [1, 1]], [[1, 1], [1, 1]]])
      assert.ok(table[0].every(cell => cell.header))
      assert.ok(extracted.passages.some(passage => passage.kind === 'table' && passage.text.includes('Probe')))
      table[1][1].text = 'Sanitized'
    }
    if (filename.endsWith('html')) assert.equal(extracted.lessons[0].blocks.find(block => block.kind === 'table').table[0][0].rowSpan, 2)
    if (filename.includes('tagged')) assert.deepEqual(extracted.lessons[0].blocks.find(block => block.kind === 'table').table.map(row => row.map(cell => cell.text)), [['Tool', 'Condition'], ['Probe', 'Clean']])
    if (filename.includes('grid.pdf')) assert.deepEqual(extracted.lessons[0].blocks.find(block=>block.kind==='table').table.map(row=>row.map(cell=>cell.text)),[['Tool','Condition'],['Probe','Clean'],['Gloves','Intact']])
    if (filename.endsWith('pdf')) assert.match(extracted.lessons[0].body, /Inspect the clean probe/)
    if (filename.includes('grid.pdf')) for (const cell of extracted.lessons[0].blocks.find(block=>block.kind==='table').table[0]) cell.header = true
    const fresh = await api('author', 'course.create', { title: filename, reviewer: ids.reviewer })
    const fields = { course: fresh.id, draftVersion: fresh.draftVersion, sourceVersion: imported.versionId, reviewed: true, lessons: extracted.lessons, resolvedUncertainties: extracted.uncertainties.map(item => item.id) }
    const converted = await api('author', 'source.convert', fields)
    assert.equal(converted.draft.lessons.length, extracted.lessons.length)
    if (filename.includes('grid.pdf')) assert.ok(converted.draft.lessons[0].blocks.find(block=>block.kind==='table').table[0].every(cell=>cell.header))
    assert.equal((await api('author', `courses/${fresh.id}`)).publishedRevision, null)
    const screen = await h.raw(`/app/sources/${imported.versionId}/prepare?course=${fresh.id}`, { cookie: cookies.author }).then(response => response.text())
    assert.ok(screen.includes('name="reviewed"') && screen.includes(extracted.original))
    if (extracted.assets.length) await api('author', 'source.convert', { ...fields, draftVersion: converted.draftVersion, lessons: [{ title: 'Forged asset', body: '', blocks: [{ kind: 'image', text: 'Foreign', asset: 'asset-999' }] }] }, 404)
    if (filename.includes('merged')) {
      const table = converted.draft.lessons[0].blocks.find(block => block.kind === 'table').table
      assert.deepEqual(table, extracted.lessons[0].blocks.find(block => block.kind === 'table').table)
      assert.ok(screen.includes('colspan="2" rowspan="2"'))
      const revision = (await api('author', 'course.submit', { course: fresh.id, draftVersion: converted.draftVersion })).id
      const snapshot = await api('reviewer', `revisions/${revision}`)
      assert.deepEqual(snapshot.lessons[0].blocks.find(block => block.kind === 'table').table, table)
      await f.publish(revision)
      const assignment = (await api('manager', 'assignment.create', { course: fresh.id, learners: [ids.learner], dueDate: '2030-10-01' })).created[0]
      const learning = await api('learner', `assignments/${assignment}`)
      const rendered = await h.raw(`/app/learn/${assignment}/lessons/${learning.lessons[0].id}`, { cookie: cookies.learner }).then(response => response.text())
      assert.ok(rendered.includes('colspan="2" rowspan="2">Probe</td>') && rendered.includes('Sanitized'))
      assert.deepEqual(snapshot.lessons[0].sources, [imported.versionId])
    }
  }
  const legacy = await upload('synthetic-beam-10.docx', document(paragraph('Legacy merge needs reconstruction.') + '<w:tbl><w:tr><w:tc><w:tcPr><w:hMerge w:val="restart"/></w:tcPr>' + paragraph('Retained original table text') + '</w:tc></w:tr></w:tbl>'))
  const unsupportedTable = await api('author', `sources/${legacy.versionId}/extraction`)
  assert.ok(unsupportedTable.warnings.some(warning => warning.includes('unsupported table layout')))
  assert.ok(unsupportedTable.uncertainties.some(item => item.text.includes('Retained original table text') && item.location.startsWith('Document block')))
  assert.match(unsupportedTable.lessons[0].body, /Retained original table text/)
  assert.equal((await api('author', 'source.convert', { course: course.id, draftVersion: (await api('author', `courses/${course.id}`)).draftVersion, sourceVersion: legacy.versionId, reviewed: true, lessons: unsupportedTable.lessons }, 409)).error, 'source_uncertainty_review_required')
  const scanned = await upload('synthetic-beam-5.pdf', sourceProcedurePdf(true))
  const scan = await api('author', `sources/${scanned.versionId}/extraction`)
  assert.ok(scan.uncertainties.some(item => item.requiresOcr && item.location === 'Page 1'))
  assert.equal(scan.assets.length, 1)
  assert.match((await h.raw(scan.assets[0].href, { cookie: cookies.author })).headers.get('content-type'), /^image\/png/)
  assert.equal((await api('author', 'source.convert', { course: course.id, draftVersion: (await api('author', `courses/${course.id}`)).draftVersion, sourceVersion: scanned.versionId, reviewed: true, lessons: [{ title: 'Invented OCR', body: 'A typed answer does not become OCR evidence.' }], resolvedUncertainties: scan.uncertainties.map(item => item.id) }, 409)).error, 'source_ocr_required')
  const held = await h.raw(`/app/sources/${scanned.versionId}/prepare?course=${course.id}`, { cookie: cookies.author }).then(response => response.text())
  assert.ok(!held.includes('action="/app/do/source.convert"'))

  // Unsupported formats, corrupt packages, external entities and oversized
  // documents are actionable refusals, never made-up text or partial success.
  for (const [name, data, code] of [
    ['broken.pdf', 'not a PDF document', 'document_invalid_pdf'],
    ['page.html', '<html><script>active()</script></html>', 'document_no_lessons'],
    ['unsupported.bin', 'Unknown data', 'source_extraction_unsupported'],
    ['broken.docx', 'not an Office file', 'document_invalid_zip'],
    ['external.docx', document('<!DOCTYPE w:p [<!ENTITY leak SYSTEM "https://untrusted.example.test/leak">]>' + paragraph('&leak;')), 'document_invalid_xml'],
    ['malformed.docx', document('<w:p><w:r></w:p>'), 'document_invalid_xml'],
    ['synthetic-beam-11.docx', document(paragraph('Do not merge an ordinary preceding cell.') + '<w:tbl><w:tr><w:tc>' + paragraph('Not a merge origin') + '</w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr>' + paragraph('') + '</w:tc></w:tr></w:tbl>'), 'document_invalid_table_merge'],
    ['oversize.docx', document(paragraph('x'.repeat(2_000_000))), 'document_xml_size'],
    ['too-long.txt', 'x'.repeat(50_001), 'document_lesson_limit'],
    ['not-utf8.txt', Buffer.from([0xff, 0xfe, 0x00]), 'document_not_utf8'],
  ]) {
    const unsupported = await upload(name, data)
    assert.equal((await api('author', `sources/${unsupported.versionId}/extraction`, undefined, 422)).error, code)
  }
  assert.deepEqual((await api('reviewer', `revisions/${frozen}`)).lessons, published.lessons)
}

// AUTHOR-001: real D1/R2 and both human HTTP doors, with no application mocks.
export async function multimediaCheck(f) {
  const { syntheticVideo, syntheticAudio, syntheticImage } = await import('./fixtures.mjs')
  const { api, h, cookies, ids } = f
  const hosts = ['www.youtube.com', 'player.vimeo.com', 'www.loom.com', 'docs.google.com', 'onedrive.live.com', 'forms.office.com', 'word-edit.officeapps.live.com']
  await api('author', 'embed.policy', { version: 0, hosts: hosts.join('\n') }, 403)
  await api('owner', 'embed.policy', { version: 0, hosts: 'https://www.youtube.com' }, 400)
  const policyForm = await h.submit('embed.policy', cookies.owner, { version: 0, hosts: hosts.join('\n') })
  assert.equal(policyForm.searchParams.get('error'), null)
  await api('owner', 'embed.policy', { version: 0, hosts: '' }, 409)
  await api('owner', 'embed.policy', { version: 1, hosts: hosts.join('\n') })
  const assets = {}
  for (const [kind, filename, bytes] of [
    ['image', 'synthetic-beam-1.png', syntheticImage],
    ['audio', 'synthetic-beam-2.mp3', syntheticAudio],
    ['video', 'synthetic-beam-3.mp4', syntheticVideo],
    ['document', 'synthetic-beam-4.pdf', pdf],
  ]) assets[kind] = (await api('author', 'source.create', { title: `Synthetic ${kind}`, licence: 'owned', licenceEvidence: 'Generated for this integration journey', reviewer: ids.reviewer, provenance: 'Synthetic Beam media fixture', file: file(filename, bytes) })).versionId
  const captionOriginal = await api('author','source.create',{title:'Inspection captions',licence:'owned',licenceEvidence:'Employer-authored captions',reviewer:ids.reviewer,provenance:'Original captions',file:file('inspection-en.vtt','WEBVTT\n\n00:00.000 --> 00:00.900\nInspect the clean pool.\n')})
  assets.caption = (await api('author','source.version',{source:captionOriginal.id,provenance:'Corrected probe terminology against the video',file:file('inspection-en.vtt','WEBVTT\n\n00:00.000 --> 00:00.900\nInspect the clean probe.\n')})).id
  const badCaption = await api('author','source.create',{title:'Invalid caption refusal',licence:'owned',licenceEvidence:'Original malformed refusal fixture',reviewer:ids.reviewer,provenance:'Malformed timing',file:file('invalid.vtt','WEBVTT\n\n00:01.000 --> 00:00.500\nRefuse reversed cue timing.\n')})
  const captionBytes = await h.raw(`/app/files/caption/${assets.caption}`,{cookie:cookies.author})
  assert.match(captionBytes.headers.get('content-type'),/^text\/vtt/)
  assert.match(await captionBytes.text(),/Inspect the clean probe/)
  assert.equal((await h.raw(`/app/files/caption/${assets.caption}`,{cookie:cookies.other})).status,404)
  assert.match(await (await h.raw(`/api/beam/source-files/${captionOriginal.versionId}`,{cookie:cookies.author})).text(),/clean pool/,'correcting captions never rewrites the original version')
  const c = await api('author', 'course.create', { title: 'Mixed media training', reviewer: ids.reviewer })
  let current = await api('author', 'course.lesson', { course: c.id, draftVersion: 1, title: 'Inspect the station', body: 'Inspect the station before starting.', sources: [] })
  const lesson = current.draft.lessons[0].id
  const add = async content => { current = await api('author', 'course.block', { course: c.id, draftVersion: current.draftVersion, lesson, content }); return current.draft.lessons[0].blocks.at(-1) }
  await add({ kind: 'text', text: '# Inspect\n\nUse **clean tools** and _check_ the `record`.\n\n- Inspect\n- Record' })
  for (const kind of ['image', 'audio', 'video', 'document']) await add({ kind, text: `Station ${kind}`, source: assets[kind], ...(kind === 'video' ? {captions:{source:assets.caption,language:'en',label:'English'}} : {}) })
  await add({ kind: 'link', text: 'Read the procedure', url: 'https://example.test/procedure' })
  await add({ kind: 'check', text: 'Which tool is safe?', choices: ['Clean tool', 'Dirty tool'], answer: 0, feedback: 'Clean tools protect the work.' })
  const embeds = [
    ['YouTube training', 'https://www.youtube.com/watch?v=synthetic-beam-1', 'https://www.youtube.com/embed/synthetic-beam-1'],
    ['Loom training', 'https://www.loom.com/share/synthetic-beam-2', 'https://www.loom.com/embed/synthetic-beam-2'],
    ['Slides training', 'https://docs.google.com/presentation/d/synthetic-beam-3/edit', 'https://docs.google.com/presentation/d/synthetic-beam-3/embed'],
    ['Vimeo training', 'https://vimeo.com/1234', 'https://player.vimeo.com/video/1234'],
    ['Docs training', 'https://docs.google.com/document/d/synthetic-beam-4/edit', 'https://docs.google.com/document/d/synthetic-beam-4/preview'],
    ['PowerPoint training', 'https://onedrive.live.com/embed?resid=synthetic-beam-5', 'https://onedrive.live.com/embed?resid=synthetic-beam-5'],
    ['Word training', 'https://word-edit.officeapps.live.com/we/wordviewerframe.aspx?id=synthetic-beam-6', 'https://word-edit.officeapps.live.com/we/wordviewerframe.aspx?id=synthetic-beam-6'],
    ['Forms training', 'https://forms.office.com/Pages/ResponsePage.aspx?id=synthetic-beam-7', 'https://forms.office.com/Pages/ResponsePage.aspx?id=synthetic-beam-7'],
  ]
  for (const [text, url, expected] of embeds) assert.equal((await add({ kind: 'embed', text, url })).url, expected)
  const unchanged = await api('author', `courses/${c.id}`)
  for (const [content, error] of [
    [{ kind: 'text', text: '<img src=x onerror=active()>' }, 'active_lesson_html'],
    [{ kind: 'embed', text: 'Unlisted', url: 'https://unlisted.example.test/embed' }, 'embed_host_not_allowed'],
    [{ kind: 'embed', text: 'Deceptive host', url: 'https://www.youtube.com.unlisted.example.test/embed' }, 'embed_host_not_allowed'],
    [{ kind: 'link', text: 'Unsafe link', url: 'javascript:active()' }, 'invalid_media_url'],
    [{ kind: 'embed', text: 'Credentials', url: 'https://synthetic-beam-1:synthetic-beam-2@www.youtube.com/embed/test' }, 'invalid_media_url'],
    [{ kind: 'image', text: 'Active upload', source: assets.document }, 'media_type_mismatch'],
    [{ kind:'video',text:'Invalid captions',source:assets.video,captions:{source:badCaption.versionId,language:'en',label:'English'} },'invalid_caption_order'],
  ]) assert.equal((await api('author', 'course.block', { course: c.id, draftVersion: current.draftVersion, lesson, content }, 400)).error, error)
  assert.deepEqual(await api('author', `courses/${c.id}`), unchanged)
  const proposed = structuredClone(unchanged.draft)
  proposed.lessons[0].blocks.push({ kind: 'embed', text: 'Unlisted proposal', url: 'https://unlisted.example.test/embed' })
  assert.equal((await api('author', 'proposal.create', { course: c.id, draftVersion: current.draftVersion, summary: 'Refuse unsafe preparation', inputs: [], draft: proposed }, 400)).error, 'embed_host_not_allowed')
  const active = await api('author', 'source.create', { title: 'Active HTML', licence: 'owned', licenceEvidence: 'Synthetic refusal fixture', reviewer: ids.reviewer, provenance: 'Synthetic Beam fixture', file: file('synthetic-beam-5.html', '<html><script>active()</script></html>') })
  assert.equal((await api('author', 'course.block', { course: c.id, draftVersion: current.draftVersion, lesson, content: { kind: 'document', text: 'Active source', source: active.versionId } }, 400)).error, 'media_type_mismatch')
  const inert = await h.raw(`/app/files/source/${active.versionId}`, { cookie: cookies.author })
  assert.equal(inert.headers.get('content-type'), 'text/plain; charset=utf-8')
  assert.match(inert.headers.get('content-security-policy'), /sandbox; default-src 'none'/)
  await api('learner', 'course.block', { course: c.id, draftVersion: current.draftVersion, lesson, content: { kind: 'text', text: 'Forbidden' } }, 403)
  const original = structuredClone(current.draft.lessons[0].blocks[1])
  current = await api('author', 'course.block.change', { course: c.id, draftVersion: current.draftVersion, lesson, block: original.id, operation: 'duplicate' })
  const duplicated = current.draft.lessons[0].blocks[2]
  assert.notEqual(duplicated.id, original.id)
  assert.equal(duplicated.source, original.source)
  assert.deepEqual(duplicated.copiedFrom, { course: c.id, lesson, block: original.id, courseTitle: 'Mixed media training', lessonTitle: 'Inspect the station' })
  current = await api('author', 'course.block.change', { course: c.id, draftVersion: current.draftVersion, lesson, block: duplicated.id, operation: 'up' })
  assert.equal(current.draft.lessons[0].blocks[1].id, duplicated.id)
  await api('author', 'course.block.change', { course: c.id, draftVersion: current.draftVersion - 1, lesson, block: duplicated.id, operation: 'remove' }, 409)
  current = await api('author', 'course.lesson', { course: c.id, draftVersion: current.draftVersion, title: 'Wrap up', body: 'Leave the station ready.', sources: [] })
  const beforePreview = await api('author', `courses/${c.id}`)
  const preview = await h.raw(`/app/courses/${c.id}?preview=learner`, { cookie: cookies.author })
  const previewHtml = await preview.text()
  assert.match(previewHtml, /Learner preview/)
  assert.match(previewHtml, /<strong>clean tools<\/strong>/)
  assert.match(previewHtml, /<em>check<\/em>/)
  assert.match(previewHtml, /sandbox="allow-scripts allow-same-origin allow-presentation allow-forms"/)
  assert.match(previewHtml, /sandbox=""/)
  assert.match(preview.headers.get('content-security-policy'), /frame-src 'self' https:\/\/www.youtube.com/)
  assert.deepEqual(await api('author', `courses/${c.id}`), beforePreview)
  assert.equal((await api('author', `courses/${c.id}`)).draftVersion, current.draftVersion)
  const revision = (await api('author', 'course.submit', { course: c.id, draftVersion: current.draftVersion })).id
  await f.publish(revision)
  const assignment = await f.assign(c)
  const learned = await f.view(assignment)
  const learnerPath = `/app/learn/${assignment}/lessons/${learned.lessons[0].id}`
  const rendered = await h.raw(learnerPath, { cookie: cookies.learner }).then(response => response.text())
  for (const [, , expected] of embeds) assert.ok(rendered.includes(expected.replaceAll('&', '&amp;')))
  for (const kind of ['image', 'audio', 'video', 'document']) {
    assert.ok(rendered.includes(`/app/files/source/${assets[kind]}`))
    const asset = await h.raw(`/app/files/source/${assets[kind]}`, { cookie: cookies.learner })
    assert.equal(asset.status, 200)
    assert.match(asset.headers.get('content-security-policy'), /sandbox; default-src 'none'/)
    assert.equal(asset.headers.get('x-content-type-options'), 'nosniff')
    assert.equal((await h.raw(`/app/files/source/${assets[kind]}`, { cookie: cookies.other })).status, 404)
    assert.equal((await h.raw(`/app/files/source/${assets[kind]}`)).status, 303)
  }
  await api('owner', 'course.authors', { course: c.id, members: [ids.other] })
  assert.equal((await h.raw(`/app/files/source/${assets.image}`, { cookie: cookies.other })).status, 200)
  assert.equal((await h.raw(`/app/files/source/${active.versionId}`, { cookie: cookies.other })).status, 404)
  const scopedEditor = await h.raw(`/app/courses/${c.id}`, { cookie: cookies.other }).then(response => response.text())
  assert.ok(scopedEditor.includes('Synthetic image v1'))
  await api('other', 'sources', undefined, 403)
  await api('owner', 'course.authors', { course: c.id, members: [] })
  assert.equal((await h.raw(`/app/files/source/${assets.image}`, { cookie: cookies.other })).status, 404)
  const documentDownload = await h.raw(`/app/files/source/${assets.document}?download=1`, { cookie: cookies.learner })
  assert.equal(documentDownload.status, 200)
  assert.match(documentDownload.headers.get('content-disposition'), /^attachment;/)
  assert.equal(documentDownload.headers.get('content-type'), 'application/octet-stream')
  // Reuse into another course retains exact immutable source attribution.
  const other = await api('author', 'course.create', { title: 'Reused course', reviewer: ids.reviewer })
  let target = await api('author', 'course.lesson', { course: other.id, draftVersion: 1, title: 'Reused procedure', body: 'A different lesson.', sources: [] })
  const reused = await h.submit('course.block.reuse', cookies.author, { course: other.id, draftVersion: target.draftVersion, lesson: target.draft.lessons[0].id, from: `${c.id}:${lesson}:${original.id}` }, `/app/courses/${other.id}`)
  assert.equal(reused.searchParams.get('error'), null)
  target = await api('author', `courses/${other.id}`)
  assert.equal(target.draft.lessons[0].blocks[0].source, original.source)
  assert.ok(target.draft.lessons[0].sources.includes(original.source))
  assert.deepEqual(target.draft.lessons[0].blocks[0].copiedFrom, { course: c.id, lesson, block: original.id, courseTitle: 'Mixed media training', lessonTitle: 'Inspect the station' })
  // Later draft edits never change published blocks; comparison and restore retain them.
  await api('learner', 'lesson.complete', { assignment, lesson: learned.lessons[0].id })
  assert.equal((await f.view(assignment)).lessons[0].completed, true)
  const frozen = await api('reviewer', `revisions/${revision}`)
  const first = current.draft.lessons[0].blocks[0]
  current = await api('author', 'course.block', { course: c.id, draftVersion: current.draftVersion, lesson, block: first.id, content: { kind: 'text', text: 'Use **inspected tools**.' } })
  assert.deepEqual(await api('reviewer', `revisions/${revision}`), frozen)
  const nextRevision = (await api('author', 'course.submit', { course: c.id, draftVersion: current.draftVersion })).id
  const move = await api('reviewer', `revisions/${nextRevision}/moves`)
  assert.ok(move.moves.find(item => item.assignment === assignment).reopened.includes('Inspect the station'))
  assert.equal(move.moves.find(item => item.assignment === assignment).kept.includes('Inspect the station'), false)
  const compared = await api('author', `compare?from=${revision}&to=${nextRevision}`)
  assert.equal(compared.lessons[0].change, 'changed')
  assert.ok(compared.lessons[0].blocks.lines.some(line => line.op === 'add' && line.text.includes('inspected tools')))
  current = await api('author', 'course.restore', { course: c.id, draftVersion: current.draftVersion, revision })
  assert.deepEqual(current.draft.lessons[0].blocks, frozen.lessons[0].blocks)
  // Owner revocation applies at render time even to the immutable old revision.
  await api('owner', 'embed.policy', { version: 2, hosts: 'docs.google.com' })
  const revoked = await h.raw(learnerPath, { cookie: cookies.learner }).then(response => response.text())
  assert.ok(!revoked.includes('src="https://www.youtube.com'))
  assert.ok(revoked.includes('current allowlist'))
  assert.equal((await h.raw('/app/business', { cookie: cookies.owner })).headers.get('content-security-policy').includes('frame-src'), false)
  await api('author', 'course.block', { course: c.id, draftVersion: current.draftVersion, lesson: current.draft.lessons[0].id, content: { kind: 'embed', text: 'Revoked', url: embeds[0][1] } }, 400)
  await api('owner', 'embed.policy', { version: 3, hosts: hosts.join('\n') })
  return { course: c.id, lesson: current.draft.lessons[0].id, draftVersion: current.draftVersion, revision, nextRevision, assignment, learnerPath, assets, original, hosts }
}

export async function multimediaBrowserCheck(f, media) {
  const { mkdir } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { chromium } = await import(process.env.BEAM_PLAYWRIGHT_MODULE || '@playwright/test')
  const evidence = process.env.BEAM_EVIDENCE_DIR || 'test-results'
  await mkdir(evidence, { recursive: true })
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true })
      const page = await context.newPage()
      async function as(role) {
        await context.clearCookies()
        await context.addCookies(f.cookies[role].split('; ').map(cookie => { const split = cookie.indexOf('='); return { name: cookie.slice(0, split), value: cookie.slice(split + 1), url: f.h.origin } }))
      }
      async function shot(name) {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: horizontal overflow at ${width}`)
        await page.screenshot({ path: join(evidence, `${width}-media-${name}.png`), fullPage: true })
      }
      await as('author')
      await page.goto(`${f.h.origin}/app/courses`)
      const create = page.locator('form[action="/app/do/course.create"]')
      await create.getByLabel('Title', { exact: true }).fill(`Media editor ${width}`)
      await create.getByLabel('Reviewer who publishes it', { exact: true }).selectOption(f.ids.reviewer)
      await create.getByRole('button', { name: 'Create course' }).click()
      await page.waitForURL(/\/app\/courses\/[\w-]+/)
      const course = new URL(page.url()).pathname.split('/').at(-1)
      const lessonForm = page.locator('form[action="/app/do/course.lesson"]').last()
      await lessonForm.getByLabel('Lesson title').fill('Prepare safely')
      await lessonForm.getByLabel('Lesson text').fill('Inspect before starting.')
      await lessonForm.getByRole('button', { name: 'Add lesson' }).click()
      await page.locator('summary').filter({ hasText: /^1\. Prepare safely$/ }).click()
      const add = page.locator('details').filter({ has: page.locator(':scope > summary', { hasText: /^Add a media block$/ }) })
      await add.locator(':scope > summary').click()
      const rich = add.locator('details').filter({ has: page.locator(':scope > summary', { hasText: /^Rich text$/ }) })
      await rich.locator(':scope > summary').click()
      await rich.getByLabel(/Rich text \(/).fill('Use **clean tools**.')
      await rich.getByRole('button', { name: 'Add block', exact: true }).click()
      // Reopen only the lesson; native forms work without a client-side state layer.
      await page.locator('summary').filter({ hasText: /^1\. Prepare safely$/ }).click()
      await page.locator('summary').filter({ hasText: /^Reuse a block$/ }).click()
      const reuse = page.locator('form[action="/app/do/course.block.reuse"]')
      await reuse.getByLabel('Block from your courses').selectOption(`${media.course}:${media.original.copiedFrom?.lesson || (await f.api('author', `courses/${media.course}`)).draft.lessons[0].id}:${media.original.id}`)
      await reuse.getByRole('button', { name: 'Reuse block', exact: true }).click()
      await page.locator('summary').filter({ hasText: /^1\. Prepare safely$/ }).click()
      await page.locator('summary').filter({ hasText: /^2\. Image/ }).click()
      await page.getByRole('button', { name: 'Duplicate block', exact: true }).click()
      await page.locator('summary').filter({ hasText: /^1\. Prepare safely$/ }).click()
      await page.locator('summary').filter({ hasText: /^3\. Image/ }).click()
      await page.getByRole('button', { name: 'Move block up', exact: true }).click()
      await page.locator('summary').filter({ hasText: /^1\. Prepare safely$/ }).click()
      await shot('editor')
      await page.getByRole('link', { name: 'Preview as learner', exact: true }).click()
      assert.equal(await page.locator('strong').filter({ hasText: 'clean tools' }).count(), 1)
      assert.equal(await page.locator('.lesson-image').count(), 2)
      await shot('preview')
      // The full mixed lesson uses the identical renderer in learner and review doors.
      await as('learner')
      await page.goto(f.h.origin + media.learnerPath)
      await page.waitForFunction(() => document.querySelector('video').readyState >= 1, { timeout: 15000 })
      await page.locator('video').evaluate(async video => { video.muted = true; await video.play() })
      await page.waitForFunction(() => document.querySelector('video').currentTime > 0)
      await page.locator('video').evaluate(video => video.pause())
      await page.locator('video track').evaluate(track=>{track.track.mode='showing'})
      await page.locator('video').evaluate(video=>{video.currentTime=0.25})
      await page.waitForFunction(()=>document.querySelector('video').textTracks[0]?.activeCues?.[0]?.text==='Inspect the clean probe.')
      await page.locator('audio').evaluate(async audio => { audio.muted = true; await audio.play() })
      await page.waitForFunction(() => document.querySelector('audio').currentTime > 0)
      await page.locator('audio').evaluate(audio => audio.pause())
      await page.getByLabel('Clean tool', { exact: true }).check()
      await page.getByText('Check your answer', { exact: true }).click()
      assert.equal(await page.locator('input[type=radio]:checked').count(), 1)
      assert.equal(await page.locator('iframe.lesson-embed').count(), 8)
      assert.equal(await page.locator('iframe.lesson-document').getAttribute('sandbox'), '')
      assert.ok((await page.getByRole('link', { name: 'Download Station document (PDF)', exact: true }).getAttribute('href')).endsWith('?download=1'))
      await shot('learner')
      await as('reviewer')
      await page.goto(`${f.h.origin}/app/revisions/${media.revision}`)
      assert.equal(await page.locator('iframe.lesson-embed').count(), 8)
      await shot('review')
      await as('owner')
      await page.goto(`${f.h.origin}/app/courses/${media.course}`)
      assert.equal(await page.getByLabel('Allowed embed hosts, one per line').inputValue(), media.hosts.join('\n'))
      await shot('owner-allowlist')
      await as('author')
      await page.goto(`${f.h.origin}/app/courses/${media.course}/compare?from=${media.revision}&to=${media.nextRevision}`)
      // Correcting caption metadata is a normal authored draft save, separate from publication.
      await as('author')
      await page.goto(`${f.h.origin}/app/courses/${media.course}`)
      await page.locator('summary').filter({hasText:/^1\. Inspect the station$/}).click()
      await page.locator('summary').filter({hasText:/^\d+\. Video · Station video$/}).click()
      const captionForm=page.locator('form[action="/app/do/course.block"]').filter({has:page.locator('input[name="block"][value="'+(await f.api('author',`courses/${media.course}`)).draft.lessons[0].blocks.find(row=>row.kind==='video').id+'"]')})
      await captionForm.getByLabel('Caption source version (WebVTT)',{exact:true}).selectOption(media.assets.caption)
      await captionForm.getByLabel('Caption language (BCP47, for example en-AU)',{exact:true}).fill('en')
      await captionForm.getByLabel('Caption label',{exact:true}).fill('English — reviewed')
      await shot('caption-editor')
      await captionForm.getByRole('button',{name:'Save block',exact:true}).click()
      assert.equal((await f.api('author',`courses/${media.course}`)).draft.lessons[0].blocks.find(row=>row.kind==='video').captions.label,'English — reviewed')
      await page.goto(`${f.h.origin}/app/courses/${media.course}/compare?from=${media.revision}&to=${media.nextRevision}`)
      await page.getByRole('heading', { name: 'Media blocks', exact: true }).waitFor()
      await shot('comparison')
      await context.close()
      console.log(`PASS media browser editor/reuse/duplicate/reorder/preview/native playback/learner/review/allowlist/comparison ${width}`)
    }
  } finally { await browser.close() }
}
