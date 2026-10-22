// Resolve only the snapshotted person; current relationships, address and
// language are checked afresh, including before an explicitly replayed send.
import type { Bindings } from '../auth.server'
import { one, type Row } from './core'
import { languagePreference } from './language'
import { message } from './messages'
import { formatDay } from './time'

export const NOTICE_CONTEXT = `SELECT n.*,a.status AS assignmentState,a.due_date AS dueDate,a.timezone,
    a.course_revision_id AS revision,v.title AS courseTitle,l.name AS learnerName,l.preferred_name AS preferredName,
    l.employment AS learnerEmployment,lo.status AS learnerAccess,p.email AS address,
    p.employment AS recipientEmployment,po.status AS recipientAccess,r.state AS ruleState,
    r.notice_enabled,r.notice_version,r.notice_consent_by,r.notice_consent_at,r.notice_activated_at,
    EXISTS(SELECT 1 FROM beam_team_managers g JOIN beam_team_members t ON t.team_id=g.team_id
      WHERE g.member_id=n.recipient_id AND t.member_id=n.learner_id AND g.revoked_at IS NULL
        AND (g.expires_at IS NULL OR g.expires_at>?2)) AS currentManager,
    EXISTS(SELECT 1 FROM beam_exceptions e WHERE e.assignment_id=a.id AND e.ends_at>?2) AS excepted,
    EXISTS(SELECT 1 FROM beam_members m JOIN oa_operators o ON o.id=m.operator_id
      WHERE m.id=n.consented_by AND o.role='owner' AND o.status='active' AND m.employment='active') AS consentAuthority,
    EXISTS(SELECT 1 FROM beam_members m JOIN oa_operators o ON o.id=m.operator_id
      WHERE m.id=r.enabled_by AND o.role='owner' AND o.status='active' AND m.employment='active') AS ruleAuthority
  FROM beam_renewal_notices n JOIN beam_assignments a ON a.id=n.assignment_id
    JOIN beam_course_revisions v ON v.id=a.course_revision_id JOIN beam_renewal_rules r ON r.id=n.rule_id
    JOIN beam_members l ON l.id=n.learner_id LEFT JOIN oa_operators lo ON lo.id=l.operator_id
    JOIN beam_members p ON p.id=n.recipient_id LEFT JOIN oa_operators po ON po.id=p.operator_id
  WHERE n.id=?1`

export const noticeContext = (env: Bindings, id: string, at: number) => one(env, NOTICE_CONTEXT, id, at)

/** These are delivery holds, not changes to an assignment or learning evidence. */
export function noticeProblem(row: Row) {
  if (!row.notice_enabled || row.notice_version !== row.consent_version || row.notice_consent_by !== row.consented_by
    || row.notice_consent_at !== row.consented_at || row.notice_activated_at !== row.activated_at) return 'consent_withdrawn'
  if (row.assignmentState !== 'open') return 'assignment_ended'
  if (row.learnerAccess !== 'active' || row.learnerEmployment === 'terminated') return 'learner_unavailable'
  if (row.recipientAccess !== 'active' || row.recipientEmployment === 'terminated') return 'recipient_unavailable'
  if (row.route === 'manager' && !row.currentManager) return 'recipient_access_changed'
  if (row.route === 'learner' && row.recipient_id !== row.learner_id) return 'recipient_access_changed'
  if (row.ruleState !== 'active') return 'rule_paused'
  if (row.learnerEmployment !== 'active' || row.recipientEmployment !== 'active') return 'on_leave'
  if (row.excepted) return 'assignment_excepted'
  if (!row.address) return 'no_contact_route'
  return null
}

export const terminalNoticeProblem = (code: string) => ['consent_withdrawn', 'assignment_ended', 'learner_unavailable', 'recipient_unavailable', 'recipient_access_changed'].includes(code)

export async function renewalNoticeContent(env: Bindings, row: Row) {
  const locale = (await languagePreference(env, row.recipient_id)).language
  const link = new URL(row.route === 'learner' ? `/app/learn/${row.assignment_id}` : `/app/records/${row.learner_id}`, env.AUTH_ORIGIN).href
  const subject = message(locale, 'Renewal learning assigned')
  const text = message(locale, row.route === 'learner'
    ? 'Renewal learning: {course}. Due {date} at 17:00 ({timezone}). Training is paid work time. Review your assignment after signing in: {link}'
    : 'Renewal learning for {learner}: {course}. Due {date} at 17:00 ({timezone}). Training is paid work time. Review the learner’s record after signing in: {link}',
  { learner: row.preferredName || row.learnerName, course: row.courseTitle, date: formatDay(row.dueDate, locale), timezone: row.timezone, link })
  return { language: locale, address: row.address ?? null, subject, text }
}
