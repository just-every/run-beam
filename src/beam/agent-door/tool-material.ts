import type { Bindings } from '../../auth.server.ts'
import { all, insist, one } from '../core.ts'
import type { ToolSpec } from './tool-specs.ts'

/** Native rights checks can contact Microsoft. This preparation surface does
 * not authorize that provider edge, so it refuses before entering the native
 * reader rather than substituting cached rights or disabling the check. */
export async function requireLocalMaterial(env: Bindings, spec: ToolSpec, args: Record<string, unknown>) {
  if (!spec.material) return
  if (spec.view === 'sources') {
    insist(!await one(env, "SELECT 1 FROM beam_microsoft_sources WHERE state='available' LIMIT 1"), 'provider_check_requires_human_door', 403)
    return
  }
  const refs: unknown[] = [args]
  if (typeof args.from === 'string') refs.push(args.from.split(':')[0])
  if (spec.record?.kind === 'notice') {
    refs.push(await one(env, 'SELECT course_id,source_id,previous_version_id,new_version_id FROM beam_source_notices WHERE id=?', args[spec.record.argument]))
  }
  if (spec.record?.kind === 'diagnosis_import') {
    refs.push(await one(env, 'SELECT course,revision FROM beam_diagnosis_imports WHERE id=?', args[spec.record.argument]))
  }
  const payload = args.payload as Record<string, unknown> | undefined
  if (args.kind === 'intervention' && payload?.diagnosis) {
    refs.push(await one(env, 'SELECT i.course,i.revision FROM beam_diagnosis_basis b JOIN beam_diagnosis_imports i ON i.id=b.import_id WHERE b.diagnosis=?', payload.diagnosis))
  }
  if (spec.name === 'beam.material.search') {
    const like = `%${String(args.query).toLowerCase().replace(/[%_\\]/g, value => `\\${value}`)}%`
    refs.push(await all(env, `SELECT r.id FROM beam_courses c JOIN beam_course_revisions r ON r.id=c.published_revision_id
      WHERE c.retired_at IS NULL AND c.archived_at IS NULL AND (lower(r.title) LIKE ? ESCAPE '\\' OR lower(r.summary) LIKE ? ESCAPE '\\')
      ORDER BY r.title LIMIT 50`, like, like))
  }
  // Native draft mutations validate the entire draft, including existing media.
  refs.push((await all(env, "SELECT draft_json FROM beam_courses WHERE id IN (SELECT atom FROM json_tree(?) WHERE type='text')", JSON.stringify(refs))).map(row => JSON.parse(row.draft_json)))
  refs.push(await all(env, `SELECT source_version_ids,blocks_json FROM beam_lesson_revisions
    WHERE course_revision_id IN (SELECT atom FROM json_tree(?) WHERE type='text')`, JSON.stringify(refs)).then(rows => rows.map(row => ({ sources: JSON.parse(row.source_version_ids), blocks: JSON.parse(row.blocks_json) }))))
  const encoded = JSON.stringify(refs)
  const provider = await one(env, `WITH refs AS (SELECT atom FROM json_tree(?) WHERE type='text'),
    cited AS (SELECT sha256 FROM beam_source_versions WHERE id IN refs OR source_id IN refs OR sha256 IN refs)
    SELECT 1 FROM beam_microsoft_sources m JOIN beam_source_versions v ON v.source_id=m.source_id
    WHERE m.source_id IN refs OR v.id IN refs OR v.sha256 IN (SELECT sha256 FROM cited) LIMIT 1`, encoded)
  insist(!provider, 'provider_check_requires_human_door', 403)
}
