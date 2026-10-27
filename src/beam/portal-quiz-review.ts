import type { Bindings } from '../auth.server'
import { all, insist, now, one, stmt } from './core'
import { Input } from './input'
import { portalAdmission } from './portal-admission'
import { tally, type Scored } from './timing'

// Interim review floor: both current human ownership and the immutable revision's named assessor.
// Employee roles and external administrator grants never imply access to private practice.
export async function portalReviewSupported(env: Bindings, assessor: string | null) {
  return !!assessor && !!await one(env, `SELECT 1 FROM beam_members m JOIN oa_operators o ON o.id=m.operator_id
    WHERE m.id=? AND o.role='owner' AND o.status='active' AND m.erasure_pending=0 AND m.erased_at IS NULL`, assessor)
}

export async function portalQuizReview(env: Bindings, request: Request, portal: string, account: string, owner: boolean) {
  insist(owner, 'portal_owner_required', 403)
  const input = request.method === 'POST' ? await Input.from(request) : null
  const enrollment = input ? input.text('enrollment') : new URL(request.url).searchParams.get('enrollment')
  const enrolled = await one(env, `SELECT e.*,i.operator_id FROM beam_portal_enrollments e
    JOIN beam_portal_identities i ON i.id=e.identity_id AND i.portal_id=e.portal_id WHERE e.id=? AND e.portal_id=?`, enrollment, portal)
  insist(enrolled, 'portal_enrollment_not_found', 404)
  const args = [portal, enrolled.id, enrolled.identity_id, enrolled.operator_id]
  insist(await one(env, portalAdmission, ...args), 'portal_enrollment_not_found', 404)
  const assessment = await one(env, 'SELECT * FROM beam_assessment_revisions WHERE course_revision_id=?', enrolled.revision_id)
  const assessor = await one(env, `SELECT m.id FROM beam_members m JOIN oa_operators o ON o.id=m.operator_id
    WHERE m.operator_id=? AND o.role='owner' AND o.status='active' AND m.erasure_pending=0 AND m.erased_at IS NULL`, account)
  insist(assessment && assessor && assessor.id === assessment.assessor_id, 'named_assessor_required', 403)
  insist(enrolled.operator_id !== account, 'self_assessment_refused', 403)
  if (input) {
    const attempt = await one(env, 'SELECT * FROM beam_portal_attempts WHERE id=? AND enrollment_id=? AND assessment_revision_id=?', input.text('attempt'), enrolled.id, assessment.id)
    insist(attempt, 'portal_attempt_not_found', 404)
    insist(attempt.state === 'awaiting_review', 'portal_attempt_decided', 409)
    const responses: Scored[] = JSON.parse(attempt.responses_json)
    const awards: Record<string, number> = {}
    for (const response of responses) if (response.points === null) {
      response.points = input.integer(`points_${response.question}`, { min: 0, max: response.weight })!
      response.correct = response.points === response.weight
      awards[response.question] = response.points
    }
    insist(Object.keys(awards).length > 0, 'portal_review_not_required', 409)
    const note = input.text('note', { max: 2000 }), at = now(), result = tally(responses, assessment.pass_percent)
    const updated = await env.DB.batch([
      stmt(env, `UPDATE beam_portal_attempts SET score=?5,max_score=?6,percent=?7,passed=?8,responses_json=?9,state='scored'
        WHERE id=?10 AND state='awaiting_review' AND EXISTS(${portalAdmission})
        AND EXISTS(SELECT 1 FROM beam_members m JOIN oa_operators o ON o.id=m.operator_id
          WHERE m.id=?11 AND m.operator_id=?12 AND o.role='owner' AND o.status='active' AND m.erasure_pending=0 AND m.erased_at IS NULL)`,
        ...args, result.points, result.max, result.percent, result.passed ? 1 : 0, JSON.stringify(responses), attempt.id, assessor.id, account),
      stmt(env, `INSERT INTO beam_portal_quiz_reviews SELECT ?,?,?,?,? WHERE changes()=1`, attempt.id, assessor.id, note, JSON.stringify(awards), at),
      stmt(env, `INSERT INTO beam_audit(at,actor,action,subject,detail) SELECT ?,?,'portal.quiz.grade',?,? WHERE changes()=1`,
        at, account, portal, JSON.stringify({ identity: enrolled.identity_id, enrollment: enrolled.id, revision: enrolled.revision_id, assessmentRevision: assessment.id, attempt: attempt.id, assessor: assessor.id, outcome: result.passed ? 'passed' : 'failed' })),
    ])
    insist(updated[0].meta.changes === 1, 'portal_attempt_decided', 409)
  }
  insist(await one(env, portalAdmission, ...args), 'portal_enrollment_not_found', 404)
  const bank = JSON.parse(assessment.questions_json) as { id: string; prompt: string; guidance?: string }[]
  const response = Response.json({ portal, enrollment: enrolled.id, revision: enrolled.revision_id, assessmentRevision: assessment.id,
    attempts: (await all(env, `SELECT a.id,a.number,a.state,a.percent,a.passed,a.responses_json,r.note,r.graded_at AS gradedAt
      FROM beam_portal_attempts a LEFT JOIN beam_portal_quiz_reviews r ON r.attempt_id=a.id WHERE a.enrollment_id=? ORDER BY a.number`, enrolled.id))
      .map(attempt => ({ id: attempt.id, number: attempt.number, state: attempt.state, percent: attempt.percent, passed: attempt.passed,
        note: attempt.note, gradedAt: attempt.gradedAt, responses: (JSON.parse(attempt.responses_json) as Scored[]).map(response => ({ ...response, prompt: bank.find(question => question.id === response.question)?.prompt, guidance: bank.find(question => question.id === response.question)?.guidance })) })) },
    { headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' } })
  insist(await portalReviewSupported(env, assessment.assessor_id) && await one(env, 'SELECT 1 FROM beam_members WHERE id=? AND operator_id=?', assessment.assessor_id, account), 'named_assessor_required', 403)
  return request.method === 'HEAD' ? new Response(null, response) : response
}
