// Flow 3: editable courses with one version-checked draft; submission freezes
// an immutable revision that only the course's named reviewer can publish.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { reassignAfterPublish } from './assignments'
import { BeamError, all, auditVia, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { newCourseUnit, requireCourseRole } from './units'
import { courseAccess } from './course-access'

export interface Lesson { id: string; title: string; body: string; sources: string[] }
import { normaliseQuestion, questionFromInput, type Question } from './question-types'
export type { Question } from './question-types'
export interface Draft {
  title: string
  summary: string
  lessons: Lesson[]
  questions: Question[]
  passPercent: number | null
  maxAttempts: number | null
  /** LEARN-018: an optional limit in minutes on the quiz; older drafts have none. */
  timeLimitMinutes?: number | null
  practical: { instructions: string; assessor: string } | null
}

export const emptyDraft = (title: string, summary: string): Draft => ({ title, summary, lessons: [], questions: [], passPercent: null, maxAttempts: null, timeLimitMinutes: null, practical: null })

export async function createCourse(env: Bindings, actor: Actor, input: Input) {
  const unit = await newCourseUnit(env, actor, input)
  const title = input.text('title', { max: 160 })
  const summary = input.text('summary', { max: 1000, optional: true })
  const reviewer = input.text('reviewer')
  insist(await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', reviewer), 'reviewer_not_found', 404)
  const id = newId()
  await commit(env, [stmt(env, 'INSERT INTO beam_courses (id, title, reviewer_id, created_by, created_at, draft_json, draft_version, unit_id) VALUES (?, ?, ?, ?, ?, ?, 1, ?)', id, title, reviewer, actor.id, now(), JSON.stringify(emptyDraft(title, summary)), unit)], { actor, action: 'course.create', subject: id, detail: { title, reviewer } })
  return { id, draftVersion: 1 }
}

export async function loadCourse(env: Bindings, id: string) {
  const course = await one(env, 'SELECT * FROM beam_courses WHERE id = ?', id)
  insist(course, 'course_not_found', 404)
  return { ...course, draft: JSON.parse(course.draft_json) as Draft } as Row & { draft: Draft }
}

/** Validates a complete draft, as edited in the UI or proposed through the API. */
export async function normaliseDraft(env: Bindings, value: unknown): Promise<Draft> {
  insist(value && typeof value === 'object', 'invalid_draft')
  const draft = value as Draft
  insist(typeof draft.title === 'string' && draft.title.trim().length > 0 && draft.title.length <= 160, 'invalid_draft_title')
  insist(typeof draft.summary === 'string' && draft.summary.length <= 1000, 'invalid_draft_summary')
  insist(Array.isArray(draft.lessons) && draft.lessons.length <= 60 && Array.isArray(draft.questions) && draft.questions.length <= 60, 'invalid_draft_shape')
  const lessons: Lesson[] = []
  for (const lesson of draft.lessons) {
    insist(lesson && typeof lesson.title === 'string' && lesson.title.trim() && lesson.title.length <= 160 && typeof lesson.body === 'string' && lesson.body.length <= 50_000 && Array.isArray(lesson.sources), 'invalid_lesson')
    for (const version of lesson.sources) insist(typeof version === 'string' && await one(env, 'SELECT 1 FROM beam_source_versions WHERE id = ?', version), 'source_version_not_found', 404)
    lessons.push({ id: typeof lesson.id === 'string' && lesson.id ? lesson.id : newId(), title: lesson.title.trim(), body: lesson.body, sources: [...new Set(lesson.sources)] })
  }
  const questions: Question[] = []
  for (const question of draft.questions) questions.push(normaliseQuestion(question))
  const passPercent = draft.passPercent === null || draft.passPercent === undefined ? null : draft.passPercent
  const maxAttempts = draft.maxAttempts === null || draft.maxAttempts === undefined ? null : draft.maxAttempts
  insist(passPercent === null || (Number.isInteger(passPercent) && passPercent >= 1 && passPercent <= 100), 'invalid_pass_percent')
  insist(maxAttempts === null || (Number.isInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 20), 'invalid_max_attempts')
  const timeLimitMinutes = draft.timeLimitMinutes === null || draft.timeLimitMinutes === undefined ? null : draft.timeLimitMinutes
  insist(timeLimitMinutes === null || (Number.isInteger(timeLimitMinutes) && timeLimitMinutes >= 1 && timeLimitMinutes <= 600), 'invalid_time_limit_minutes')
  let practical: Draft['practical'] = null
  if (draft.practical) {
    insist(typeof draft.practical.instructions === 'string' && draft.practical.instructions.trim() && draft.practical.instructions.length <= 5000 && typeof draft.practical.assessor === 'string', 'invalid_practical')
    insist(await one(env, 'SELECT 1 FROM beam_members WHERE id = ?', draft.practical.assessor), 'assessor_not_found', 404)
    practical = { instructions: draft.practical.instructions.trim(), assessor: draft.practical.assessor }
  }
  return { title: draft.title.trim(), summary: draft.summary.trim(), lessons, questions, passPercent, maxAttempts, timeLimitMinutes, practical }
}

export async function editDraft(env: Bindings, actor: Actor, input: Input, action: string, change: (draft: Draft) => void | Promise<void>, detail: Record<string, unknown> = {}) {
  await requireCourseRole(env, actor, input.text('course'), 'author')
  const course = await loadCourse(env, input.text('course'))
  const expected = input.integer('draftVersion', { min: 1, max: 1_000_000 })
  insist(expected === course.draft_version, 'stale_draft', 409, { draftVersion: course.draft_version })
  await change(course.draft)
  const draft = await normaliseDraft(env, course.draft)
  const result = await env.DB.batch([
    stmt(env, 'UPDATE beam_courses SET draft_json = ?, draft_version = draft_version + 1, title = ? WHERE id = ? AND draft_version = ?', JSON.stringify(draft), draft.title, course.id, expected),
    stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail, via) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1', now(), actor.id, action, course.id, JSON.stringify({ from: expected, ...detail }), auditVia(actor)),
  ])
  insist(result[0].meta.changes === 1, 'stale_draft', 409)
  return { id: course.id, draftVersion: expected! + 1, draft }
}

export const saveDetails = (env: Bindings, actor: Actor, input: Input) => editDraft(env, actor, input, 'course.details', draft => {
  draft.title = input.text('title', { max: 160 })
  draft.summary = input.text('summary', { max: 1000, optional: true })
})

export const saveLesson = (env: Bindings, actor: Actor, input: Input) => editDraft(env, actor, input, 'course.lesson', draft => {
  const lesson: Lesson = { id: input.text('lesson', { optional: true }) || newId(), title: input.text('title', { max: 160 }), body: input.text('body', { max: 50_000 }), sources: input.list('sources') }
  const index = draft.lessons.findIndex(existing => existing.id === lesson.id)
  if (index >= 0) draft.lessons[index] = lesson
  else {
    insist(!input.has('lesson'), 'lesson_not_found', 404)
    draft.lessons.push(lesson)
  }
})

export const removeLesson = (env: Bindings, actor: Actor, input: Input) => editDraft(env, actor, input, 'course.lesson.remove', draft => {
  const id = input.text('lesson')
  insist(draft.lessons.some(lesson => lesson.id === id), 'lesson_not_found', 404)
  draft.lessons = draft.lessons.filter(lesson => lesson.id !== id)
})

export const moveLesson = (env: Bindings, actor: Actor, input: Input) => editDraft(env, actor, input, 'course.lesson.move', draft => {
  const index = draft.lessons.findIndex(lesson => lesson.id === input.text('lesson'))
  insist(index >= 0, 'lesson_not_found', 404)
  const target = input.text('direction') === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= draft.lessons.length) return
  ;[draft.lessons[index], draft.lessons[target]] = [draft.lessons[target], draft.lessons[index]]
})

