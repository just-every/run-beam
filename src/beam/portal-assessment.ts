// External quiz attempts never acquire employee membership or create completion evidence.
import type { Bindings } from '../auth.server'
import { all, insist, newId, now, one, stmt } from './core'
import { Input } from './input'
import { portalReviewSupported } from './portal-quiz-review'
import { portalTimedQuiz } from './portal-timing'
import { portalAdmission } from './portal-admission'
import { drawQuestions, presentQuestion, SCORING_RULE, type Question } from './question-types'
import { score, selectionsFrom, tally } from './timing'

export async function portalAssessment(env: Bindings, request: Request, portal: string, identity: string, account: string, download: boolean) {
  insist(!download || request.method !== 'POST', 'method_not_allowed', 405)
  const input = request.method === 'POST' ? await Input.from(request) : null
  const enrollment = input ? input.text('enrollment') : new URL(request.url).searchParams.get('enrollment')
  insist(enrollment, 'missing_enrollment')
  const args = [portal, enrollment, identity, account]
  const enrolled = await one(env, portalAdmission, ...args)
  insist(enrolled, 'portal_enrollment_not_found', 404)
  const assessment = await one(env, 'SELECT * FROM beam_assessment_revisions WHERE course_revision_id=?', enrolled.revision_id)
  const bank: Question[] = assessment ? JSON.parse(assessment.questions_json) : []
  const available = !!assessment && bank.length > 0 && (!bank.some(question => question.kind === 'text') || await portalReviewSupported(env, assessment.assessor_id))
  const lessons = await all(env, `SELECT l.id,p.completed_at FROM beam_lesson_revisions l
    LEFT JOIN beam_portal_lesson_progress p ON p.lesson_revision_id=l.id AND p.enrollment_id=? WHERE l.course_revision_id=?`, enrollment, enrolled.revision_id)
  const lessonsComplete = lessons.length > 0 && lessons.every(lesson => lesson.completed_at !== null)
  const attempts = () => all(env, `SELECT id,assessment_revision_id AS assessmentRevision,number,submitted_at AS submittedAt,
    score,max_score AS maxScore,percent,passed,state,scoring_rule AS scoringRule${download ? ',responses_json AS responses' : ''}
    ,(SELECT json_object('startedAt',started_at,'deadline',deadline,'closedAt',closed_at,'closeReason',close_reason)
      FROM beam_portal_quiz_sessions WHERE attempt_id=beam_portal_attempts.id) AS timing
    FROM beam_portal_attempts WHERE enrollment_id=? ORDER BY number`, enrollment)
  let recorded = await attempts()
  const draw = (number: number) => drawQuestions(bank, { draw: assessment!.draw_count, shuffle: assessment!.shuffle === 1 }, `${enrollment}:${number}`)
  if (input) insist(available, 'portal_assessment_unavailable', 409)
  const session = available && assessment!.time_limit_minutes ? await portalTimedQuiz({ env, args, assessment: assessment!, revision: enrolled.revision_id, account, draw }, input, lessonsComplete) : null
  if (available && assessment!.time_limit_minutes) recorded = await attempts()
  if (input && !assessment?.time_limit_minutes) {
    insist(available, 'portal_assessment_unavailable', 409)
    insist(lessonsComplete, 'lessons_incomplete', 409)
    const number = input.integer('number', { min: 1, max: 20 })!
    // A submitted number is an idempotent receipt; retrying a response cannot consume another attempt.
    if (!recorded.some(attempt => attempt.number === number)) {
      insist(!recorded.some(attempt => attempt.state === 'awaiting_review'), 'portal_review_pending', 409)
      insist(number === recorded.length + 1, 'portal_attempt_changed', 409)
      insist(!recorded.some(attempt => attempt.passed === 1), 'quiz_already_passed', 409)
      insist(number <= assessment!.max_attempts, 'no_attempts_remaining', 409)
      const asked = draw(number), responses = score(asked, selectionsFrom(asked, input))
      const result = tally(responses, assessment!.pass_percent), id = newId(), at = now()
      await env.DB.batch([
        stmt(env, `INSERT INTO beam_portal_attempts(id,enrollment_id,assessment_revision_id,number,submitted_at,score,max_score,percent,passed,scoring_rule,responses_json,state)
          SELECT ?5,e.id,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15 FROM (${portalAdmission}) e
          WHERE (SELECT COUNT(*) FROM beam_portal_attempts WHERE enrollment_id=e.id)=?7-1
          AND NOT EXISTS(SELECT 1 FROM beam_portal_attempts WHERE enrollment_id=e.id AND (passed=1 OR state='awaiting_review'))
          AND NOT EXISTS(SELECT 1 FROM beam_lesson_revisions l WHERE l.course_revision_id=e.revision_id
            AND NOT EXISTS(SELECT 1 FROM beam_portal_lesson_progress p WHERE p.enrollment_id=e.id AND p.lesson_revision_id=l.id))
          ON CONFLICT(enrollment_id,number) DO NOTHING`, ...args, id, assessment!.id, number, at, result.points, result.max, result.percent, result.passed ? 1 : 0, SCORING_RULE, JSON.stringify(responses), result.pending ? 'awaiting_review' : 'scored'),
        stmt(env, `INSERT INTO beam_audit(at,actor,action,subject,detail) SELECT ?,?,'portal.quiz.submit',?,? WHERE changes()=1`,
          at, account, portal, JSON.stringify({ identity, enrollment, revision: enrolled.revision_id, assessmentRevision: assessment!.id, number, attempt: id, outcome: result.pending ? 'awaiting_review' : result.passed ? 'passed' : 'failed' })),
      ])
      insist(await one(env, portalAdmission, ...args), 'portal_enrollment_not_found', 404)
      recorded = await attempts()
      insist(recorded.some(attempt => attempt.number === number), 'portal_attempt_changed', 409)
    }
  }
  const passed = recorded.some(attempt => attempt.passed === 1)
  const pending = recorded.some(attempt => attempt.state === 'awaiting_review')
  const nextNumber = recorded.length + 1, attemptsLeft = available ? Math.max(0, assessment!.max_attempts - recorded.length) : 0
  const timing = assessment?.feedback ?? 'attempt'
  const feedbackShown = timing === 'attempt' || timing === 'final' && (passed || attemptsLeft === 0)
  const receiptResponses = (value: string) => (JSON.parse(value) as ReturnType<typeof score>).map(response => feedbackShown ? response : { question: response.question, selected: response.selected, weight: response.weight })
  const data = { pending, feedback: feedbackShown ? 'shown' : 'withheld', portal, enrollment, revision: enrolled.revision_id, assessmentRevision: assessment?.id ?? null,
    available, lessonsComplete, session, timeLimitMinutes: assessment?.time_limit_minutes ?? null, passPercent: assessment?.pass_percent ?? null, nextNumber, attemptsLeft, passed,
    attempts: recorded.map(attempt => ({ ...attempt, timing: attempt.timing ? JSON.parse(attempt.timing) : null, ...download ? { responses: receiptResponses(attempt.responses) } : {} })),
    questions: !download && available && lessonsComplete && !passed && !pending && attemptsLeft > 0 && (!assessment!.time_limit_minutes || session) ? draw(session?.number ?? nextNumber).map(presentQuestion) : [],
    completion: await one(env, 'SELECT id,revision_id AS revision,assessment_revision_id AS assessmentRevision,completed_at AS completedAt,certificate_number AS number FROM beam_portal_completions WHERE enrollment_id=?', enrollment), scope: 'Automatically scored quizzes, with server-enforced timed sessions when required. Passing is distinct from earned course completion.' }
  const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
    ...download ? { 'content-disposition': 'attachment; filename="beam-portal-assessment.json"', 'content-security-policy': "sandbox; default-src 'none'" } : {} }
  return request.method === 'HEAD' ? new Response(null, { headers }) : Response.json(data, { headers })
}
