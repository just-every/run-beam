// A format-neutral, bounded preparation document. Asset bytes never enter JSON.
import { insist } from './core'
import { sniff } from './files'
import { normaliseTable, type LessonCell } from './lesson-tables'
import { tableText } from './table-traversal'

export type SourceCell = LessonCell
export interface SourceBlock { kind: 'image' | 'table'; text: string; asset?: string; table?: SourceCell[][] }
export interface ExtractedLesson { title: string; body: string; blocks?: SourceBlock[] }
export interface SourcePassage { location: string; text: string; kind: 'text' | 'heading' | 'table' | 'image'; lesson: number }
export interface SourceAsset { id: string; filename: string; mediaType: string; bytes: Uint8Array }
export interface SourceUncertainty { id: string; location: string; text: string; reason: string; requiresOcr: boolean }
export class SourceContent {
  readonly lessons: ExtractedLesson[] = []
  readonly warnings = new Set<string>()
  readonly passages: SourcePassage[] = []
  readonly assets: SourceAsset[] = []
  readonly uncertainties: SourceUncertainty[] = []
  private current: ExtractedLesson
  private assetBytes = 0
  constructor(title: string) { this.current = { title, body: '' } }
  private flush() {
    if (this.current.body.trim() || this.current.blocks?.length) {
      this.current.body = this.current.body.trim()
      this.lessons.push(this.current)
      insist(this.lessons.length <= 60, 'document_lesson_limit', 422)
    }
  }
  heading(text: string, location: string) {
    text = text.trim()
    insist(text.length > 0 && text.length <= 160, 'document_lesson_limit', 422)
    this.flush(); this.current = { title: text, body: '' }
    this.passage('heading', text, location)
  }
  text(text: string, location: string) {
    if (!text.trim()) return
    this.current.body += `${this.current.body ? '\n\n' : ''}${text}`
    insist(this.current.body.length <= 50_000, 'document_lesson_limit', 422)
    this.passage('text', text, location)
  }
  table(table: SourceCell[][], location: string, caption = 'Procedure table') {
    const checked = normaliseTable(table, { plainText: false })
    this.block({ kind: 'table', text: caption, table: checked })
    this.passage('table', tableText(checked), location)
  }
  image(bytes: Uint8Array | undefined, filename: string, description: string, location: string) {
    const alt = description.trim()
    if (!alt) this.warnings.add('An image has no description. Add an accessible description after comparing it with the original.')
    const label = alt || 'Image description missing; inspect the original'
    if (!bytes) { this.text(`[Image: ${label}]`, location); this.warnings.add('Image bytes were unavailable. Inspect the image in the original before preparing lessons.'); return }
    const mediaType = sniff(bytes)
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mediaType)) { this.text(`[Image: ${label}]`, location); this.warnings.add('An image uses an unsupported format. Its original remains available; convert that image to PNG, JPEG, GIF or WebP before adding it to a lesson.'); return }
    this.assetBytes += bytes.length
    insist(bytes.length <= 8_000_000 && this.assetBytes <= 16_000_000 && this.assets.length < 60, 'document_image_limit', 422)
    const id = `asset-${this.assets.length + 1}`
    this.assets.push({ id, filename, mediaType, bytes })
    this.block({ kind: 'image', text: label, asset: id })
    this.passage('image', label, location)
  }
  uncertain(location: string, text: string, reason: string, requiresOcr = false) {
    this.uncertainties.push({ id: `uncertainty-${this.uncertainties.length + 1}`, location, text, reason, requiresOcr })
    insist(this.uncertainties.length <= 200, 'document_uncertainty_limit', 422)
  }
  private block(block: SourceBlock) {
    ;(this.current.blocks ??= []).push(block)
    insist(this.current.blocks.length <= 60, 'document_lesson_limit', 422)
  }
  private passage(kind: SourcePassage['kind'], text: string, location: string) {
    this.passages.push({ kind, text, location, lesson: this.lessons.length })
    insist(this.passages.length <= 2000, 'document_passage_limit', 422)
  }
  finish(format: string) {
    this.flush()
    insist(this.lessons.length > 0, 'document_no_lessons', 422)
    return { format, lessons: this.lessons, warnings: [...this.warnings], passages: this.passages, assets: this.assets, uncertainties: this.uncertainties, reviewRequired: true as const }
  }
}
export type SourceDocument = ReturnType<SourceContent['finish']>
