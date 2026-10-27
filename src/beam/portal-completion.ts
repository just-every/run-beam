// Qualification is bounded to native lessons and automatic assessments.
import type { Bindings } from '../auth.server'
import { all, insist, one } from './core'
import { portalUnsupportedBlocks } from './portal-media'
import { portalAdmission } from './portal-admission'
import { tryComplete } from './learning'
import { Input } from './input'
import { certificatePdf } from './pdf'

export interface PortalLearner { portal: string; identity: string; account: string }
// This predicate is also used by recordCompletion's atomic insert. Unsupported requirements cannot disappear.
export const portalQualification = `SELECT e.* FROM (${portalAdmission}) e
 JOIN beam_course_revisions revision ON revision.id=e.revision_id
 WHERE revision.attendance_percent IS NULL
 AND EXISTS(SELECT 1 FROM beam_lesson_revisions l WHERE l.course_revision_id=e.revision_id)
 AND NOT EXISTS(SELECT 1 FROM beam_lesson_revisions l WHERE l.course_revision_id=e.revision_id AND
   (${portalUnsupportedBlocks} OR NOT EXISTS(SELECT 1 FROM beam_portal_lesson_progress p WHERE p.enrollment_id=e.id AND p.lesson_revision_id=l.id)))
 AND NOT EXISTS(SELECT 1 FROM beam_revision_packages WHERE course_revision_id=e.revision_id)
 AND NOT EXISTS(SELECT 1 FROM beam_revision_xapi WHERE course_revision_id=e.revision_id)
 AND NOT EXISTS(SELECT 1 FROM beam_revision_sequences WHERE course_revision_id=e.revision_id)
 AND NOT EXISTS(SELECT 1 FROM beam_lti_resources WHERE course_id=revision.course_id)
 AND NOT EXISTS(SELECT 1 FROM beam_assessment_revisions a WHERE a.course_revision_id=e.revision_id AND
   (a.practical_instructions IS NOT NULL
   OR EXISTS(SELECT 1 FROM json_each(a.questions_json) q WHERE json_extract(q.value,'$.kind')='text')
   OR (json_array_length(a.questions_json)>0 AND NOT EXISTS(SELECT 1 FROM beam_portal_attempts t WHERE t.enrollment_id=e.id AND t.assessment_revision_id=a.id AND t.passed=1))))`

export async function portalCompletionCandidate(env: Bindings, actor: PortalLearner, enrollment: string) {
  const args = [actor.portal, enrollment, actor.identity, actor.account]
  if (!await one(env, portalQualification, ...args)) return null
  const revision = await one(env, `SELECT r.* FROM beam_course_revisions r JOIN beam_portal_enrollments e ON e.revision_id=r.id WHERE e.id=?`, enrollment)
  const assessment = await one(env, 'SELECT id FROM beam_assessment_revisions WHERE course_revision_id=?', revision!.id)
  const attempt = assessment ? await one(env, 'SELECT id FROM beam_portal_attempts WHERE enrollment_id=? AND assessment_revision_id=? AND passed=1 ORDER BY number LIMIT 1', enrollment, assessment.id) : null
  const lessons = await all(env, 'SELECT lesson_revision_id AS lesson,completed_at AS completedAt FROM beam_portal_lesson_progress WHERE enrollment_id=? ORDER BY lesson_revision_id', enrollment)
  return { portalEnrollment: enrollment, revision: revision!.id, assessmentRevision: assessment?.id ?? null, attempt: attempt?.id ?? null,
    method: assessment ? 'assessed' : 'lessons', evidence: { lessons, quizAttempt: attempt?.id ?? null } }
}
export type PortalCompletionCandidate = NonNullable<Awaited<ReturnType<typeof portalCompletionCandidate>>>

export async function portalCompletion(env: Bindings, request: Request, actor: PortalLearner, pdf: boolean) {
  insist(!pdf || request.method !== 'POST', 'method_not_allowed', 405)
  const input = request.method === 'POST' ? await Input.from(request) : null
  const enrollment = input ? input.text('enrollment') : new URL(request.url).searchParams.get('enrollment')
  insist(enrollment, 'missing_enrollment')
  insist(await one(env, portalAdmission, actor.portal, enrollment, actor.identity, actor.account), 'portal_enrollment_not_found', 404)
  if (input) {
    const earned = await tryComplete(env, actor, enrollment)
    insist(earned, 'portal_requirements_incomplete', 409)
  }
  insist(await one(env, portalAdmission, actor.portal, enrollment, actor.identity, actor.account), 'portal_enrollment_not_found', 404)
  const earned = await one(env, `SELECT id,revision_id AS revision,assessment_revision_id AS assessmentRevision,attempt_id AS attempt,
    method,evidence_json AS evidence,completed_at AS completedAt,certificate_number AS number,issuer,learner_name AS learner,
    course_title AS title,revision_number AS revisionNumber,accent FROM beam_portal_completions WHERE enrollment_id=?`, enrollment)
  if (pdf) {
    insist(earned, 'portal_certificate_not_found', 404)
    const bytes = certificatePdf('Certificate of completion', [
      { text: 'Certificate of completion', size: 26, bold: true, tag: 'H1' },
      { text: earned.learner, size: 20, tag: 'H2', gapBefore: 20 },
      { text: earned.title, size: 18, tag: 'P' },
      { text: `Revision ${earned.revisionNumber} (${earned.revision})`, size: 11, tag: 'P' },
      { text: `Issued by ${earned.issuer}`, size: 14, tag: 'P', gapBefore: 14 },
      { text: `Earned ${new Date(earned.completedAt).toISOString()}`, size: 11, tag: 'P' },
      { text: `Certificate ${earned.number}`, size: 10, tag: 'P' },
    ], earned.accent)
    return new Response(request.method === 'HEAD' ? null : bytes, { headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="beam-portal-certificate.pdf"', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' } })
  }
  const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' }
  if (request.method === 'HEAD') return new Response(null, { headers })
  return Response.json({ portal: actor.portal, enrollment, qualified: !!earned || !!await portalCompletionCandidate(env, actor, enrollment), completion: earned ? { ...earned, evidence: JSON.parse(earned.evidence) } : null }, { headers })
}
