// Flow 2: owned source documents and media with provenance, licence evidence
// and a responsible reviewer. Versions are immutable; a new version flags every
// course whose current material cites an earlier one (procedure maintenance).
import type { Bindings } from '../auth.server'
import { askAgainStatements } from './acknowledgments'
import { requireRole, type Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import { serve, store } from './files'
import type { Input } from './input'

const LICENCES = ['owned', 'licensed', 'permission']
export const SOURCE_BYTES = 25_000_000

export async function createSource(env: Bindings, actor: Actor, input: Input) {
  requireRole(actor, 'author')
  const title = input.text('title', { max: 160 })
  const licence = input.text('licence')
  insist(LICENCES.includes(licence), 'invalid_licence')
  const evidence = input.text('licenceEvidence', { max: 2000 })
  const reviewer = input.text('reviewer')
  insist(await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', reviewer), 'reviewer_not_found', 404)
  const provenance = input.text('provenance', { max: 2000 })
  const file = (await input.file('file', { maxBytes: SOURCE_BYTES }))!
  const stored = await store(env, file)
  const id = newId(), versionId = newId(), at = now()
  await commit(env, [
    stmt(env, 'INSERT INTO beam_sources (id, title, licence, licence_evidence, reviewer_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, title, licence, evidence, reviewer, actor.id, at),
    stmt(env, 'INSERT INTO beam_source_versions (id, source_id, number, filename, media_type, size, sha256, provenance, uploaded_by, uploaded_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)', versionId, id, stored.filename, stored.mediaType, stored.size, stored.sha256, provenance, actor.id, at),
  ], { actor, action: 'source.create', subject: id, detail: { title, licence, sha256: stored.sha256 } })
  return { id, versionId, ...stored }
}

export async function addSourceVersion(env: Bindings, actor: Actor, input: Input) {
  requireRole(actor, 'author')
  const sourceId = input.text('source')
  const source = await one(env, 'SELECT id FROM beam_sources WHERE id = ?', sourceId)
  insist(source, 'source_not_found', 404)
  const provenance = input.text('provenance', { max: 2000 })
  const stored = await store(env, (await input.file('file', { maxBytes: SOURCE_BYTES }))!)
  const latest = await one<{ number: number }>(env, 'SELECT MAX(number) AS number FROM beam_source_versions WHERE source_id = ?', sourceId)
  const id = newId(), number = (latest?.number ?? 0) + 1, at = now()
  // Courses whose published revision cites an earlier version of this source.
  const cited = await all<{ course_id: string; version_id: string }>(env, `SELECT DISTINCT c.id AS course_id, v.id AS version_id
    FROM beam_courses c JOIN beam_lesson_revisions l ON l.course_revision_id = c.published_revision_id
    JOIN json_each(l.source_version_ids) j JOIN beam_source_versions v ON v.id = j.value
    WHERE v.source_id = ?`, sourceId)
  await commit(env, [
    stmt(env, 'INSERT INTO beam_source_versions (id, source_id, number, filename, media_type, size, sha256, provenance, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, sourceId, number, stored.filename, stored.mediaType, stored.size, stored.sha256, provenance, actor.id, at),
    ...askAgainStatements(env, actor, sourceId, id, at),
    ...cited.map(row => stmt(env, "INSERT OR IGNORE INTO beam_source_notices (id, course_id, source_id, previous_version_id, new_version_id, state, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)", newId(), row.course_id, sourceId, row.version_id, id, at)),
  ], { actor, action: 'source.version', subject: sourceId, detail: { number, sha256: stored.sha256, flaggedCourses: cited.map(row => row.course_id) } })
  return { id, number, flaggedCourses: [...new Set(cited.map(row => row.course_id))], ...stored }
}

export async function listSources(env: Bindings, actor: Actor) {
  requireRole(actor, 'author', 'reviewer', 'manager')
  return await all(env, `SELECT s.id, s.title, s.licence, s.licence_evidence AS licenceEvidence, s.reviewer_id AS reviewer, s.created_at AS createdAt,
    (SELECT json_group_array(json_object('id', v.id, 'number', v.number, 'filename', v.filename, 'mediaType', v.media_type, 'size', v.size, 'sha256', v.sha256, 'provenance', v.provenance, 'uploadedBy', v.uploaded_by, 'uploadedAt', v.uploaded_at)) FROM (SELECT * FROM beam_source_versions WHERE source_id = s.id ORDER BY number) v) AS versions
    FROM beam_sources s ORDER BY s.title`).then(rows => rows.map(row => ({ ...row, versions: JSON.parse(row.versions) }) as Row))
}

/** Staff may open any source version; a learner one cited by a course revision assigned to them, inside its access window (AUTO-009). */
export async function sourceFile(env: Bindings, actor: Actor, versionId: string, download: boolean) {
  const version = await one(env, 'SELECT filename, media_type AS mediaType, size, sha256 FROM beam_source_versions WHERE id = ?', versionId)
  insist(version, 'not_found', 404)
  const staff = actor.owner || ['author', 'reviewer', 'manager'].some(role => actor.roles.has(role as never))
  const cited = staff || await one(env, `SELECT 1 FROM beam_assignments a JOIN beam_lesson_revisions l ON l.course_revision_id = a.course_revision_id
    JOIN json_each(l.source_version_ids) j WHERE a.learner_id = ? AND j.value = ?
    AND (a.access_opens_at IS NULL OR a.access_opens_at <= ?) AND (a.access_closes_at IS NULL OR a.access_closes_at > ?) LIMIT 1`, actor.id, versionId, now(), now())
  insist(cited, 'not_found', 404)
  return serve(env, version as never, { download })
}
