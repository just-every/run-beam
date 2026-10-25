// Explicit withdrawal of complete editable lessons; frozen learning and assessments are never rewritten.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import type { Input } from './input'
import type { Draft } from './courses'
import { all, commit, insist, one, sha256Hex, stmt } from './core'
import { erasureOwner } from './erasure-policy'
import { erasurePreview } from './erasure'
import { preparedCheckpoint } from './erasure-fence'

interface CourseRow { id: string; title: string; draft_version: number; draft_json: string }
export interface SourceDrafts {
  courses: { id: string; title: string; draftVersion: number; lessons: { id: string; title: string }[]; digest: string }[]
  blocked: string[]
}
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`
const contains = (column: string) => `EXISTS(SELECT 1 FROM json_tree(CASE WHEN json_valid(${column}) THEN ${column} ELSE 'null' END) j WHERE j.atom IN (SELECT value FROM json_each(?1)))`
const refers = (value: unknown, ids: Set<string>): boolean => typeof value === 'string' ? ids.has(value)
  : Array.isArray(value) ? value.some(item => refers(item, ids))
  : !!value && typeof value === 'object' && Object.values(value).some(item => refers(item, ids))
const digest = (row: CourseRow) => sha256Hex(new TextEncoder().encode(JSON.stringify([row.id, row.title, row.draft_version, row.draft_json])))
const coupled = new Set(['beam_course_revisions', 'beam_proposals', 'beam_course_locales', 'beam_draft_conflicts', 'beam_locale_glossaries', 'beam_course_comments'])
// Original metadata/OCR are retired by source erasure. Audit and privacy receipts retain justified ids/times.
const handled = new Set(['beam_sources', 'beam_source_versions', 'beam_source_ocr_runs', 'beam_model_run_sources', 'beam_courses', 'beam_audit'])
const MAX_SUBJECTS = 20_000
const subjectLimit = 'Source-derived identity inventory exceeds the bounded withdrawal limit.'

async function custody(env: Bindings, source: string) {
  const versions = await all<{ id: string; sha256: string }>(env, 'SELECT id,sha256 FROM beam_source_versions WHERE source_id=? ORDER BY id LIMIT 20001', source)
  const ids = new Set([source, ...versions.slice(0, MAX_SUBJECTS - 1).map(row => row.id)]), rows = new Map<string, CourseRow>(), drafts = new Map<string, Draft>()
  const blocked = new Set<string>()
  if (versions.length >= MAX_SUBJECTS) blocked.add(subjectLimit)
  const addIdentity = (id: string) => {
    if (ids.size >= MAX_SUBJECTS && !ids.has(id)) blocked.add(subjectLimit)
    else ids.add(id)
  }
  // Follow preserved lesson/block reuse attribution as well as direct source/caption references.
  while (!blocked.has(subjectLimit)) {
    const previous = ids.size
    const candidates = await all<CourseRow>(env, `SELECT id,title,draft_version,draft_json FROM beam_courses WHERE ${contains('draft_json')} ORDER BY id LIMIT 41`, JSON.stringify([...ids]))
    for (const row of candidates) {
      rows.set(row.id, row)
      const draft = JSON.parse(row.draft_json) as Draft
      drafts.set(row.id, draft)
      for (const lesson of draft.lessons) if (refers(lesson, ids)) {
        addIdentity(lesson.id)
        for (const block of lesson.blocks ?? []) addIdentity(block.id)
      }
    }
    if (rows.size > 40) { blocked.add('More than 40 courses contain source-derived draft content.'); break }
    if (previous === ids.size) break
  }
  const ordered = [...rows.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 40)
  const courses = await Promise.all(ordered.map(async row => {
    const draft = drafts.get(row.id)!, lessons = draft.lessons.filter(lesson => refers(lesson, ids))
    if (draft.questions.length || draft.practical || draft.sequence || draft.assessor || draft.attendancePercent || draft.survey?.length || draft.packages?.length || draft.xapiActivities?.length) blocked.add(`${row.id}: assessment, sequence or external learning coupling requires separate withdrawal.`)
    if (refers({ ...draft, lessons: draft.lessons.filter(lesson => !lessons.includes(lesson)) }, ids)) blocked.add(`${row.id}: source references outside the affected lessons require separate withdrawal.`)
    return { id: row.id, title: row.title, draftVersion: row.draft_version, lessons: lessons.map(({ id, title }) => ({ id, title })), digest: await digest(row) }
  }))
  const subjects = JSON.stringify([...ids]), courseIds = JSON.stringify(ordered.map(row => row.id))
  const columns = await all<{ table_name: string; column_name: string; source_ref: number }>(env, `SELECT m.name AS table_name,p.name AS column_name,
    EXISTS(SELECT 1 FROM pragma_foreign_key_list(m.name) f WHERE f."from"=p.name AND f."table" IN ('beam_sources','beam_source_versions')) AS source_ref
    FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type='table' AND m.name GLOB 'beam_*'`)
  const tables = new Map<string, string[]>()
  for (const column of columns) {
    const table = column.table_name, name = column.column_name
    if (handled.has(table) || table.startsWith('beam_erasure_')) continue
    const conditions = tables.get(table) ?? []
    if (column.source_ref || /(?:^|_)source(?:_|$)|sourceVersion|^(?:previous_version_id|new_version_id)$/.test(name)) conditions.push(`${quote(name)} IN (SELECT value FROM json_each(?1))`)
    if (/_json$/.test(name) || ['source_version_ids','input_version_ids','payload','settings','detail','evidence','via','retrain_roles'].includes(name)) conditions.push(contains(quote(name)))
    if (coupled.has(table) && name === 'course_id') conditions.push(`${quote(name)} IN (SELECT value FROM json_each(?2))`)
    if (conditions.length) tables.set(table, conditions)
  }
  const checks = [...tables].map(([table, conditions]) => ({ table, sql: `SELECT 1 FROM ${quote(table)} WHERE (${conditions.join(' OR ')}) AND (?2 IS NULL OR 1) LIMIT 1` }))
  await Promise.all(checks.map(async check => {
    if (await one(env, check.sql, subjects, courseIds)) blocked.add(`${check.table}: retained source, frozen content or shared snapshot custody requires separate withdrawal.`)
  }))
  const sourceRow = await one<{ erased_at: number | null }>(env, 'SELECT erased_at FROM beam_sources WHERE id=?', source)
  if (!sourceRow || sourceRow.erased_at) blocked.add('The source is already erased or unavailable.')
  if (await one(env, "SELECT 1 FROM beam_erasure_holds WHERE kind='source' AND subject_id=? AND released_at IS NULL", source)) blocked.add('An active source hold prevents draft withdrawal.')
  if (await one(env, "SELECT 1 FROM beam_erasure_jobs WHERE kind='source' AND subject_id=? AND state!='complete'", source)) blocked.add('Source erasure is already in progress.')
  return { view: { courses, blocked: [...blocked].sort() } satisfies SourceDrafts, ordered, drafts, ids, subjects, courseIds, versions, checks }
}

export async function sourceDrafts(env: Bindings, source: string): Promise<SourceDrafts> { return (await custody(env, source)).view }

/** Checks are executed inside the same atomic batch as the draft updates or source-erasure admission. */
export async function sourceDraftFence(env: Bindings, source: string, { allowDrafts = false, expectedFileHashes }: { allowDrafts?: boolean; expectedFileHashes?: string[] } = {}) {
  const state = await custody(env, source)
  insist(!expectedFileHashes || JSON.stringify(state.versions.map(version => version.sha256)) === JSON.stringify(expectedFileHashes), 'stale_erasure_preview', 409)
  insist(!state.view.blocked.length, 'unsupported_source_custody', 409, state.view.blocked)
  const statements = state.checks.map(check => stmt(env, `INSERT INTO beam_erasure_guard SELECT CASE WHEN NOT EXISTS(${check.sql}) THEN 1 ELSE 0 END`, state.subjects, state.courseIds))
  statements.push(stmt(env, `INSERT INTO beam_erasure_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM beam_sources WHERE id=?1 AND erased_at IS NULL)
    AND NOT EXISTS(SELECT 1 FROM beam_erasure_holds WHERE kind='source' AND subject_id=?1 AND released_at IS NULL)
    AND NOT EXISTS(SELECT 1 FROM beam_erasure_jobs WHERE kind='source' AND subject_id=?1 AND state!='complete')
    AND (SELECT count(*) FROM beam_source_versions WHERE source_id=?1)=json_array_length(?2)
    AND NOT EXISTS(SELECT 1 FROM beam_source_versions WHERE source_id=?1 AND id NOT IN (SELECT value FROM json_each(?2))) THEN 1 ELSE 0 END`, source, JSON.stringify(state.versions.map(row => row.id))))
  statements.push(stmt(env, `INSERT INTO beam_erasure_guard SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM beam_courses WHERE ${contains('draft_json')}${allowDrafts ? ' AND id NOT IN (SELECT value FROM json_each(?2))' : ''}) AND (?2 IS NULL OR 1) THEN 1 ELSE 0 END`, state.subjects, state.courseIds))
  return { state, statements }
}

export async function withdrawSourceDrafts(env: Bindings, actor: Actor, input: Input) {
  erasureOwner(actor)
  insist(input.text('kind') === 'source', 'source_erasure_required')
  const preview = await erasurePreview(env, actor, input)
  insist(input.flag('consent'), 'source_draft_withdrawal_consent_required', 409)
  insist(input.text('digest') === preview.digest, 'stale_erasure_preview', 409)
  insist(input.text('justification', { max: 2000 }), 'source_draft_withdrawal_reason_required')
  const { state, statements } = await sourceDraftFence(env, preview.subject, { allowDrafts: true, expectedFileHashes: preview.inventory.fileHashes })
  insist(JSON.stringify(state.view) === JSON.stringify(preview.inventory.sourceDrafts) && state.view.courses.length, 'stale_erasure_preview', 409)
  for (const row of state.ordered) {
    const draft = state.drafts.get(row.id)!, kept = draft.lessons.filter(lesson => !refers(lesson, state.ids))
    const after: Draft = { ...draft, lessons: kept }
    statements.push(stmt(env, 'UPDATE beam_courses SET draft_json=?,draft_version=draft_version+1 WHERE id=? AND draft_version=? AND draft_json=?', JSON.stringify(after), row.id, row.draft_version, row.draft_json),
      stmt(env, 'INSERT INTO beam_erasure_guard SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END'))
  }
  statements.push(stmt(env, `INSERT INTO beam_erasure_guard SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM beam_courses WHERE ${contains('draft_json')}) THEN 1 ELSE 0 END`, state.subjects), ...await preparedCheckpoint(env), stmt(env, 'DELETE FROM beam_erasure_guard'))
  const receipt = state.view.courses.map(course => ({ course: course.id, draftVersion: course.draftVersion, lessons: course.lessons.map(lesson => lesson.id) }))
  await commit(env, statements, { actor, action: 'erasure.source-drafts.withdraw', subject: preview.subject, detail: { courses: receipt } })
  return { kind: 'source', subject: preview.subject, withdrawn: receipt.reduce((count, course) => count + course.lessons.length, 0), courses: receipt }
}