export const saveQuestion = (env: Bindings, actor: Actor, input: Input) => editDraft(env, actor, input, 'course.question', draft => {
  const question = questionFromInput(input)
  const index = draft.questions.findIndex(existing => existing.id === question.id)
  if (index >= 0) draft.questions[index] = question
  else {
    insist(!input.has('question'), 'question_not_found', 404)
    draft.questions.push(question)
  }
})

export const removeQuestion = (env: Bindings, actor: Actor, input: Input) => editDraft(env, actor, input, 'course.question.remove', draft => {
  const id = input.text('question')
  insist(draft.questions.some(question => question.id === id), 'question_not_found', 404)
  draft.questions = draft.questions.filter(question => question.id !== id)
})

export const saveAssessment = (env: Bindings, actor: Actor, input: Input) => editDraft(env, actor, input, 'course.assessment', draft => {
  draft.passPercent = input.integer('passPercent', { min: 1, max: 100, optional: true })
  draft.maxAttempts = input.integer('maxAttempts', { min: 1, max: 20, optional: true })
  draft.timeLimitMinutes = input.integer('timeLimitMinutes', { min: 1, max: 600, optional: true })
  const instructions = input.text('practicalInstructions', { max: 5000, optional: true })
  draft.practical = instructions ? { instructions, assessor: input.text('assessor') } : null
})

