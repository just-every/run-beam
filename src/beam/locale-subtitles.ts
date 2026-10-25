// Timed translation is text-only until human approval creates immutable sources.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { CAPTION_BYTES, loadCaptionSource, normaliseCaptionReference, validateWebVtt } from './captions'
import { all, commit, insist, newId, now, one, stmt } from './core'
import type { Draft } from './courses'
import { store } from './files'
import type { Input } from './input'
import { supportedLanguage } from './language'
import { requireCourseRole } from './units'

export interface LocaleSubtitleCue {
  key: string; label: string; value: string; id: string | null
  timing: string; start: number; end: number; prefix: string[]
}
export interface LocaleSubtitleTrack {
  sourceVersion: string; sha256: string; filename: string; title: string
  licence: string; licenceEvidence: string; reviewer: string
  uses: { lesson: number; block: number }[]
  cues: LocaleSubtitleCue[]; tail: string[]
}
export type LocaleSubtitleTexts = Record<string, string>
export interface LocaleSubtitleField { key: string; label: string; value: string }

/** Retain every non-payload line verbatim (after the shared CRLF normalization).
 * The existing validator owns timing, settings, UTF-8, size and inertness rules. */
export function parseLocaleSubtitleTrack(bytes: Uint8Array, trackIndex = 0) {
  const checked = validateWebVtt(bytes), lines = checked.text.split('\n')
  const cues: LocaleSubtitleCue[] = []
  let cursor = 2, copied = 0
  while (cursor < lines.length) {
    if (!lines[cursor].trim()) { cursor++; continue }
    let timing = lines[cursor++], id: string | null = null
    if (!timing.includes('-->')) { id = timing; timing = lines[cursor++] }
    const payloadStart = cursor
    while (cursor < lines.length && lines[cursor].trim()) cursor++
    const cue = checked.cues[cues.length]
    cues.push({ key: `locale_subtitle_${trackIndex}_${cues.length}`, label: `Caption track ${trackIndex + 1}, cue ${cues.length + 1}`,
      value: cue.text, id, timing, start: cue.start, end: cue.end, prefix: lines.slice(copied, payloadStart) })
    copied = cursor
  }
  return { cues, tail: lines.slice(copied) }
}

/** Staff-only originals from a published base, including erasure and stale-source fences. */
export async function collectLocaleSubtitles(env: Bindings, actor: Actor, course: string, baseRevision: string) {
  await requireCourseRole(env, actor, course, 'author')
  insist(await one(env, `SELECT 1 FROM beam_courses c JOIN beam_course_revisions r ON r.course_id=c.id
    WHERE c.id=? AND r.id=? AND r.state IN ('published','superseded')
    AND NOT EXISTS(SELECT 1 FROM beam_course_locales l WHERE l.revision_id=r.id)`, course, baseRevision), 'locale_base_changed', 409)
  insist(!await one(env, `SELECT 1 FROM beam_lesson_revisions l,json_each(l.source_version_ids) cite
    LEFT JOIN beam_source_versions v ON v.id=cite.value LEFT JOIN beam_sources s ON s.id=v.source_id
    WHERE l.course_revision_id=? AND (v.id IS NULL OR s.erased_at IS NOT NULL
      OR EXISTS(SELECT 1 FROM beam_erasure_jobs e WHERE e.kind='source' AND e.subject_id=s.id AND e.state!='complete')) LIMIT 1`, baseRevision), 'locale_sources_changed', 409)
  const lessons = await all<{ blocks_json: string }>(env, 'SELECT blocks_json FROM beam_lesson_revisions WHERE course_revision_id=? ORDER BY position', baseRevision)
  const tracks: LocaleSubtitleTrack[] = [], bySource = new Map<string, LocaleSubtitleTrack>()
  let totalBytes = 0, totalCues = 0
  for (let lesson = 0; lesson < lessons.length; lesson++) {
    const blocks = JSON.parse(lessons[lesson].blocks_json) as NonNullable<Draft['lessons'][number]['blocks']>
    for (let block = 0; block < blocks.length; block++) {
      const caption = blocks[block].captions
      if (!caption) continue
      let track = bySource.get(caption.source)
      if (!track) {
        insist(tracks.length < 30, 'locale_subtitle_track_limit')
        const source = await one(env, `SELECT s.title,s.licence,s.licence_evidence,s.reviewer_id FROM beam_source_versions v
          JOIN beam_sources s ON s.id=v.source_id WHERE v.id=? AND s.erased_at IS NULL
          AND NOT EXISTS(SELECT 1 FROM beam_erasure_jobs e WHERE e.kind='source' AND e.subject_id=s.id AND e.state!='complete')`, caption.source)
        insist(source, 'source_version_not_found', 404)
        const loaded = await loadCaptionSource(env, caption.source), parsed = parseLocaleSubtitleTrack(loaded.bytes, tracks.length)
        totalBytes += loaded.size; totalCues += parsed.cues.length
        insist(totalBytes <= CAPTION_BYTES && totalCues <= 5000, 'locale_subtitle_limit')
        track = { sourceVersion: caption.source, sha256: loaded.sha256, filename: loaded.filename,
          title: source.title, licence: source.licence, licenceEvidence: source.licence_evidence,
          reviewer: source.reviewer_id, uses: [], ...parsed }
        tracks.push(track); bySource.set(caption.source, track)
      }
      track.uses.push({ lesson, block })
    }
  }
  return { tracks, fields: localeSubtitleFields(tracks) }
}

