// AUTHOR-002: read-only extraction and an explicit author-reviewed conversion.
// No extraction writes records, publishes, or changes the immutable original.
import type { Bindings } from '../auth.server'
import { requireRole, type Actor } from './actor'
import { insist, newId, one } from './core'
import { editDraft } from './courses'
import { sourceFile } from './sources'
import { extractDocument } from './source-document'
import type { Input } from './input'

export async function sourceExtraction(env: Bindings, actor: Actor, id: string) {
  requireRole(actor, 'author')
  const version = await one(env, 'SELECT v.*, s.title FROM beam_source_versions v JOIN beam_sources s ON s.id = v.source_id WHERE v.id = ?', id)
  insist(version, 'source_version_not_found', 404)
  // The existing public-file custody path verifies both size and digest.
  const bytes = new Uint8Array(await (await sourceFile(env, actor, id, true)).arrayBuffer())
  return {
    sourceVersion: id, source: version.source_id, title: version.title, number: version.number,
    filename: version.filename, provenance: version.provenance, sha256: version.sha256,
    original: `/api/beam/source-files/${id}`,
    ...extractDocument(bytes, version.filename, version.title),
  }
}

export async function convertSource(env: Bindings, actor: Actor, input: Input) {
  const extracted = await sourceExtraction(env, actor, input.text('sourceVersion'))
  insist(input.flag('reviewed'), 'source_review_required', 409)
  const lessons = input.json('lessons') as { title: string; body: string }[]
  insist(Array.isArray(lessons) && lessons.length > 0 && lessons.length <= 60, 'invalid_extracted_lessons')
  // Corrections are normal authored content. editDraft validates every value,
  // enforces course authority and rejects stale or over-capacity draft saves.
  return editDraft(env, actor, input, 'source.convert', draft => {
    draft.lessons.push(...lessons.map(lesson => ({ id: newId(), title: lesson?.title, body: lesson?.body, sources: [extracted.sourceVersion] })))
  }, { sourceVersion: extracted.sourceVersion, lessons: lessons.length, reviewed: true })
}