export async function submitForReview(env: Bindings, actor: Actor, input: Input) {
  await requireCourseRole(env, actor, input.text('course'), 'author')
  const course = await loadCourse(env, input.text('course'))
  insist(input.integer('draftVersion', { min: 1, max: 1_000_000 }) === course.draft_version, 'stale_draft', 409, { draftVersion: course.draft_version })
  const draft = await normaliseDraft(env, course.draft)
  insist(draft.lessons.length > 0, 'lessons_required')
  insist(draft.questions.length === 0 || (draft.passPercent !== null && draft.maxAttempts !== null), 'quiz_rules_required')
  insist(!await one(env, "SELECT 1 FROM beam_course_revisions WHERE course_id = ? AND state = 'in_review'", course.id), 'revision_in_review', 409)
  const latest = await one<{ number: number }>(env, 'SELECT MAX(number) AS number FROM beam_course_revisions WHERE course_id = ?', course.id)
  const id = newId(), number = (latest?.number ?? 0) + 1
  const assessed = draft.questions.length > 0 || draft.practical
  await commit(env, [
    stmt(env, "INSERT INTO beam_course_revisions (id, course_id, number, title, summary, draft_version, state, submitted_by, submitted_at) VALUES (?, ?, ?, ?, ?, ?, 'in_review', ?, ?)", id, course.id, number, draft.title, draft.summary, course.draft_version, actor.id, now()),
    ...draft.lessons.map((lesson, position) => stmt(env, 'INSERT INTO beam_lesson_revisions (id, course_revision_id, position, title, body, source_version_ids) VALUES (?, ?, ?, ?, ?, ?)', newId(), id, position, lesson.title, lesson.body, JSON.stringify(lesson.sources))),
    ...(assessed ? [stmt(env, 'INSERT INTO beam_assessment_revisions (id, course_revision_id, questions_json, pass_percent, max_attempts, time_limit_minutes, practical_instructions, assessor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', newId(), id, JSON.stringify(draft.questions), draft.passPercent, draft.maxAttempts, draft.questions.length ? draft.timeLimitMinutes ?? null : null, draft.practical?.instructions ?? null, draft.practical?.assessor ?? null)] : []),
  ], { actor, action: 'revision.submit', subject: id, detail: { course: course.id, number, draftVersion: course.draft_version } })
  return { id, number }
}