/** Same {key,label,value} contract as ordinary authored translation fields. */
export function localeSubtitleFields(tracks: LocaleSubtitleTrack[], texts?: LocaleSubtitleTexts): LocaleSubtitleField[] {
  return tracks.flatMap(track => track.cues.map(cue => ({ key: cue.key, label: cue.label,
    value: texts ? texts[cue.key] : cue.value })))
}
export const localeSubtitleTextFields = localeSubtitleFields

function rebuild(track: LocaleSubtitleTrack, texts: LocaleSubtitleTexts) {
  const lines = track.cues.flatMap(cue => [...cue.prefix, ...texts[cue.key].split('\n')])
  const bytes = new TextEncoder().encode([...lines, ...track.tail].join('\n'))
  const parsed = parseLocaleSubtitleTrack(bytes)
  insist(parsed.cues.length === track.cues.length && parsed.cues.every((cue, i) =>
    cue.id === track.cues[i].id && cue.timing === track.cues[i].timing
    && cue.prefix.join('\n') === track.cues[i].prefix.join('\n'))
    && parsed.tail.join('\n') === track.tail.join('\n'), 'locale_subtitle_structure_changed', 409)
  return bytes
}

/** A complete, exact map: no omitted cue, invented field, markup or new cue delimiter. */
export function validateLocaleSubtitleTexts(tracks: LocaleSubtitleTrack[], value: unknown): LocaleSubtitleTexts {
  insist(value && typeof value === 'object' && !Array.isArray(value), 'invalid_locale_subtitles')
  const supplied = value as Record<string, unknown>, fields = localeSubtitleFields(tracks)
  insist(Object.keys(supplied).length === fields.length, 'locale_subtitle_fields_changed', 409)
  const texts: LocaleSubtitleTexts = {}
  for (const field of fields) {
    const text = Object.hasOwn(supplied, field.key) ? supplied[field.key] : undefined
    insist(typeof text === 'string' && text.trim() && text.length <= 4000, 'invalid_locale_subtitle_text')
    const normalized = text.replace(/\r\n?/g, '\n')
    insist(normalized.split('\n').every(line => line.trim()), 'invalid_locale_subtitle_text')
    texts[field.key] = normalized
  }
  let size = 0
  for (const track of tracks) { size += rebuild(track, texts).length; insist(size <= CAPTION_BYTES, 'locale_subtitle_limit') }
  return texts
}

export function editedLocaleSubtitles(tracks: LocaleSubtitleTrack[], input: Input) {
  return validateLocaleSubtitleTexts(tracks, Object.fromEntries(localeSubtitleFields(tracks).map(field =>
    [field.key, input.text(field.key, { max: 4000 })])))
}

/** Invoke only after the human language decision has been authorized. The draft
 * must still carry its reviewed original references. No model call occurs here.
 * Sources are committed before the caller validates and publishes the rewritten draft;
 * a failed publication leaves ordinary retained source custody, never a revision. */
export async function materializeLocaleSubtitles(env: Bindings, actor: Actor, options: {
  course: string; baseRevision: string; locale: string; texts: unknown; draft: Draft
}) {
  const { course, baseRevision } = options, locale = supportedLanguage(options.locale)
  insist(locale, 'unsupported_language')
  const { tracks } = await collectLocaleSubtitles(env, actor, course, baseRevision)
  const texts = validateLocaleSubtitleTexts(tracks, options.texts), draft = structuredClone(options.draft)
  const statements: D1PreparedStatement[] = [], sourceVersions: string[] = [], at = now()
  // Validate all references before writing any retained original.
  for (const track of tracks) for (const use of track.uses) {
    const caption = draft.lessons[use.lesson]?.blocks?.[use.block]?.captions
    insist(caption?.source === track.sourceVersion, 'locale_subtitle_reference_changed', 409)
  }
  for (const track of tracks) {
    const id = newId(), version = newId(), bytes = rebuild(track, texts)
    const filename = `${track.filename.replace(/\.[^.]*$/, '').slice(0, 150)}-${locale}.vtt`
    const stored = await store(env, { filename, bytes })
    const provenance = JSON.stringify({ kind: 'beam.locale-subtitles.v1', course, baseRevision, locale,
      sourceVersion: track.sourceVersion, sourceSha256: track.sha256 })
    statements.push(
      stmt(env, 'INSERT INTO beam_sources(id,title,licence,licence_evidence,reviewer_id,created_by,created_at) VALUES(?,?,?,?,?,?,?)', id, `${track.title.slice(0, 140)} · ${locale}`, track.licence, track.licenceEvidence, track.reviewer, actor.id, at),
      stmt(env, 'INSERT INTO beam_source_versions(id,source_id,number,filename,media_type,size,sha256,provenance,uploaded_by,uploaded_at) VALUES(?,?,1,?,?,?,?,?,?,?)', version, id, stored.filename, stored.mediaType, stored.size, stored.sha256, provenance, actor.id, at),
    )
    for (const use of track.uses) {
      const lesson = draft.lessons[use.lesson], block = lesson.blocks![use.block]
      block.captions = normaliseCaptionReference({ source: version, language: locale, label: locale })
      // Keep original provenance and authorize the new exact source for learners.
      lesson.sources = [...new Set([...lesson.sources, version])]
    }
    sourceVersions.push(version)
  }
  if (statements.length) await commit(env, statements, { actor, action: 'locale.subtitles', subject: baseRevision,
    detail: { course, baseRevision, locale, originals: tracks.map(track => ({ version: track.sourceVersion, sha256: track.sha256 })), sourceVersions } })
  return { draft, sourceVersions }
}
