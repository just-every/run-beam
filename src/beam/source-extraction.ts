import { sourceOcrResult } from './source-ocr'
// AUTHOR-002: read-only extraction and an explicit author-reviewed conversion.
// No extraction writes records, publishes, or changes the immutable original.
import type { Bindings } from '../auth.server'
import { requireRole, type Actor } from './actor'
import { insist, newId, one, sha256Hex } from './core'
import { editDraft } from './courses'
import { extractDocument, type ExtractedLesson, type SourceBlock } from './source-document'
import type { Block } from './media'
import type { Input } from './input'

async function originalDocument(env: Bindings, id: string) {
  const version = await one(env, 'SELECT v.*, s.title FROM beam_source_versions v JOIN beam_sources s ON s.id = v.source_id WHERE v.id = ? AND s.erased_at IS NULL', id)
  insist(version, 'source_version_not_found', 404)
  const object = await env.FILES.get(`sha256/${version.sha256}`)
  insist(object, 'file_missing', 503)
  const bytes = new Uint8Array(await object.arrayBuffer())
  insist(bytes.length === version.size && await sha256Hex(bytes) === version.sha256, 'file_integrity', 503)
  return { version, bytes }
}
async function preparedDocument(env: Bindings, id: string) {
  const { version, bytes } = await originalDocument(env, id)
  return { version, document: await extractDocument(bytes, version.filename, version.title) }
}
export async function sourceExtraction(env: Bindings, actor: Actor, id: string) {
  requireRole(actor, 'author')
  const { version, document } = await preparedDocument(env, id)
  const ocr = document.uncertainties.some(item => item.requiresOcr) ? await sourceOcrResult(env, id) : null
  if (ocr) {
    document.lessons = []; document.passages = []; document.uncertainties = []
    for (const page of ocr.pages) {
      const index = document.lessons.length
      document.lessons.push({ title: `Page ${page.page}`, body: page.passages.map(item => item.text).join('\n\n') })
      for (const [passage, item] of page.passages.entries()) {
        const location = `OCR page ${page.page}, passage ${passage + 1}`
        document.passages.push({ lesson: index, location, kind: 'text', text: item.text })
        document.uncertainties.push({ id: `ocr-${page.page}-${passage + 1}`, location, text: item.text, reason: ['Compare and correct this OCR passage against the original.', ...item.uncertainties].join(' '), requiresOcr: false })
      }
      for (const [issue, reason] of page.uncertainties.entries()) document.uncertainties.push({ id: `ocr-${page.page}-issue-${issue}`, location: `OCR page ${page.page}`, text: '', reason, requiresOcr: false })
    }
    document.warnings.push('Actual OCR output requires comparison and acknowledgment of every passage; uncertain readings are never silently accepted.')
  }
  return {
    sourceVersion: id, source: version.source_id, title: version.title, number: version.number,
    filename: version.filename, provenance: version.provenance, sha256: version.sha256,
    original: `/api/beam/source-files/${id}`,
    ...document,
    assets: document.assets.map(({ id: asset, filename, mediaType }) => ({ id: asset, filename, mediaType, href: `/app/files/source-asset/${id}/${asset}` })),
  }
}

/** Called only after a draft writer's course authority has been checked. */
export async function sourceAssetIds(env: Bindings, versionId: string): Promise<string[]> {
  return (await preparedDocument(env, versionId)).document.assets.map(asset => asset.id)
}
export async function validateSourceAsset(env: Bindings, versionId: string, assetId: string): Promise<void> {
  insist(/^asset-[1-9]\d*$/.test(assetId) && (await sourceAssetIds(env, versionId)).includes(assetId), 'source_asset_not_found', 404)
}
/** Existing sourceFile enforces staff/course citation/learner access-window custody. */
export async function sourceAsset(env: Bindings, actor: Actor, versionId: string, assetId: string) {
  const { sourceFile } = await import('./sources')
  await sourceFile(env, actor, versionId, true)
  insist(/^asset-[1-9]\d*$/.test(assetId), 'source_asset_not_found', 404)
  const asset = (await preparedDocument(env, versionId)).document.assets.find(item => item.id === assetId)
  insist(asset, 'source_asset_not_found', 404)
  return new Response(new Uint8Array(asset.bytes), { headers: {
    'content-type': asset.mediaType,
    'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
    'content-security-policy': "sandbox; default-src 'none'", 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store',
  } })
}

