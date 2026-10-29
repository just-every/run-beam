import type { Bindings } from '../auth.server'
import { all } from './core'

export type PortalReportEnrollment = {
  id: string
  identity: string
  name: string
  revision: string
  courseTitle: string
  revisionNumber: number
  enrolledAt: number
  completion: string | null
  completedAt: number | null
  certificateNumber: string | null
  pendingReviews: number
  practicalPending: number
  reviewable: number
  attempts: number
  assessmentPassed: 0 | 1 | null
  lessonsRead: number
  totalLessons: number
  status: 'planned' | 'in_progress' | 'completed'
}
export type PortalReport = { name: string; reviewing?: boolean; enrollments: PortalReportEnrollment[] }

// The dispatcher authorizes the current owner or this portal's current administrator.
// This read introduces no authority and selects only aggregate learning evidence.
export async function buildPortalReport(env: Bindings, portal: string, name: string): Promise<PortalReport> {
  const enrollments = await all<Omit<PortalReportEnrollment, 'status'>>(env, `SELECT
    e.id,e.identity_id AS identity,i.display_name AS name,e.revision_id AS revision,
    r.title AS courseTitle,r.number AS revisionNumber,e.enrolled_at AS enrolledAt,
    completion.id AS completion,completion.completed_at AS completedAt,
    completion.certificate_number AS certificateNumber,
    (SELECT COUNT(*) FROM beam_portal_attempts attempt WHERE attempt.enrollment_id=e.id) AS attempts,
    (SELECT COUNT(*) FROM beam_portal_attempts attempt WHERE attempt.enrollment_id=e.id AND attempt.state='awaiting_review') AS pendingReviews,
    (SELECT COUNT(*) FROM beam_portal_practical_submissions practical WHERE practical.enrollment_id=e.id AND NOT EXISTS(SELECT 1 FROM beam_portal_practical_decisions decision WHERE decision.submission_id=practical.id)) AS practicalPending,
    EXISTS(SELECT 1 FROM beam_assessment_revisions a JOIN beam_members m ON m.id=a.assessor_id JOIN oa_operators o ON o.id=m.operator_id WHERE a.course_revision_id=e.revision_id AND o.role='owner' AND o.status='active' AND m.erasure_pending=0 AND m.erased_at IS NULL) AS reviewable,
    (SELECT MAX(passed) FROM beam_portal_attempts attempt WHERE attempt.enrollment_id=e.id) AS assessmentPassed,
    (SELECT COUNT(*) FROM beam_portal_lesson_progress progress
      JOIN beam_lesson_revisions lesson ON lesson.id=progress.lesson_revision_id AND lesson.course_revision_id=e.revision_id
      WHERE progress.enrollment_id=e.id) AS lessonsRead,
    (SELECT COUNT(*) FROM beam_lesson_revisions lesson WHERE lesson.course_revision_id=e.revision_id) AS totalLessons
    FROM beam_portal_enrollments e
    JOIN beam_enterprise_portals p ON p.id=e.portal_id
    JOIN beam_portal_identities i ON i.id=e.identity_id AND i.portal_id=e.portal_id
    JOIN beam_portal_shares s ON s.portal_id=e.portal_id AND s.revision_id=e.revision_id
    JOIN beam_course_revisions r ON r.id=e.revision_id
    JOIN beam_courses c ON c.id=r.course_id
    LEFT JOIN beam_portal_completions completion ON completion.enrollment_id=e.id AND completion.revision_id=e.revision_id
    WHERE e.portal_id=? AND i.revoked_at IS NULL AND i.operator_id IS NOT NULL
    AND i.consent_at IS NOT NULL AND i.consent_version=p.notice_version
    AND s.revoked_at IS NULL AND r.state IN ('published','superseded')
    AND c.retired_at IS NULL AND c.archived_at IS NULL ORDER BY e.id`, portal)
  return { name, enrollments: enrollments.map<PortalReportEnrollment>(row => ({ ...row,
    status: row.completion !== null ? 'completed' : row.lessonsRead > 0 || row.attempts > 0 ? 'in_progress' : 'planned',
  })) }
}

// Quoting alone does not stop spreadsheet formulas, including whitespace-prefixed ones.
function csvCell(value: unknown): string {
  const text = String(value ?? '')
  const safe = /^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/u.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

export function portalReportCsv(report: PortalReport): string {
  const rows: unknown[][] = [['Enrollment', 'Portal identity', 'Approved revision', 'Enrolled UTC', 'State',
    'Learner', 'Course', 'Revision number', 'Lessons read', 'Total lessons', 'Assessment attempts',
    'Assessment passed', 'Completion', 'Certificate number', 'Completed UTC'],
  ...report.enrollments.map(row => [row.id, row.identity, row.revision, new Date(row.enrolledAt).toISOString(), row.status,
    row.name, row.courseTitle, row.revisionNumber, row.lessonsRead, row.totalLessons, row.attempts,
    row.assessmentPassed === null ? '' : row.assessmentPassed === 1 ? 'yes' : 'no', row.completion,
    row.certificateNumber, row.completedAt === null ? '' : new Date(row.completedAt).toISOString()])]
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
