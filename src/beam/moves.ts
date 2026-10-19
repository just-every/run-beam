// AUTHOR-010: carrying a published fix to learners in progress. When the named reviewer publishes a revision and moves the
// course's open assignments to it, each earlier assignment ends as replaced and a new one on the new revision records
// the move. A lesson whose title, text and cited source versions are unchanged keeps the learner's completion of it; a
// changed or added lesson is open again. An assessment whose questions and rules are unchanged carries every attempt
// over (a pass stays a pass, numbering and attempt limits continue, a practical waiting for its assessor stays waiting
// and its decision counts on the new assignment); a changed assessment voids the unfinished attempts (a practical
// waiting for a decision, an open timed quiz) under a move entry in the earlier assignment's reset history, kept with
// their evidence, and earlier attempts do not count. Attendance (LIVE-003) follows the assignment through moves.
// Completion binds the revision actually completed (BEAM-09). Finished learners are untouched; when the reviewer marks
// the change material by also reassigning them, they get a new assignment (assignments.ts).
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt, type Row } from './core'
import { insertAssignments } from './assignments'

/** Earlier assignments whose attempts count for this one: back through moves that kept the assessment unchanged. */
export const ATTEMPT_CHAIN = `WITH RECURSIVE chain(id) AS (SELECT ?1 UNION SELECT m.from_assignment FROM beam_assignment_moves m JOIN chain c ON m.assignment_id = c.id WHERE m.assessment = 'unchanged')`
/** Earlier assignments through every move, for attendance. */
export const MOVE_CHAIN = `WITH RECURSIVE chain(id) AS (SELECT ?1 UNION SELECT m.from_assignment FROM beam_assignment_moves m JOIN chain c ON m.assignment_id = c.id)`

/** The open assignment an attempt now counts for, following moves that kept the assessment unchanged. */
export async function countingAssignment(env: Bindings, assignment: string) {
  const row = await one<{ id: string }>(env, `WITH RECURSIVE ahead(id) AS (SELECT ?1 UNION SELECT m.assignment_id FROM beam_assignment_moves m JOIN ahead a ON m.from_assignment = a.id WHERE m.assessment = 'unchanged')
    SELECT x.id FROM beam_assignments x WHERE x.id IN (SELECT id FROM ahead) AND x.status = 'open'`, assignment)
  return row?.id ?? null
}

const lessonKey = (lesson: Row) => JSON.stringify([lesson.title, lesson.body, JSON.parse(lesson.source_version_ids)])
const ASSESSMENT = 'SELECT questions_json, pass_percent, max_attempts, time_limit_minutes, practical_instructions, assessor_id FROM beam_assessment_revisions WHERE course_revision_id = ?'

/** What moving from one revision to another keeps: lessons matched by identical content, and the assessment's fate. */
async function compare(env: Bindings, from: string, to: string) {
  const [before, after, oldAssessment, newAssessment] = await Promise.all([
    all(env, 'SELECT id, title, body, source_version_ids FROM beam_lesson_revisions WHERE course_revision_id = ? ORDER BY position', from),
    all(env, 'SELECT id, title, body, source_version_ids FROM beam_lesson_revisions WHERE course_revision_id = ? ORDER BY position', to),
    one(env, ASSESSMENT, from), one(env, ASSESSMENT, to),
  ])
  const unused = [...before]
  const lessons = after.map(lesson => {
    const index = unused.findIndex(old => lessonKey(old) === lessonKey(lesson))
    const match = index >= 0 ? unused.splice(index, 1)[0] : null
    return { id: lesson.id, title: lesson.title, from: match?.id ?? null }
  })
  const assessment = !oldAssessment && !newAssessment ? 'none' : JSON.stringify(oldAssessment) === JSON.stringify(newAssessment) ? 'unchanged' : 'changed'
  return { lessons, assessment }
}

