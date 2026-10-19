// LEARN-001: a course revision's satisfaction survey. Answering is optional, once per assignment, after every lesson
// is done, and never counts toward passing, attempts or completion (tryComplete never reads it). An answer row keeps
// only its revision: who answered is kept apart, with no link to the answer, so nobody's answers can be singled out.
// Per-revision results are read only once at least MIN_ANSWERS answers exist, by the owner, the course's responsible
// expert (catalog owner, else named reviewer), its unit's learning administrator and its authors (the author role, or
// course-scoped authors, ORG-003); managers, assessors, auditors and custom roles read none (ct, 19 Oct 08:48Z).
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { BeamError, all, insist, newId, now, one, stmt } from './core'
import { revisionDetail, type SurveyQuestion } from './courses'
import type { Input } from './input'
import { MIN_ANSWERS } from './questions'

export async function surveyState(env: Bindings, assignment: string, questions: SurveyQuestion[]) {
  return { questions, answered: !!questions.length && !!await one(env, 'SELECT 1 FROM beam_survey_takers WHERE assignment_id = ?', assignment) }
}

export async function answerSurvey(env: Bindings, actor: Actor, input: Input) {
  const assignment = await one(env, 'SELECT id, course_revision_id FROM beam_assignments WHERE id = ? AND learner_id = ?', input.text('assignment'), actor.id)
  insist(assignment, 'assignment_not_found', 404)
  const { survey, lessons } = await revisionDetail(env, assignment.course_revision_id)
  insist(survey.length, 'no_survey', 409)
  const done = await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM beam_lesson_progress WHERE assignment_id = ?', assignment.id)
  insist((done?.n ?? 0) >= lessons.length, 'lessons_incomplete', 409)
  const answers = survey.map(item => {
    if (item.kind === 'text') return input.text(`s_${item.id}`, { max: 4000, optional: true }) || null
    return input.integer(`s_${item.id}`, { min: 1, max: 5, optional: true })
  })
  insist(answers.some(answer => answer !== null), 'answers_required')
  // The taker row and the answer commit together; the audit names the revision, never the person.
  const result = await env.DB.batch([
    stmt(env, 'INSERT OR IGNORE INTO beam_survey_takers (assignment_id) VALUES (?)', assignment.id),
    stmt(env, 'INSERT INTO beam_survey_answers (id, course_revision_id, answers_json) SELECT ?, ?, ? WHERE changes() = 1', newId(), assignment.course_revision_id, JSON.stringify(answers)),
    stmt(env, "INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, 'respondent', 'survey.answer', ?, '{}' WHERE changes() = 1", now(), assignment.course_revision_id),
  ])
  insist(result[0].meta.changes === 1, 'already_responded', 409)
  return { answered: true }
}

/** Per-question results of one revision's survey: rating counts and written answers in no particular order. */
export async function surveyResults(env: Bindings, actor: Actor, revisionId: string) {
  const { revision, survey } = await revisionDetail(env, revisionId)
  const course = await one(env, 'SELECT owner_id, reviewer_id, unit_id FROM beam_courses WHERE id = ?', revision.course_id)
  const reader = actor.owner || (course?.owner_id ?? course?.reviewer_id) === actor.id || (!!course?.unit_id && actor.adminUnits.includes(course.unit_id)) || actor.roles.has('author') || actor.authorOf.includes(revision.course_id)
  if (!reader || actor.viewAs) throw new BeamError('forbidden', 403)
  const rows = (await all<{ answers_json: string }>(env, 'SELECT answers_json FROM beam_survey_answers WHERE course_revision_id = ? ORDER BY id', revisionId)).map(row => JSON.parse(row.answers_json) as (string | number | null)[])
  const released = rows.length >= MIN_ANSWERS
  return {
    revision: revisionId, answers: rows.length, minimumAnswers: MIN_ANSWERS, hidden: released ? null : 'too_few_answers',
    questions: survey.map((item, index) => ({ ...item, ...(!released ? {} : item.kind === 'rating'
      ? { ratings: [1, 2, 3, 4, 5].map(value => rows.filter(row => row[index] === value).length) }
      : { texts: rows.map(row => row[index]).filter((value): value is string => typeof value === 'string') }) })),
  }
}
