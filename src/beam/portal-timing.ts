import type { Bindings } from '../auth.server'
import { insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { portalAdmission } from './portal-admission'
import { SCORING_RULE, type Question, type Answer } from './question-types'
import { score, selectionsFrom, tally } from './timing'

export interface PortalQuizContext { env: Bindings; args: string[]; assessment: Row; revision: string; account: string; draw: (number: number) => Question[] }
const openSession = (context: PortalQuizContext) => one(context.env, 'SELECT * FROM beam_portal_quiz_sessions WHERE enrollment_id=? AND closed_at IS NULL ORDER BY number DESC LIMIT 1', context.args[1])

async function finish(context: PortalQuizContext, session: Row, reason: 'submitted' | 'expired', at: number) {
  const { env, args, assessment, account, draw, revision } = context
  const answers = new Map<string, Answer>(Object.entries(JSON.parse(session.answers_json)))
  const responses = score(draw(session.number), answers), result = tally(responses, assessment.pass_percent), id = newId()
  const closedAt = reason === 'expired' ? session.deadline : at
  await env.DB.batch([
    stmt(env, `INSERT INTO beam_portal_attempts(id,enrollment_id,assessment_revision_id,number,submitted_at,score,max_score,percent,passed,scoring_rule,responses_json,state)
      SELECT ?5,e.id,?6,?7,?8,?9,?10,?11,?12,?13,?14,?19 FROM (${portalAdmission}) e
      WHERE EXISTS(SELECT 1 FROM beam_portal_quiz_sessions session WHERE session.id=?15 AND session.enrollment_id=e.id
        AND session.version=?16 AND session.closed_at IS NULL AND (CASE WHEN ?17='expired' THEN session.deadline<=?18 ELSE session.deadline>?18 END))
      AND (SELECT COUNT(*) FROM beam_portal_attempts WHERE enrollment_id=e.id)=?7-1
      AND NOT EXISTS(SELECT 1 FROM beam_portal_attempts WHERE enrollment_id=e.id AND (passed=1 OR state='awaiting_review'))
      ON CONFLICT(enrollment_id,number) DO NOTHING`, ...args, id, assessment.id, session.number, closedAt,
      result.points, result.max, result.percent, result.passed ? 1 : 0, SCORING_RULE, JSON.stringify(responses), session.id, session.version, reason, at, result.pending ? 'awaiting_review' : 'scored'),
    stmt(env, `UPDATE beam_portal_quiz_sessions SET closed_at=?,close_reason=?,attempt_id=? WHERE id=? AND closed_at IS NULL
      AND EXISTS(SELECT 1 FROM beam_portal_attempts WHERE id=?)`, closedAt, reason, id, session.id, id),
    stmt(env, `INSERT INTO beam_audit(at,actor,action,subject,detail) SELECT ?,?,'portal.quiz.submit',?,? WHERE changes()=1`,
      at, account, args[0], JSON.stringify({ identity: args[2], enrollment: args[1], revision, assessmentRevision: assessment.id, number: session.number, attempt: id, outcome: result.pending ? 'awaiting_review' : result.passed ? 'passed' : 'failed', closeReason: reason })),
  ])
  insist(await one(env, portalAdmission, ...args), 'portal_enrollment_not_found', 404)
  insist(await one(env, 'SELECT 1 FROM beam_portal_attempts WHERE enrollment_id=? AND number=?', args[1], session.number), 'portal_attempt_changed', 409)
}

/** A read after expiry closes from saved answers. New or late answers can never enter that score. */
export async function portalTimedQuiz(context: PortalQuizContext, input: Input | null, lessonsComplete: boolean) {
  const { env, args, assessment, draw, account, revision } = context
  let session = await openSession(context)
  const at = now(), expired = !!session && session.deadline <= at
  if (expired) { await finish(context, session!, 'expired', at); session = null }
  if (input) {
    insist(lessonsComplete, 'lessons_incomplete', 409)
    const operation = input.text('operation')
    insist(['start', 'save', 'submit'].includes(operation), 'invalid_timed_operation')
    const number = input.integer('number', { min: 1, max: 20 })!
    const recorded = await one(env, 'SELECT id FROM beam_portal_attempts WHERE enrollment_id=? AND number=?', args[1], number)
    if (recorded) {
      // Retrying an already closed submission reads its receipt; a late save is always refused.
      insist(operation === 'submit' && !expired, 'portal_quiz_closed', 409)
    } else if (operation === 'start') {
      const id = newId(), deadline = at + assessment.time_limit_minutes * 60_000
      await env.DB.batch([
        stmt(env, `INSERT INTO beam_portal_quiz_sessions(id,enrollment_id,assessment_revision_id,number,started_at,deadline)
          SELECT ?5,e.id,?6,?7,?8,?9 FROM (${portalAdmission}) e WHERE ?7<=?10
          AND (SELECT COUNT(*) FROM beam_portal_attempts WHERE enrollment_id=e.id)=?7-1
          AND NOT EXISTS(SELECT 1 FROM beam_portal_attempts WHERE enrollment_id=e.id AND (passed=1 OR state='awaiting_review'))
          AND NOT EXISTS(SELECT 1 FROM beam_portal_quiz_sessions WHERE enrollment_id=e.id AND closed_at IS NULL)
          AND NOT EXISTS(SELECT 1 FROM beam_lesson_revisions l WHERE l.course_revision_id=e.revision_id
            AND NOT EXISTS(SELECT 1 FROM beam_portal_lesson_progress p WHERE p.enrollment_id=e.id AND p.lesson_revision_id=l.id))
          ON CONFLICT(enrollment_id,number) DO NOTHING`, ...args, id, assessment.id, number, at, deadline, assessment.max_attempts),
        stmt(env, `INSERT INTO beam_audit(at,actor,action,subject,detail) SELECT ?,?,'portal.quiz.start',?,? WHERE changes()=1`,
          at, account, args[0], JSON.stringify({ identity: args[2], enrollment: args[1], revision, assessmentRevision: assessment.id, number, deadline, outcome: 'started' })),
      ])
      session = await openSession(context)
      insist(session?.number === number, 'portal_attempt_changed', 409)
    } else {
      insist(session?.number === number && session.deadline > at, 'portal_quiz_closed', 409)
      const version = input.integer('version', { min: 0 })!
      insist(version === session.version, 'portal_quiz_changed', 409)
      const answers = Object.fromEntries(selectionsFrom(draw(number), input))
      const result = await env.DB.batch([
        stmt(env, `UPDATE beam_portal_quiz_sessions SET answers_json=?,version=version+1 WHERE id=? AND version=? AND closed_at IS NULL
          AND deadline>? AND EXISTS(${portalAdmission.replaceAll('?1', '?5').replaceAll('?2', '?6').replaceAll('?3', '?7').replaceAll('?4', '?8')})`,
          JSON.stringify(answers), session.id, version, at, ...args),
      ])
      insist(result[0].meta.changes === 1, 'portal_quiz_changed', 409)
      session = await openSession(context)
      insist(session, 'portal_quiz_closed', 409)
      if (operation === 'submit') { await finish(context, session, 'submitted', at); session = null }
    }
    insist(await one(env, portalAdmission, ...args), 'portal_enrollment_not_found', 404)
  }
  return session ? { number: session.number, startedAt: session.started_at, deadline: session.deadline, version: session.version, answers: JSON.parse(session.answers_json) } : null
}
