import { editedLocaleText } from './course-locale-text'
// AUTHOR-008 foundation: genuine externally prepared translations, with explicit human owner language review.
import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { languagePreference, supportedLanguage } from './language'
import { requireCourseRole } from './units'
import { localeBaseDraft, validateCourseLocale } from './course-locale-validation'

function humanOwner(actor: Actor) { requireOwner(actor); insist(!actor.agent && !actor.viewAs, 'human_language_reviewer_required', 403) }
const localeInput = (input: Input) => { const locale = supportedLanguage(input.text('locale')); insist(locale, 'unsupported_language'); return locale }
async function translation(env: Bindings, actor: Actor, id: string) {
  const row = await one(env, 'SELECT * FROM beam_course_locales WHERE id=?', id)
  insist(row, 'locale_not_found', 404)
  await requireCourseRole(env, actor, row.course_id, 'author')
  return row
}
async function currentBase(env: Bindings, course: string, base: string) {
  insist(await one(env, `SELECT 1 FROM beam_courses c JOIN beam_course_revisions r ON r.id=c.published_revision_id
    WHERE c.id=? AND r.id=? AND c.retired_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM beam_course_locales l WHERE l.revision_id=r.id)`, course, base), 'locale_base_changed', 409)
  insist(!await one(env, `SELECT 1 FROM beam_lesson_revisions l,json_each(l.source_version_ids) cite
    JOIN beam_source_versions original ON original.id=cite.value
    WHERE l.course_revision_id=? AND EXISTS(SELECT 1 FROM beam_source_versions newer WHERE newer.source_id=original.source_id AND newer.number>original.number) LIMIT 1`, base), 'locale_sources_changed', 409)
}
export async function saveLocaleGlossary(env: Bindings, actor: Actor, input: Input) {
  const course = input.text('course'); await requireCourseRole(env, actor, course, 'author')
  const locale = localeInput(input), terms = input.json('terms') as { source: string; target: string }[]
  insist(Array.isArray(terms) && terms.length > 0 && terms.length <= 100 && terms.every(t => t && typeof t.source === 'string' && t.source.trim() && t.source.length <= 200 && typeof t.target === 'string' && t.target.trim() && t.target.length <= 200), 'invalid_glossary')
  const clean = terms.map(t => ({ source: t.source.trim(), target: t.target.trim() }))
  insist(new Set(clean.map(t => t.source.toLowerCase())).size === clean.length, 'duplicate_glossary_term')
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_locale_glossaries VALUES(?,?,?,?,?,?,NULL,NULL)', id, course, locale, JSON.stringify(clean), actor.id, now())], { actor, action: 'glossary.save', subject: id, detail: { course, locale, terms: clean } })
  return { id }
}
export async function approveLocaleGlossary(env: Bindings, actor: Actor, input: Input) {
  humanOwner(actor)
  const id = input.text('glossary'), row = await one(env, 'SELECT * FROM beam_locale_glossaries WHERE id=?', id)
  insist(row && !row.approved_at, 'glossary_not_waiting', 409)
  insist(input.flag('confirm'), 'language_review_required', 409)
  await commit(env, [stmt(env, 'UPDATE beam_locale_glossaries SET approved_by=?,approved_at=? WHERE id=? AND approved_at IS NULL', actor.id, now(), id)], { actor, action: 'glossary.approve', subject: id, detail: { course: row.course_id, locale: row.locale } })
  return { id, approved: true }
}
export async function prepareCourseLocale(env: Bindings, actor: Actor, input: Input) {
  const course = input.text('course'), base = input.text('baseRevision'), locale = localeInput(input)
  await requireCourseRole(env, actor, course, 'author'); await currentBase(env, course, base)
  const original = supportedLanguage((await one(env, 'SELECT language FROM beam_courses WHERE id=?', course))?.language)
  insist(locale !== original, 'locale_matches_original')
  const glossary = input.text('glossary')
  insist(await one(env, 'SELECT 1 FROM beam_locale_glossaries WHERE id=? AND course_id=? AND locale=? AND approved_at IS NOT NULL', glossary, course, locale), 'approved_glossary_required', 409)
  const draft = await validateCourseLocale(env, course, await localeBaseDraft(env, base), input.json('draft')), id = newId()
  await commit(env, [stmt(env, "INSERT INTO beam_course_locales(id,course_id,base_revision_id,locale,glossary_id,draft_json,state,prepared_by,prepared_at) VALUES(?,?,?,?,?,?,'draft',?,?)", id, course, base, locale, glossary, JSON.stringify(draft), actor.id, now())], { actor, action: 'locale.prepare', subject: id, detail: { course, baseRevision: base, locale, glossary, preparation: 'externally_prepared' } })
  return { id, version: 1, draft }
}
export async function editCourseLocale(env: Bindings, actor: Actor, input: Input) {
  const row = await translation(env, actor, input.text('translation')), version = input.integer('version')!
  insist(['draft', 'in_review'].includes(row.state) && row.version === version, 'locale_not_editable', 409)
  await currentBase(env, row.course_id, row.base_revision_id)
  const draft = await validateCourseLocale(env, row.course_id, await localeBaseDraft(env, row.base_revision_id), input.has('draft') ? input.json('draft') : editedLocaleText(JSON.parse(row.draft_json), input))
  await commit(env, [stmt(env, "UPDATE beam_course_locales SET draft_json=?,version=version+1,state='draft',submitted_by=NULL,submitted_at=NULL WHERE id=? AND version=? AND state IN ('draft','in_review')", JSON.stringify(draft), row.id, version)], { actor, action: 'locale.edit', subject: row.id, detail: { version } })
  const saved = await one(env, 'SELECT version,draft_json FROM beam_course_locales WHERE id=?', row.id)
  insist(saved?.version === version + 1 && saved.draft_json === JSON.stringify(draft), 'locale_changed', 409)
  return { id: row.id, version: version + 1, draft }
}
export async function submitCourseLocale(env: Bindings, actor: Actor, input: Input) {
  const row = await translation(env, actor, input.text('translation')), version = input.integer('version')!
  insist(row.state === 'draft' && row.version === version, 'locale_not_editable', 409)
  await currentBase(env, row.course_id, row.base_revision_id)
  const at = now()
  await commit(env, [stmt(env, "UPDATE beam_course_locales SET state='in_review',submitted_by=?,submitted_at=? WHERE id=? AND version=? AND state='draft'", actor.id, at, row.id, version)], { actor, action: 'locale.submit', subject: row.id, detail: { version } })
  const submitted = await one(env, 'SELECT version,state,submitted_by,submitted_at FROM beam_course_locales WHERE id=?', row.id)
  insist(submitted?.version === version && submitted.state === 'in_review' && submitted.submitted_by === actor.id && submitted.submitted_at === at, 'locale_changed', 409)
  return { id: row.id, state: 'in_review' }
}

