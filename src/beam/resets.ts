// LEARN-019: reset one learner's open assignment with a reason. Lesson progress
// starts again from the first lesson, an unfinished attempt is closed as reset
// and the attempt allowance starts again; every earlier lesson record, attempt,
// response and decision stays in the assignment's history, marked with the
// reset. A completed assignment is never reset: its completion stays bound to
// its revision and the manager creates a new assignment instead.
import type { Bindings } from '../auth.server'
import { requireRole, type Actor } from './actor'
import { all, commit, insist, newId, now, one, stmt } from './core'
import type { Input } from './input'

/** The owner resets anyone; a manager only people who share one of their teams. */
export async function withinTeam(env: Bindings, actor: Actor, learner: string) {
  if (actor.owner) return true
  return !!await one(env, 'SELECT 1 FROM beam_team_members mine JOIN beam_team_members theirs ON theirs.team_id = mine.team_id WHERE mine.member_id = ? AND theirs.member_id = ?', actor.id, learner)
}

export async function resetAssignment(env: Bindings, actor: Actor, input: Input) {
  requireRole(actor, 'manager')
  const assignment = await one(env, 'SELECT id, learner_id, course_id, status, extra_attempts FROM beam_assignments WHERE id = ?', input.text('assignment'))
  insist(assignment, 'assignment_not_found', 404)
  insist(await withinTeam(env, actor, assignment.learner_id), 'learner_outside_your_team', 403)
  insist(assignment.status !== 'completed', 'completed_assignment_not_reset', 409, { createAssignment: { course: assignment.course_id, learners: [assignment.learner_id] } })
  insist(assignment.status === 'open', 'assignment_closed', 409)
  const reason = input.text('reason', { max: 500 })
  const id = newId(), at = now()
  const result = await env.DB.batch([
    stmt(env, "INSERT INTO beam_assignment_resets (id, assignment_id, reset_by, reason, reset_at, extra_attempts) SELECT ?, id, ?, ?, ?, extra_attempts FROM beam_assignments WHERE id = ? AND status = 'open'", id, actor.id, reason, at, assignment.id),
    stmt(env, 'INSERT INTO beam_lesson_progress_history (reset_id, assignment_id, lesson_revision_id, completed_at) SELECT ?, assignment_id, lesson_revision_id, completed_at FROM beam_lesson_progress WHERE assignment_id = ? AND EXISTS (SELECT 1 FROM beam_assignment_resets WHERE id = ?)', id, assignment.id, id),
    stmt(env, 'DELETE FROM beam_lesson_progress WHERE assignment_id = ? AND EXISTS (SELECT 1 FROM beam_assignment_resets WHERE id = ?)', assignment.id, id),
    stmt(env, 'UPDATE beam_attempts SET reset_id = ? WHERE assignment_id = ? AND reset_id IS NULL AND EXISTS (SELECT 1 FROM beam_assignment_resets WHERE id = ?)', id, assignment.id, id),
    stmt(env, "UPDATE beam_assignments SET last_lesson_id = NULL, extra_attempts = 0 WHERE id = ? AND status = 'open' AND EXISTS (SELECT 1 FROM beam_assignment_resets WHERE id = ?)", assignment.id, id),
    stmt(env, "UPDATE beam_quiz_sessions SET closed_at = ?, close_reason = 'reset' WHERE assignment_id = ? AND closed_at IS NULL AND EXISTS (SELECT 1 FROM beam_assignment_resets WHERE id = ?)", at, assignment.id, id),
    stmt(env, 'INSERT INTO beam_audit (at, actor, action, subject, detail) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM beam_assignment_resets WHERE id = ?)', at, actor.id, 'assignment.reset', assignment.id, JSON.stringify({ reset: id, reason, learner: assignment.learner_id, previousExtraAttempts: assignment.extra_attempts }), id),
  ])
  insist(result[0].meta.changes === 1, 'assignment_closed', 409)
  return { id: assignment.id, reset: id }
}

/** Resets of one assignment, oldest first, with the lesson records each moved to history. */
export async function resetHistory(env: Bindings, assignmentId: string) {
  const resets = await all<{ id: string; resetBy: string; resetByName: string; reason: string; resetAt: number; extraAttempts: number }>(env, 'SELECT r.id, r.reset_by AS resetBy, m.name AS resetByName, r.reason, r.reset_at AS resetAt, r.extra_attempts AS extraAttempts FROM beam_assignment_resets r JOIN beam_members m ON m.id = r.reset_by WHERE r.assignment_id = ? ORDER BY r.reset_at, r.rowid', assignmentId)
  const lessons = await all(env, 'SELECT reset_id AS reset, lesson_revision_id AS lesson, completed_at AS completedAt FROM beam_lesson_progress_history WHERE assignment_id = ? ORDER BY completed_at', assignmentId)
  return resets.map(reset => ({ ...reset, lessons: lessons.filter(row => row.reset === reset.id).map(({ lesson, completedAt }) => ({ lesson, completedAt })) }))
}
