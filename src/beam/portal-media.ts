import type { Bindings } from '../auth.server'
import { insist, one } from './core'
import { loadCaptionSource } from './captions'
import { serve, type Stored } from './files'
import type { Block } from './media'
import { portalAdmission } from './portal-admission'
import { loadSourceAsset } from './source-extraction'

const supported = ['text', 'table', 'check', 'image', 'audio', 'video', 'document']
// The same allowlist gates read receipts and completion inside their write transactions.
export const portalUnsupportedBlocks = `EXISTS(SELECT 1 FROM json_each(l.blocks_json) b
 WHERE json_extract(b.value,'$.kind') IS NULL OR json_extract(b.value,'$.kind') NOT IN (${supported.map(kind => `'${kind}'`).join(',')}))`
export const portalLessonAvailable = (blocks: Block[]) => blocks.every(block => supported.includes(block.kind))

// Sharing a lesson exposes its approved content, never source provenance, source ids or reuse attribution.
export function portalBlocks(blocks: Block[]): Block[] {
  return blocks.map(({ id, kind, text, table, choices, answer, feedback, captions }) => ({ id, kind, text,
    ...(table ? { table } : {}), ...(choices ? { choices, answer, feedback } : {}),
    ...(captions ? { captions: { source: '', language: captions.language, label: captions.label } } : {}) }))
}

export async function portalMedia(env: Bindings, request: Request, portal: string, identity: string, account: string) {
  insist(['GET', 'HEAD'].includes(request.method), 'method_not_allowed', 405)
  const query = new URL(request.url).searchParams
  const args = [portal, query.get('enrollment') ?? '', identity, account]
  const enrollment = await one(env, portalAdmission, ...args)
  insist(enrollment, 'portal_enrollment_not_found', 404)
  const lesson = await one(env, 'SELECT blocks_json FROM beam_lesson_revisions WHERE id=? AND course_revision_id=?', query.get('lesson'), enrollment.revision_id)
  insist(lesson, 'portal_lesson_not_found', 404)
  const blocks: Block[] = JSON.parse(lesson.blocks_json)
  const block = blocks.find(block => block.id === query.get('block'))
  insist(block && portalLessonAvailable(blocks) && ['image', 'audio', 'video', 'document'].includes(block.kind), 'portal_media_not_found', 404)
  let response: Response
  if (query.has('caption')) {
    insist(block.kind === 'video' && block.captions, 'portal_caption_not_found', 404)
    const caption = await loadCaptionSource(env, block.captions.source)
    response = new Response(new Uint8Array(caption.bytes), { headers: { 'content-type': 'text/vtt; charset=utf-8', 'content-security-policy': "sandbox; default-src 'none'" } })
  } else if (block.asset) {
    const asset = await loadSourceAsset(env, block.source!, block.asset)
    response = new Response(new Uint8Array(asset.bytes), { headers: { 'content-type': asset.mediaType, 'content-security-policy': "sandbox; default-src 'none'" } })
  } else {
    const source = await one<Stored>(env, `SELECT v.filename,v.media_type AS mediaType,v.size,v.sha256 FROM beam_source_versions v
      JOIN beam_sources s ON s.id=v.source_id WHERE v.id=? AND s.erased_at IS NULL`, block.source)
    insist(source, 'portal_media_not_found', 404)
    response = await serve(env, source, { download: query.has('download') })
  }
  // File reads must not turn an admission closed during the read into a successful response.
  insist(await one(env, portalAdmission, ...args), 'portal_enrollment_not_found', 404)
  response.headers.set('cache-control', 'no-store')
  response.headers.set('referrer-policy', 'no-referrer')
  response.headers.set('x-content-type-options', 'nosniff')
  return request.method === 'HEAD' ? new Response(null, response) : response
}