function reviewedLessons(input: Input, original: ExtractedLesson[]) {
  if (!input.has('lessonTitles')) return input.json('lessons') as ExtractedLesson[]
  const titles = input.list('lessonTitles', { keepEmpty: true }), bodies = input.list('lessonBodies', { keepEmpty: true })
  const descriptions = input.list('imageDescriptions', { keepEmpty: true }), cells = input.list('tableCells', { keepEmpty: true })
  insist(titles.length === original.length && bodies.length === original.length, 'invalid_extracted_lessons')
  const lessons = structuredClone(original), headers = new Set(input.list('tableHeaders'))
  let image = 0, cell = 0
  for (const [index, lesson] of lessons.entries()) {
    lesson.title = titles[index]; lesson.body = bodies[index]
    for (const [blockIndex, block] of (lesson.blocks ?? []).entries()) {
      if (block.kind === 'image') block.text = descriptions[image++]
      else for (const [rowIndex, row] of (block.table ?? []).entries()) for (const entry of row) {
        entry.text = cells[cell++]
        if (rowIndex === 0) entry.header = headers.has(`${index}:${blockIndex}`)
      }
    }
  }
  insist(image === descriptions.length && cell === cells.length, 'invalid_extracted_blocks')
  return lessons
}
async function nativeBlocks(blocks: SourceBlock[] | undefined, source: string, assetIds: Set<string>): Promise<Block[]> {
  if (blocks === undefined) return []
  insist(Array.isArray(blocks) && blocks.length <= 60, 'invalid_extracted_blocks')
  return blocks.map(block => {
    insist(block && ['image', 'table'].includes(block.kind) && typeof block.text === 'string' && block.text.trim(), 'invalid_extracted_block')
    if (block.kind === 'image') {
      insist(typeof block.asset === 'string' && assetIds.has(block.asset), 'source_asset_not_found', 404)
      insist(block.text !== 'Image description missing; inspect the original', 'source_image_description_required', 409)
      return { id: newId(), kind: 'image', text: block.text, source, asset: block.asset }
    }
    return { id: newId(), kind: 'table', text: block.text, table: block.table }
  })
}

export async function convertSource(env: Bindings, actor: Actor, input: Input) {
  const extracted = await sourceExtraction(env, actor, input.text('sourceVersion'))
  insist(input.flag('reviewed'), 'source_review_required', 409)
  insist(!extracted.uncertainties.some(item => item.requiresOcr), 'source_ocr_required', 409)
  const resolved = input.list('resolvedUncertainties')
  insist(extracted.uncertainties.every(item => resolved.includes(item.id)), 'source_uncertainty_review_required', 409)
  const lessons = reviewedLessons(input, extracted.lessons)
  insist(Array.isArray(lessons) && lessons.length > 0 && lessons.length <= 60, 'invalid_extracted_lessons')
  const assetIds = new Set(extracted.assets.map(asset => asset.id))
  const prepared = await Promise.all(lessons.map(async lesson => {
    insist(lesson && typeof lesson.title === 'string' && typeof lesson.body === 'string', 'invalid_lesson')
    return { id: newId(), title: lesson.title, body: lesson.body, sources: [extracted.sourceVersion], blocks: await nativeBlocks(lesson.blocks, extracted.sourceVersion, assetIds) }
  }))
  // Corrections are normal authored content. editDraft validates every value,
  // enforces course authority and rejects stale or over-capacity draft saves.
  return editDraft(env, actor, input, 'source.convert', draft => {
    draft.lessons.push(...prepared)
  }, { sourceVersion: extracted.sourceVersion, lessons: lessons.length, reviewed: true, resolvedUncertainties: resolved,
    corrections: lessons.map((lesson, index) => ({ lesson: index + 1, changed: JSON.stringify(lesson) !== JSON.stringify(extracted.lessons[index]) })),
  })
}