async function openElsewhere(env: Bindings, course: string, revision: string) {
  return await all(env, "SELECT a.*, m.name AS learner_name, r.number AS revision_number FROM beam_assignments a JOIN beam_members m ON m.id = a.learner_id JOIN beam_course_revisions r ON r.id = a.course_revision_id WHERE a.course_id = ? AND a.status = 'open' AND a.course_revision_id != ? ORDER BY m.name", course, revision)
}

/** One open assignment's move: which lessons it keeps or reopens, and which attempts carry over or are voided. */
async function plan(env: Bindings, assignment: Row, compared: Awaited<ReturnType<typeof compare>>) {
  const done = new Set((await all(env, 'SELECT lesson_revision_id FROM beam_lesson_progress WHERE assignment_id = ?', assignment.id)).map(row => row.lesson_revision_id as string))
  const kept = compared.lessons.filter(lesson => lesson.from && done.has(lesson.from))
  const reopened = compared.lessons.filter(lesson => !(lesson.from && done.has(lesson.from)))
  const attempts = await all(env, `${ATTEMPT_CHAIN} SELECT id, kind, state FROM beam_attempts WHERE assignment_id IN (SELECT id FROM chain) AND reset_id IS NULL`, assignment.id)
  const voided = compared.assessment === 'changed' ? attempts.filter(attempt => attempt.state === 'awaiting_review') : []
  return { kept, reopened, carried: compared.assessment === 'unchanged' ? attempts : [], voided }
}

/** The reviewer's preview before publishing: who moves and what each keeps, and who has finished an earlier revision. */
export async function movePreview(env: Bindings, actor: Actor, revisionId: string) {
  const revision = await one(env, 'SELECT r.id, r.course_id, c.reviewer_id FROM beam_course_revisions r JOIN beam_courses c ON c.id = r.course_id WHERE r.id = ?', revisionId)
  insist(revision, 'revision_not_found', 404)
  insist(actor.owner || revision.reviewer_id === actor.id, 'named_reviewer_required', 403)
  const cache = new Map<string, Awaited<ReturnType<typeof compare>>>()
  const moves = []
  for (const assignment of await openElsewhere(env, revision.course_id, revision.id)) {
    if (!cache.has(assignment.course_revision_id)) cache.set(assignment.course_revision_id, await compare(env, assignment.course_revision_id, revision.id))
    const compared = cache.get(assignment.course_revision_id)!, planned = await plan(env, assignment, compared)
    moves.push({ assignment: assignment.id, learner: assignment.learner_id, learnerName: assignment.learner_name, fromRevision: assignment.revision_number, kept: planned.kept.map(lesson => lesson.title), reopened: planned.reopened.map(lesson => lesson.title), assessment: compared.assessment, attemptsCarried: planned.carried.length, attemptsVoided: planned.voided.length })
  }
  const finished = await all(env, `SELECT DISTINCT m.id AS learner, m.name AS learnerName FROM beam_completions c JOIN beam_members m ON m.id = c.learner_id WHERE c.course_id = ? AND c.course_revision_id != ?
    AND c.learner_id NOT IN (SELECT learner_id FROM beam_assignments WHERE course_id = ? AND status = 'open') ORDER BY m.name`, revision.course_id, revision.id, revision.course_id)
  return { moves, finished }
}

