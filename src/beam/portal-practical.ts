import type { Bindings } from '../auth.server'
import { all, insist, newId, now, one, stmt } from './core'
import { Input } from './input'
import { portalAdmission } from './portal-admission'
import { portalReviewSupported } from './portal-quiz-review'

export interface PortalPracticalContext { portal: string; identity?: string; account: string; owner: boolean }
export type PortalPracticalMode = 'practical' | 'practical-review'
export interface PortalPracticalSubmission {
  id: string; number: number; submittedAt: number; evidence: string
  state: 'awaiting_review' | 'accepted' | 'rejected'
  decision: { id: string; assessor: string; decision: 'accepted' | 'rejected'; note: string; decidedAt: number } | null
}
export interface PortalPracticalData {
  portal: string; enrollment: string; revision: string; assessmentRevision: string | null
  instructions: string | null; available: boolean; lessonsComplete: boolean
  accepted: boolean; pending: boolean; submission: string | null
  submissions: PortalPracticalSubmission[]; review: boolean; learner?: string
  attachments: false
}

// Embed inside portalQualification, whose enrollment and assessment aliases are e and a.
export const portalPracticalAccepted = `EXISTS(SELECT 1 FROM beam_portal_practical_submissions practical
 JOIN beam_portal_practical_decisions decision ON decision.submission_id=practical.id
 WHERE practical.enrollment_id=e.id AND practical.assessment_revision_id=a.id
 AND decision.assessor_id=a.assessor_id AND decision.decision='accepted')`

// Review does not impersonate the learner or borrow employee assignment authority.
// Current consent, sharing and revision admission remain required even for the named owner.
const reviewTarget = `SELECT e.*,a.id AS assessment_id,a.assessor_id,a.practical_instructions,
 i.operator_id AS learner_account,i.display_name AS learner_name
 FROM beam_portal_enrollments e
 JOIN beam_portal_identities i ON i.id=e.identity_id AND i.portal_id=e.portal_id
 JOIN beam_enterprise_portals p ON p.id=e.portal_id
 JOIN beam_portal_shares share ON share.portal_id=e.portal_id AND share.revision_id=e.revision_id
 JOIN beam_course_revisions r ON r.id=e.revision_id
 JOIN beam_courses c ON c.id=r.course_id
 JOIN beam_assessment_revisions a ON a.course_revision_id=e.revision_id
 WHERE e.portal_id=?1 AND e.id=?2 AND i.operator_id IS NOT NULL
 AND i.revoked_at IS NULL AND i.consent_at IS NOT NULL AND i.consent_version=p.notice_version
 AND share.revoked_at IS NULL AND r.state IN ('published','superseded')
 AND c.retired_at IS NULL AND c.archived_at IS NULL AND length(trim(a.practical_instructions))>0`

const currentOwnerMember = `SELECT m.id FROM beam_members m JOIN oa_operators o ON o.id=m.operator_id
 WHERE m.id=? AND m.operator_id=? AND o.role='owner' AND o.status='active'
 AND m.erasure_pending=0 AND m.erased_at IS NULL`

async function submissions(env: Bindings, enrollment: string): Promise<PortalPracticalSubmission[]> {
  const rows = await all(env, `SELECT s.id,s.number,s.submitted_at AS submittedAt,s.evidence_text AS evidence,
    d.id AS decisionId,d.assessor_id AS assessor,d.decision,d.note,d.decided_at AS decidedAt
    FROM beam_portal_practical_submissions s LEFT JOIN beam_portal_practical_decisions d ON d.submission_id=s.id
    WHERE s.enrollment_id=? ORDER BY s.number`, enrollment)
  return rows.map(row => ({ id: row.id, number: row.number, submittedAt: row.submittedAt, evidence: row.evidence,
    state: row.decision ?? 'awaiting_review', decision: row.decisionId ? { id: row.decisionId, assessor: row.assessor,
      decision: row.decision, note: row.note, decidedAt: row.decidedAt } : null }))
}

