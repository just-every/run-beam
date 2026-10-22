// Caption originals remain immutable sources. Only bounded, inert WebVTT is
// admitted; serving it still requires the ordinary source-file authorization.
import type { Bindings } from '../auth.server'
import { insist, one, sha256Hex } from './core'
import type { Stored } from './files'

export interface Captions { source: string; language: string; label: string }
export interface CaptionCue { start: number; end: number; text: string }
export const CAPTION_BYTES = 1_000_000

const controls = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/

export function normaliseCaptionReference(value: unknown): Captions {
  insist(value && typeof value === 'object' && !Array.isArray(value), 'invalid_captions')
  const { source, language, label } = value as Partial<Captions>
  insist(typeof source === 'string' && source.length > 0 && source.length <= 200 && source === source.trim(), 'invalid_caption_source')
  insist(typeof language === 'string' && language.length > 0 && language.length <= 100, 'invalid_caption_language')
  let canonical: string | undefined
  try { canonical = Intl.getCanonicalLocales(language)[0] } catch { /* refused below */ }
  insist(canonical, 'invalid_caption_language')
  insist(typeof label === 'string' && label.trim() && label.length <= 100 && !controls.test(label) && !/[<>\r\n\t]/.test(label), 'invalid_caption_label')
  return { source, language: canonical, label: label.trim() }
}

function timestamp(value: string) {
  const match = /^(?:(\d{2,4}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(value)
  insist(match, 'invalid_caption_timestamp')
  return Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000
}

function percentage(value: string) {
  return /^\d{1,3}(?:\.\d+)?%$/.test(value) && Number(value.slice(0, -1)) <= 100
}

function settings(value: string[]) {
  const seen = new Set<string>()
  for (const setting of value) {
    const [name, content, extra] = setting.split(':')
    insist(content && extra === undefined && !seen.has(name), 'invalid_caption_settings')
    seen.add(name)
    const [position, alignment, trailing] = content.split(',')
    let valid = false
    if (name === 'vertical') valid = content === 'rl' || content === 'lr'
    if (name === 'align') valid = ['start', 'center', 'end', 'left', 'right'].includes(content)
    if (name === 'size') valid = percentage(content)
    if (name === 'line') valid = trailing === undefined && (percentage(position) || /^-?\d{1,4}$/.test(position)) && (alignment === undefined || ['start', 'center', 'end'].includes(alignment))
    if (name === 'position') valid = trailing === undefined && percentage(position) && (alignment === undefined || ['line-left', 'center', 'line-right'].includes(alignment))
    insist(valid, 'invalid_caption_settings')
  }
}

/** Plain cue text and standard cue positioning only: no styles, regions,
 * markup, inline timestamps, remote references or executable content. */
export function validateWebVtt(bytes: Uint8Array): { text: string; cues: CaptionCue[] } {
  insist(bytes.length > 0 && bytes.length <= CAPTION_BYTES, 'caption_size')
  let text: string | undefined
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { /* refused below */ }
  insist(text !== undefined, 'invalid_caption_utf8')
  insist(!controls.test(text), 'invalid_caption_controls')
  text = text.replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  insist(/^WEBVTT(?:[ \t][^<>]*)?$/.test(lines[0]) && lines.length > 1 && !lines[1].trim(), 'invalid_webvtt')
  const cues: CaptionCue[] = []
  let cursor = 2
  while (cursor < lines.length) {
    if (!lines[cursor].trim()) { cursor++; continue }
    let timing = lines[cursor++]
    if (!timing.includes('-->')) {
      insist(timing.length <= 200 && !/[<>]/.test(timing) && !/^(?:STYLE|REGION|NOTE)(?:[ \t]|$)/.test(timing), 'invalid_caption_cue')
      timing = lines[cursor++] ?? ''
    }
    const match = /^(\S+)[ \t]+-->[ \t]+(\S+)(?:[ \t]+(.*))?$/.exec(timing)
    insist(match, 'invalid_caption_cue')
    const start = timestamp(match[1]), end = timestamp(match[2])
    insist(end > start && (!cues.length || start >= cues[cues.length - 1].start), 'invalid_caption_order')
    if (match[3]) settings(match[3].trim().split(/[ \t]+/))
    const payload: string[] = []
    while (cursor < lines.length && lines[cursor].trim()) payload.push(lines[cursor++])
    const cueText = payload.join('\n')
    insist(cueText.trim() && cueText.length <= 4000 && !/[<>]/.test(cueText), 'invalid_caption_text')
    cues.push({ start, end, text: cueText })
    insist(cues.length <= 5000, 'caption_cue_limit')
  }
  insist(cues.length > 0, 'caption_cues_required')
  return { text, cues }
}

/** Load and validate the actual source original, never its extracted text.
 * Caller must authorize this source version before returning bytes to a user. */
export async function loadCaptionSource(env: Bindings, versionId: string): Promise<Stored & { bytes: Uint8Array; text: string; cues: CaptionCue[] }> {
  const source = await one<Stored>(env, `SELECT v.filename, v.media_type AS mediaType, v.size, v.sha256
    FROM beam_source_versions v JOIN beam_sources s ON s.id=v.source_id WHERE v.id=? AND s.erased_at IS NULL`, versionId)
  insist(source, 'source_version_not_found', 404)
  insist(source.mediaType === 'text/vtt' || source.mediaType === 'text/plain', 'caption_type_mismatch')
  insist(source.size > 0 && source.size <= CAPTION_BYTES, 'caption_size')
  const object = await env.FILES.get(`sha256/${source.sha256}`)
  insist(object, 'file_missing', 503)
  insist(object.size === source.size, 'file_integrity', 503)
  const bytes = new Uint8Array(await object.arrayBuffer())
  insist(bytes.length === source.size && await sha256Hex(bytes) === source.sha256, 'file_integrity', 503)
  return { ...source, bytes, ...validateWebVtt(bytes) }
}