export async function decideRevision(env: Bindings, actor: Actor, input: Input) {
  const revision = await one(env, 'SELECT r.*, c.reviewer_id, c.published_revision_id, c.unit_id, c.self_review FROM beam_course_revisions r JOIN beam_courses c ON c.id = r.course_id WHERE r.id = ?', input.text('revision'))
  insist(revision, 'revision_not_found', 404)
  // ORG-003: the named reviewer holds the reviewer role, or, where the owner allows self-review, administers the
  // course's unit. Deciding one's own submission needs that allowance (the owner's own is always allowed), and is recorded.
  const named = revision.reviewer_id === actor.id && (actor.roles.has('reviewer') || (revision.self_review === 1 && actor.adminUnits.includes(revision.unit_id)))
  insist(actor.owner || named, 'named_reviewer_required', 403)
  const self = revision.submitted_by === actor.id ? 1 : 0
  insist(!self || actor.owner || revision.self_review === 1, 'self_review_not_allowed', 403)
  insist(revision.state === 'in_review', 'revision_not_in_review', 409)
  const decision = input.text('decision')
  const note = input.text('note', { max: 2000, optional: true })
  if (decision === 'return') {
    insist(note, 'note_required')
    await commit(env, [stmt(env, "UPDATE beam_course_revisions SET state = 'returned', reviewed_by = ?, reviewed_at = ?, review_note = ?, self_reviewed = ? WHERE id = ? AND state = 'in_review'", actor.id, now(), note, self, revision.id)], { actor, action: 'revision.return', subject: revision.id, detail: { note } })
    return { id: revision.id, state: 'returned' }
  }
  insist(decision === 'publish', 'invalid_decision')
  const reassignment = input.text('reassignment', { optional: true }) || 'none'
  insist(['none', 'open', 'everyone'].includes(reassignment), 'invalid_reassignment')
  const dueDays = input.integer('dueDays', { min: 1, max: 365, optional: true }) ?? 14
  await commit(env, [
    stmt(env, "UPDATE beam_course_revisions SET state = 'superseded' WHERE course_id = ? AND state = 'published'", revision.course_id),
    stmt(env, "UPDATE beam_course_revisions SET state = 'published', reviewed_by = ?, reviewed_at = ?, review_note = ?, reassignment = ?, self_reviewed = ? WHERE id = ? AND state = 'in_review'", actor.id, now(), note || null, reassignment, self, revision.id),
    stmt(env, 'UPDATE beam_courses SET published_revision_id = ? WHERE id = ?', revision.id, revision.course_id),
  ], { actor, action: 'revision.publish', subject: revision.id, detail: { reassignment, previous: revision.published_revision_id, selfReviewed: self === 1 } })
  const reassigned = revision.published_revision_id ? await reassignAfterPublish(env, actor, revision.course_id, revision.id, reassignment, dueDays) : 0
  return { id: revision.id, state: 'published', reassigned }
}

/** Every course, or only those in the given units (a learning administrator's catalog, ORG-002) and the given
 * courses (a course's own author, ORG-003). */
/** AUTHOR-005: a course's catalog details, outside its reviewed revisions. */
export const catalogOf = (row: Row) => ({ folder: row.folder ?? null, tags: JSON.parse(row.tags ?? '[]') as string[], objectives: JSON.parse(row.objectives ?? '[]') as string[], language: row.language ?? 'en', durationMinutes: row.duration_minutes ?? null, owner: row.owner_id ?? null, template: row.is_template === 1, archivedAt: row.archived_at ?? null })