/** The portal dispatcher must supply a verified human session, including its current owner flag. */
export async function portalPractical(env: Bindings, request: Request, context: PortalPracticalContext, mode: PortalPracticalMode) {
  insist(['GET', 'HEAD', 'POST'].includes(request.method), 'method_not_allowed', 405)
  insist(!request.headers.has('authorization'), 'human_session_required', 403)
  insist(!/(?:^|;\s*)beam_view=/.test(request.headers.get('cookie') ?? ''), 'view_as_read_only', 403)
  if (request.method === 'POST') insist(request.headers.get('origin') === env.AUTH_ORIGIN, 'invalid_origin', 403)
  const review = mode === 'practical-review'
  if (review) insist(context.owner, 'human_owner_required', 403)
  else insist(context.identity, 'portal_identity_not_found', 404)
  const input = request.method === 'POST' ? await Input.from(request) : null
  const enrollment = input ? input.text('enrollment') : new URL(request.url).searchParams.get('enrollment')
  insist(enrollment, 'missing_enrollment')
  const args = [context.portal, enrollment, context.identity ?? '', context.account]
  const admit = () => one(env, portalAdmission, ...args)
  const reviewAdmit = () => one(env, reviewTarget, context.portal, enrollment)
  const enrolled = await (review ? reviewAdmit() : admit())
  insist(enrolled, 'portal_enrollment_not_found', 404)
  const assessment = await one(env, 'SELECT id,practical_instructions,assessor_id FROM beam_assessment_revisions WHERE course_revision_id=?', enrolled.revision_id)
  const assertReviewer = async () => {
    insist(assessment && await one(env, currentOwnerMember, assessment.assessor_id, context.account), 'named_assessor_required', 403)
    insist(enrolled.learner_account !== context.account, 'self_assessment_refused', 403)
  }
  if (review) await assertReviewer()
  const lessons = await all(env, `SELECT l.id,p.completed_at FROM beam_lesson_revisions l
    LEFT JOIN beam_portal_lesson_progress p ON p.lesson_revision_id=l.id AND p.enrollment_id=?
    WHERE l.course_revision_id=?`, enrollment, enrolled.revision_id)
  const lessonsComplete = lessons.length > 0 && lessons.every(lesson => lesson.completed_at !== null)
  const available = !!assessment?.practical_instructions?.trim() && await portalReviewSupported(env, assessment?.assessor_id ?? null)
  if (input && !review) {
    insist(available, 'portal_practical_unavailable', 409)
    const token = input.text('submission', { max: 36 }).toLowerCase()
    insist(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(token), 'invalid_submission')
    const evidence = input.text('evidence', { max: 10000 })
    insist(!input.has('file'), 'portal_practical_attachments_unavailable', 409)
    const prior = () => one(env, 'SELECT id,evidence_text FROM beam_portal_practical_submissions WHERE enrollment_id=? AND submission_token=?', enrollment, token)
    let receipt = await prior()
    if (!receipt) {
      insist(lessonsComplete, 'lessons_incomplete', 409)
      const id = newId(), at = now()
      await env.DB.batch([
        stmt(env, `INSERT INTO beam_portal_practical_submissions
          SELECT ?5,e.id,a.id,?6,(SELECT COALESCE(MAX(number),0)+1 FROM beam_portal_practical_submissions WHERE enrollment_id=e.id),?7,?8
          FROM (${portalAdmission}) e JOIN beam_assessment_revisions a ON a.course_revision_id=e.revision_id
          WHERE a.id=?9 AND length(trim(a.practical_instructions))>0 AND a.assessor_id IS NOT NULL
          AND EXISTS(SELECT 1 FROM beam_members m JOIN oa_operators o ON o.id=m.operator_id
            WHERE m.id=a.assessor_id AND o.role='owner' AND o.status='active' AND m.erasure_pending=0 AND m.erased_at IS NULL)
          AND EXISTS(SELECT 1 FROM beam_lesson_revisions l WHERE l.course_revision_id=e.revision_id)
          AND NOT EXISTS(SELECT 1 FROM beam_lesson_revisions l WHERE l.course_revision_id=e.revision_id
            AND NOT EXISTS(SELECT 1 FROM beam_portal_lesson_progress p WHERE p.enrollment_id=e.id AND p.lesson_revision_id=l.id))
          AND NOT EXISTS(SELECT 1 FROM beam_portal_practical_submissions s WHERE s.enrollment_id=e.id
            AND NOT EXISTS(SELECT 1 FROM beam_portal_practical_decisions d WHERE d.submission_id=s.id AND d.decision='rejected'))
          ON CONFLICT(enrollment_id,submission_token) DO NOTHING`, ...args, id, token, at, evidence, assessment!.id),
        stmt(env, `INSERT INTO beam_audit(at,actor,action,subject,detail) SELECT ?,?,'portal.practical.submit',?,? WHERE changes()=1`,
          at, context.account, context.portal, JSON.stringify({ identity: context.identity, enrollment, revision: enrolled.revision_id, assessmentRevision: assessment!.id, submission: id, outcome: 'awaiting_review' })),
      ])
      insist(await admit(), 'portal_enrollment_not_found', 404)
      receipt = await prior()
      insist(receipt, 'portal_practical_not_open', 409)
    }
    insist(receipt.evidence_text === evidence, 'submission_conflict', 409)
  }
  if (input && review) {
    const submission = input.text('submission'), decision = input.text('decision'), note = input.text('note', { max: 2000 })
    insist(decision === 'accepted' || decision === 'rejected', 'invalid_decision')
    insist(await one(env, 'SELECT 1 FROM beam_portal_practical_submissions WHERE id=? AND enrollment_id=? AND assessment_revision_id=?', submission, enrollment, assessment!.id), 'portal_practical_not_found', 404)
    const id = newId(), at = now()
    const result = await env.DB.batch([
      stmt(env, `INSERT INTO beam_portal_practical_decisions
        SELECT ?3,s.id,?4,?5,?6,?7 FROM beam_portal_practical_submissions s JOIN (${reviewTarget}) e ON e.id=s.enrollment_id
        WHERE s.id=?8 AND s.assessment_revision_id=e.assessment_id AND e.assessor_id=?4 AND e.learner_account<>?9
        AND EXISTS(SELECT 1 FROM beam_members m JOIN oa_operators o ON o.id=m.operator_id
          WHERE m.id=e.assessor_id AND m.operator_id=?9 AND o.role='owner' AND o.status='active' AND m.erasure_pending=0 AND m.erased_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM beam_portal_practical_decisions d WHERE d.submission_id=s.id)
        ON CONFLICT(submission_id) DO NOTHING`, context.portal, enrollment, id, assessment!.assessor_id, decision, note, at, submission, context.account),
      stmt(env, `INSERT INTO beam_audit(at,actor,action,subject,detail) SELECT ?,?,'portal.practical.decide',?,? WHERE changes()=1`,
        at, context.account, context.portal, JSON.stringify({ enrollment, revision: enrolled.revision_id, assessmentRevision: assessment!.id, submission, decision: id, assessor: assessment!.assessor_id, outcome: decision })),
    ])
    insist(await reviewAdmit(), 'portal_enrollment_not_found', 404)
    await assertReviewer()
    insist(result[0].meta.changes === 1, 'portal_practical_already_decided', 409)
  }
  // Recheck before returning private evidence as well as inside every evidence write.
  insist(await (review ? reviewAdmit() : admit()), 'portal_enrollment_not_found', 404)
  if (review) await assertReviewer()
  const recorded = await submissions(env, enrollment)
  const accepted = recorded.some(row => row.state === 'accepted'), pending = recorded.some(row => row.state === 'awaiting_review')
  const data: PortalPracticalData = { portal: context.portal, enrollment, revision: enrolled.revision_id, assessmentRevision: assessment?.id ?? null,
    instructions: assessment?.practical_instructions ?? null, available, lessonsComplete, accepted, pending,
    submission: !review && available && lessonsComplete && !accepted && !pending ? newId() : null,
    submissions: recorded, review, ...(review ? { learner: enrolled.learner_name } : {}), attachments: false }
  const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' }
  return request.method === 'HEAD' ? new Response(null, { headers }) : Response.json(data, { headers })
}