/** Moves every open assignment of the course on another revision to this one. */
export async function moveOpenAssignments(env: Bindings, actor: Actor, course: string, revision: string) {
  const number = (await one<{ number: number }>(env, 'SELECT number FROM beam_course_revisions WHERE id = ?', revision))!.number
  const cache = new Map<string, Awaited<ReturnType<typeof compare>>>()
  let moved = 0
  for (const old of await openElsewhere(env, course, revision)) {
    if (!cache.has(old.course_revision_id)) cache.set(old.course_revision_id, await compare(env, old.course_revision_id, revision))
    const compared = cache.get(old.course_revision_id)!, planned = await plan(env, old, compared)
    await commit(env, [stmt(env, "UPDATE beam_assignments SET status = 'replaced' WHERE id = ? AND status = 'open'", old.id)], { actor, action: 'assignment.replace', subject: course, detail: { revision, replaced: [old.id] } })
    await insertAssignments(env, actor, [{ learner: old.learner_id, course, dueDate: old.due_date, dueTime: old.due_time, timezone: old.timezone, reason: 'revision', pathRevision: old.path_revision_id, prerequisite: old.prerequisite_course_id, renewalDays: old.renewal_days, access: { opensAt: old.access_opens_at, closesAt: old.access_closes_at, rule: old.access_rule } }], 'assignment.revision')
    const fresh = await one(env, "SELECT id FROM beam_assignments WHERE learner_id = ? AND course_id = ? AND status = 'open'", old.learner_id, course)
    if (!fresh) continue
    const at = now(), progress = new Map((await all(env, 'SELECT lesson_revision_id, completed_at FROM beam_lesson_progress WHERE assignment_id = ?', old.id)).map(row => [row.lesson_revision_id as string, row.completed_at as number]))
    const reset = planned.voided.length || compared.assessment === 'changed' ? newId() : null
    await commit(env, [
      stmt(env, 'INSERT INTO beam_assignment_moves (id, assignment_id, from_assignment, from_revision, to_revision, assessment, carried_lessons, reopened_lessons, voided_attempts, moved_by, moved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', newId(), fresh.id, old.id, old.course_revision_id, revision, compared.assessment,
        JSON.stringify(planned.kept.map(lesson => lesson.id)), JSON.stringify(planned.reopened.map(lesson => lesson.id)), JSON.stringify(planned.voided.map(attempt => attempt.id)), actor.id, at),
      ...planned.kept.map(lesson => stmt(env, 'INSERT OR IGNORE INTO beam_lesson_progress (assignment_id, lesson_revision_id, completed_at) VALUES (?, ?, ?)', fresh.id, lesson.id, progress.get(lesson.from!))),
      ...(reset ? [
        stmt(env, "INSERT INTO beam_assignment_resets (id, assignment_id, reset_by, reason, reset_at, extra_attempts, kind) VALUES (?, ?, ?, ?, ?, 0, 'move')", reset, old.id, actor.id, `Moved to revision ${number}; the assessment changed`, at),
        stmt(env, "UPDATE beam_attempts SET reset_id = ? WHERE assignment_id = ? AND reset_id IS NULL AND state = 'awaiting_review'", reset, old.id),
        stmt(env, "UPDATE beam_quiz_sessions SET closed_at = ?, close_reason = 'reset' WHERE assignment_id = ? AND closed_at IS NULL", at, old.id),
      ] : []),
    ], { actor, action: 'assignment.move', subject: fresh.id, detail: { from: old.id, fromRevision: old.course_revision_id, toRevision: revision, kept: planned.kept.length, reopened: planned.reopened.length, assessment: compared.assessment, carried: planned.carried.length, voided: planned.voided.map(attempt => attempt.id) } })
    moved++
  }
  return moved
}

/** The moves that brought an assignment to its revision, newest last, for its page. */
export async function movesOf(env: Bindings, assignment: string) {
  const rows = await all(env, `${MOVE_CHAIN} SELECT m.assignment_id AS assignment, f.number AS fromRevision, t.number AS toRevision, m.assessment, m.carried_lessons AS kept, m.reopened_lessons AS reopened, m.voided_attempts AS voided, b.name AS movedByName, m.moved_at AS movedAt
    FROM beam_assignment_moves m JOIN beam_course_revisions f ON f.id = m.from_revision JOIN beam_course_revisions t ON t.id = m.to_revision JOIN beam_members b ON b.id = m.moved_by WHERE m.assignment_id IN (SELECT id FROM chain) ORDER BY m.moved_at`, assignment)
  return rows.map(row => ({ ...row, kept: JSON.parse(row.kept), reopened: JSON.parse(row.reopened), voided: JSON.parse(row.voided) }) as Row)
}
