// AUTHOR-003: learner feedback and broken-content reports. A learner sends one on a course they are assigned, optionally on
// one lesson of their revision; it carries only its words, never attempts, answers or scores. It reaches the course's
// responsible expert (its catalog owner, AUTHOR-005, else its named reviewer), the learning administrator of its unit
// and the owner's content queue, who see who sent it and close it with a note the learner reads. The course's other
// authors see the item without the learner's name, to act on the content.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { requireCourseRole } from './units'

const responsible = (actor: Actor, course: Row) => actor.owner || (course.owner_id ?? course.reviewer_id) === actor.id || (!!course.unit_id && actor.adminUnits.includes(course.unit_id))
const editor = (env: Bindings, actor: Actor, course: string) => requireCourseRole(env, actor, course, 'author').then(() => true, () => false)

export async function sendFeedback(env: Bindings, actor: Actor, input: Input) {
  const assignment = await one(env, 'SELECT id, course_id, course_revision_id FROM beam_assignments WHERE id = ? AND learner_id = ?', input.text('assignment'), actor.id)
  insist(assignment, 'assignment_not_found', 404)
  const lesson = input.text('lesson', { optional: true }) || null
  insist(lesson === null || await one(env, 'SELECT 1 FROM beam_lesson_revisions WHERE id = ? AND course_revision_id = ?', lesson, assignment.course_revision_id), 'lesson_not_found', 404)
  const kind = input.text('kind')
  insist(kind === 'feedback' || kind === 'broken', 'invalid_kind')
  const id = newId()
  await commit(env, [stmt(env, "INSERT INTO beam_content_feedback (id, course_id, course_revision_id, lesson_revision_id, learner_id, kind, body, created_at, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')", id, assignment.course_id, assignment.course_revision_id, lesson, actor.id, kind, input.text('body', { max: 2000 }), now())],
    { actor, action: 'content.feedback', subject: assignment.course_id, detail: { feedback: id, kind, lesson } })
  return { id }
}

export async function closeFeedback(env: Bindings, actor: Actor, input: Input) {
  const item = await one(env, "SELECT f.id, f.course_id, c.owner_id, c.reviewer_id, c.unit_id FROM beam_content_feedback f JOIN beam_courses c ON c.id = f.course_id WHERE f.id = ? AND f.state = 'open'", input.text('feedback'))
  insist(item, 'feedback_not_open', 409)
  insist(responsible(actor, item), 'forbidden', 403)
  const note = input.text('note', { max: 1000 })
  await commit(env, [stmt(env, "UPDATE beam_content_feedback SET state = 'closed', closed_by = ?, closed_at = ?, close_note = ? WHERE id = ? AND state = 'open'", actor.id, now(), note, item.id)],
    { actor, action: 'content.feedback.close', subject: item.course_id, detail: { feedback: item.id, note } })
  return { id: item.id }
}

/** The content queue: open feedback on the courses this person is responsible for (with who sent it) or edits (without). */
export async function contentQueue(env: Bindings, actor: Actor, course?: string) {
  const rows = await all(env, `SELECT f.id, f.course_id AS course, c.title AS courseTitle, r.number AS revisionNumber, l.title AS lessonTitle, f.kind, f.body, f.created_at AS createdAt, f.state, f.close_note AS closeNote, f.learner_id, m.name AS learnerName, c.owner_id, c.reviewer_id, c.unit_id
    FROM beam_content_feedback f JOIN beam_courses c ON c.id = f.course_id JOIN beam_course_revisions r ON r.id = f.course_revision_id LEFT JOIN beam_lesson_revisions l ON l.id = f.lesson_revision_id JOIN beam_members m ON m.id = f.learner_id
    WHERE f.state = 'open' AND (? IS NULL OR f.course_id = ?) ORDER BY f.created_at`, course ?? null, course ?? null)
  const shown = []
  for (const row of rows) {
    const named = responsible(actor, row)
    if (!named && !await editor(env, actor, row.course)) continue
    shown.push({ id: row.id, course: row.course, courseTitle: row.courseTitle, revisionNumber: row.revisionNumber, lessonTitle: row.lessonTitle, kind: row.kind, body: row.body, createdAt: row.createdAt, canClose: named, ...(named ? { learner: row.learner_id, learnerName: row.learnerName } : {}) })
  }
  return shown
}

/** A learner's own feedback on a course, with each outcome. */
export const myFeedback = (env: Bindings, actor: Actor, course: string) => all(env, 'SELECT f.id, f.kind, f.body, f.created_at AS createdAt, f.state, f.close_note AS closeNote, f.closed_at AS closedAt, l.title AS lessonTitle FROM beam_content_feedback f LEFT JOIN beam_lesson_revisions l ON l.id = f.lesson_revision_id WHERE f.learner_id = ? AND f.course_id = ? ORDER BY f.created_at', actor.id, course)