export async function approveCourseLocale(env: Bindings, actor: Actor, input: Input) {
  humanOwner(actor)
  const row = await translation(env, actor, input.text('translation')), version = input.integer('version')!
  insist(row.state === 'in_review' && row.version === version, 'locale_not_waiting', 409)
  insist(input.flag('glossaryReviewed') && input.flag('correctnessReviewed'), 'language_review_required', 409)
  await currentBase(env, row.course_id, row.base_revision_id)
  const draft = await validateCourseLocale(env, row.course_id, await localeBaseDraft(env, row.base_revision_id), JSON.parse(row.draft_json))
  const revision = newId(), assessment = newId(), at = now(), latest = await one(env, 'SELECT MAX(number) AS number FROM beam_course_revisions WHERE course_id=?', row.course_id)
  const number = (latest?.number ?? 0) + 1
  const lessonIds = new Map(draft.lessons.map(lesson => [lesson.id, newId()]))
  // Insert the revision first for its FK; an optimistic locale UPDATE then owns all child writes.
  await commit(env, [
    stmt(env, `INSERT INTO beam_course_revisions(id,course_id,number,title,summary,draft_version,state,submitted_by,submitted_at,reviewed_by,reviewed_at,attendance_percent,survey_json)
      SELECT ?,?,?,?, ?,?,'published',?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM beam_course_locales l JOIN beam_courses c ON c.id=l.course_id WHERE l.id=? AND l.state='in_review' AND l.version=? AND c.published_revision_id=l.base_revision_id AND c.retired_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM beam_lesson_revisions baseLesson,json_each(baseLesson.source_version_ids) cite JOIN beam_source_versions original ON original.id=cite.value
          WHERE baseLesson.course_revision_id=l.base_revision_id AND EXISTS(SELECT 1 FROM beam_source_versions newer WHERE newer.source_id=original.source_id AND newer.number>original.number)))`, revision, row.course_id, number, draft.title, draft.summary, version, row.submitted_by, row.submitted_at, actor.id, at, draft.attendancePercent ?? null, JSON.stringify(draft.survey ?? []), row.id, version),
    stmt(env, "UPDATE beam_course_locales SET state='approved',approved_by=?,approved_at=?,revision_id=? WHERE id=? AND state='in_review' AND version=? AND EXISTS(SELECT 1 FROM beam_course_revisions WHERE id=?)", actor.id, at, revision, row.id, version, revision),
    ...(draft.sequence ? [stmt(env, 'INSERT INTO beam_revision_sequences SELECT ?,? WHERE EXISTS(SELECT 1 FROM beam_course_locales WHERE id=? AND revision_id=?)', revision, JSON.stringify({ ...draft.sequence, days: draft.sequence.days.map(day => ({ ...day, lesson: lessonIds.get(day.lesson) })) }), row.id, revision)] : []),
    ...draft.lessons.map((lesson, position) => stmt(env, 'INSERT INTO beam_lesson_revisions(id,course_revision_id,position,title,body,source_version_ids,blocks_json) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM beam_course_locales WHERE id=? AND revision_id=?)', lessonIds.get(lesson.id), revision, position, lesson.title, lesson.body, JSON.stringify(lesson.sources), JSON.stringify(lesson.blocks ?? []), row.id, revision)),
    ...(draft.questions.length || draft.practical ? [stmt(env, `INSERT INTO beam_assessment_revisions(id,course_revision_id,questions_json,pass_percent,max_attempts,time_limit_minutes,practical_instructions,assessor_id,draw_count,shuffle,feedback)
      SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM beam_course_locales WHERE id=? AND revision_id=?)`, assessment, revision, JSON.stringify(draft.questions), draft.passPercent, draft.maxAttempts, draft.timeLimitMinutes ?? null, draft.practical?.instructions ?? null, draft.practical?.assessor ?? draft.assessor ?? null, draft.drawCount ?? null, draft.shuffle ? 1 : 0, draft.feedback ?? 'attempt', row.id, revision)] : []),
  ], { actor, action: 'locale.approve', subject: row.id, detail: { version, revision, baseRevision: row.base_revision_id, glossary: row.glossary_id, language: row.locale } })
  insist((await one(env, 'SELECT revision_id FROM beam_course_locales WHERE id=?', row.id))?.revision_id === revision, 'locale_changed', 409)
  return { id: row.id, revision, number, state: 'approved' }
}