export async function listCourses(env: Bindings, within: { units: string[]; courses?: string[] } | null = null) {
  const units = within && JSON.stringify(within.units), courses = within && JSON.stringify(within.courses ?? [])
  return (await all(env, `SELECT c.id, c.title, c.unit_id AS unit, c.reviewer_id AS reviewer, c.draft_version AS draftVersion, c.published_revision_id AS publishedRevision, c.retired_at AS retiredAt, c.cloned_from AS clonedFrom, c.archived_at AS archivedAt, c.folder, c.tags, c.objectives, c.language, c.duration_minutes AS durationMinutes, c.owner_id AS owner, c.is_template AS template,
    (SELECT number FROM beam_course_revisions WHERE id = c.published_revision_id) AS publishedNumber,
    (SELECT COUNT(*) FROM beam_course_revisions WHERE course_id = c.id AND state = 'in_review') AS inReview
    FROM beam_courses c WHERE (? IS NULL OR c.unit_id IN (SELECT value FROM json_each(?)) OR c.id IN (SELECT value FROM json_each(?))) ORDER BY c.title`, units, units, courses)).map(row => ({ ...row, tags: JSON.parse(row.tags), objectives: JSON.parse(row.objectives), template: row.template === 1 }) as Row)
}

export async function revisionDetail(env: Bindings, id: string) {
  const revision = await one(env, 'SELECT * FROM beam_course_revisions WHERE id = ?', id)
  if (!revision) throw new BeamError('revision_not_found', 404)
  const lessons = (await all(env, 'SELECT id, position, title, body, source_version_ids FROM beam_lesson_revisions WHERE course_revision_id = ? ORDER BY position', id)).map(lesson => ({ id: lesson.id, position: lesson.position, title: lesson.title, body: lesson.body, sources: JSON.parse(lesson.source_version_ids) as string[] }))
  const assessment = await one(env, 'SELECT * FROM beam_assessment_revisions WHERE course_revision_id = ?', id)
  return { revision, lessons, assessment: assessment ? { ...assessment, questions: JSON.parse(assessment.questions_json) as Question[] } as Row & { questions: Question[] } : null }
}

export async function courseDetail(env: Bindings, actor: Actor, id: string) {
  await requireCourseRole(env, actor, id, 'author', 'reviewer', 'manager')
  const course = await loadCourse(env, id)
  const revisions = await all(env, 'SELECT id, number, title, state, submitted_by AS submittedBy, submitted_at AS submittedAt, reviewed_by AS reviewedBy, reviewed_at AS reviewedAt, review_note AS reviewNote, reassignment, self_reviewed AS selfReviewed FROM beam_course_revisions WHERE course_id = ? ORDER BY number DESC', id)
  const notices = await all(env, 'SELECT n.*, s.title AS source_title, pv.number AS previous_number, nv.number AS new_number FROM beam_source_notices n JOIN beam_sources s ON s.id = n.source_id JOIN beam_source_versions pv ON pv.id = n.previous_version_id JOIN beam_source_versions nv ON nv.id = n.new_version_id WHERE n.course_id = ? ORDER BY n.created_at DESC', id)
  const proposals = await all(env, 'SELECT id, base_draft_version AS baseDraftVersion, input_version_ids AS inputs, prepared_by AS preparedBy, agent, summary, draft_json AS draft, passages_json AS passages, missing_json AS missing, state, decided_by AS decidedBy, created_at AS createdAt FROM beam_proposals WHERE course_id = ? ORDER BY created_at DESC', id)
  return { id: course.id, title: course.title, unit: course.unit_id ?? null, retired: course.retired_at ? { at: course.retired_at, by: course.retired_by, reason: course.retire_reason } : null, clonedFrom: course.cloned_from ?? null, catalog: catalogOf(course), selfReview: course.self_review === 1, ...await courseAccess(env, id), reviewer: course.reviewer_id, draftVersion: course.draft_version, draft: course.draft, publishedRevision: course.published_revision_id, revisions, notices, proposals: proposals.map(proposal => ({ ...proposal, inputs: JSON.parse(proposal.inputs), draft: JSON.parse(proposal.draft), passages: JSON.parse(proposal.passages), missing: JSON.parse(proposal.missing) })) }
}