export async function localizedRevision(env: Bindings, baseRevision: string, member: string): Promise<string> {
  const { language } = await languagePreference(env, member)
  const selected = await one(env, `SELECT l.revision_id FROM beam_course_locales l JOIN beam_course_revisions r ON r.id=l.revision_id
    WHERE l.base_revision_id=? AND l.locale=? AND l.state='approved' AND NOT EXISTS(SELECT 1 FROM beam_locale_maintenance m WHERE m.locale_id=l.id)
      AND NOT EXISTS(SELECT 1 FROM beam_lesson_revisions baseLesson,json_each(baseLesson.source_version_ids) cite
        JOIN beam_source_versions original ON original.id=cite.value WHERE baseLesson.course_revision_id=l.base_revision_id
          AND EXISTS(SELECT 1 FROM beam_source_versions newer WHERE newer.source_id=original.source_id AND newer.number>original.number))
    ORDER BY l.approved_at DESC,l.id DESC LIMIT 1`, baseRevision, language)
  return selected?.revision_id ?? baseRevision
}
export async function localeRevisionLanguage(env: Bindings, revision: string) {
  const row = await one(env, `SELECT l.locale,c.language FROM beam_course_revisions r JOIN beam_courses c ON c.id=r.course_id LEFT JOIN beam_course_locales l ON l.revision_id=r.id WHERE r.id=?`, revision)
  return row?.locale ?? row?.language ?? 'en'
}
export async function localeView(env: Bindings, actor: Actor, course: string) {
  await requireCourseRole(env, actor, course, 'author')
  const head = (await one(env, 'SELECT published_revision_id FROM beam_courses WHERE id=?', course))?.published_revision_id
  return {
    baseRevision: head ?? null, template: head ? await localeBaseDraft(env, head) : null,
    glossaries: (await all(env, 'SELECT * FROM beam_locale_glossaries WHERE course_id=? ORDER BY created_at DESC,id', course)).map(row => ({ ...row, terms: JSON.parse(row.terms_json), terms_json: undefined } as Row)),
    translations: (await all(env, 'SELECT * FROM beam_course_locales WHERE course_id=? ORDER BY prepared_at DESC,id', course)).map(row => ({ ...row, draft: JSON.parse(row.draft_json), draft_json: undefined } as Row)),
    maintenance: await all(env, 'SELECT m.*,l.locale,l.revision_id FROM beam_locale_maintenance m JOIN beam_course_locales l ON l.id=m.locale_id WHERE l.course_id=? ORDER BY m.created_at DESC', course),
    ownerReviews: actor.owner && !actor.agent,
  }
}
export async function markLocaleSourceChange(env: Bindings, event: { source?: string; newVersion?: string; course?: string; baseRevision?: string }) {
  insist(Boolean(event.source && event.newVersion) !== Boolean(event.course && event.baseRevision), 'invalid_locale_change')
  const candidates = event.source ? await all(env, `SELECT DISTINCT l.id,l.base_revision_id FROM beam_course_locales l JOIN beam_lesson_revisions lesson ON lesson.course_revision_id=l.base_revision_id JOIN json_each(lesson.source_version_ids) cite JOIN beam_source_versions v ON v.id=cite.value WHERE v.source_id=? AND v.id<>?`, event.source, event.newVersion) : await all(env, 'SELECT id,base_revision_id FROM beam_course_locales WHERE course_id=? AND base_revision_id<>?', event.course!, event.baseRevision!)
  const cause = event.source ? 'source_changed' : 'base_changed', key = `${cause}:${event.newVersion ?? event.baseRevision}`
  if (candidates.length) await env.DB.batch(candidates.map(row => stmt(env, 'INSERT OR IGNORE INTO beam_locale_maintenance VALUES(?,?,?,?,?,?,?,?)', newId(), row.id, cause, event.source ?? null, event.newVersion ?? null, event.baseRevision ?? row.base_revision_id, key, now())))
  return { flagged: candidates.length }
}
