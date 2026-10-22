import { localizedRevision } from './course-locales'
// MOVE-009 credit decisions are a renewal source, never native completions.
// The credited expiry is the deadline; native grace does not extend it.
import type { Bindings } from '../auth.server'
import { enrolmentWindow } from './access'
import { followOn } from './automation'
import { all, insist, now, one, stmt, type Row } from './core'
import { captureRenewalNotices } from './renewal-notice-outbox'
import { addDays, localDate, zonedInstant } from './time'

/** Choose the latest non-undone decision per person/course. A current native
 * completion always wins; a new native completion starts the next native cycle. */
export async function creditRenewalCandidates(env: Bindings, rule: Row, timezone: string): Promise<Row[]> {
  const at = now(), today = localDate(at, timezone)
  const records = await all(env, `SELECT p.credit_id AS credit,p.member_id AS learner,m.name AS learnerName,
      p.history_id AS history,p.source AS creditSource,p.completed_on AS completedOn,p.expires_at AS expiresAt,
      k.approved_at AS approvedAt,k.interval_days AS renewalDays,cy.assignment_id AS renewedAssignment,
      co.retired_at,co.published_revision_id,
      EXISTS(SELECT 1 FROM beam_completions n WHERE n.learner_id=p.member_id AND n.course_id=k.course_id
        AND (n.expires_at IS NULL OR n.expires_at>?2)) AS nativeCurrent,
      EXISTS(SELECT 1 FROM beam_completions n LEFT JOIN beam_audit a ON a.action='completion.record' AND a.subject=n.id
        WHERE n.learner_id=p.member_id AND n.course_id=k.course_id
        AND (n.completed_at>=k.approved_at OR a.at>=k.approved_at)) AS nativeSuperseded,
      (SELECT id FROM beam_assignments open WHERE open.learner_id=p.member_id AND open.course_id=k.course_id AND open.status='open') AS openAssignment
    FROM beam_history_credit_people p JOIN beam_history_credits k ON k.id=p.credit_id
      JOIN beam_members m ON m.id=p.member_id JOIN oa_operators o ON o.id=m.operator_id
      JOIN beam_courses co ON co.id=k.course_id
      LEFT JOIN beam_credit_renewal_cycles cy ON cy.credit_id=p.credit_id AND cy.member_id=p.member_id
    WHERE k.course_id=?1 AND k.undone_at IS NULL AND o.status='active' AND m.employment<>'terminated'
      AND p.credit_id=(SELECT newer.credit_id FROM beam_history_credit_people newer
        JOIN beam_history_credits decision ON decision.id=newer.credit_id
        WHERE newer.member_id=p.member_id AND decision.course_id=k.course_id AND decision.undone_at IS NULL
        ORDER BY newer.expires_at DESC,decision.approved_at DESC,decision.id DESC LIMIT 1)
    ORDER BY m.name,p.credit_id,p.member_id`, rule.course_id, at)
  return records.map(row => {
    const expiryDate = localDate(row.expiresAt, timezone), opensOn = addDays(expiryDate, -rule.lead_days)
    const outcome = row.nativeCurrent ? 'native_current' : row.nativeSuperseded ? 'native_superseded'
      : row.renewedAssignment ? 'already_renewed' : row.openAssignment ? 'already_open'
      : row.retired_at || !row.published_revision_id ? 'course_unavailable' : today < opensOn ? 'not_due' : 'would_assign'
    return { ...row, source: 'history_credit', completion: null, event: `credit:${row.credit}:${row.learner}`,
      expiryDate, opensOn, dueDate: expiryDate, timezone, outcome,
      coverage: at > zonedInstant(expiryDate, '17:00', timezone) ? 'overdue' : at < row.expiresAt ? 'current' : 'expired' }
  })
}

/** The source guard and both enrollment/cycle writes share a transaction. Undo
 * or replacement before this transaction prevents enrollment; undo afterwards
 * preserves the real assignment, as MOVE-009 requires. */
export async function assignCreditRenewal(env: Bindings, rule: Row, item: Row, artifact: string) {
  const at = now(), window = await enrolmentWindow(env, rule.course_id, null, at)
  const base = (await one(env, 'SELECT published_revision_id FROM beam_courses WHERE id=?', rule.course_id))?.published_revision_id
  if (!base) return 'course_unavailable'
  const revision = await localizedRevision(env, base, item.learner)
  const dueAt = zonedInstant(item.dueDate, '17:00', item.timezone)
  const detail = { credit: item.credit, history: item.history, source: item.creditSource, learner: item.learner,
    course: rule.course_id, rule: rule.id, expiresAt: item.expiresAt, dueDate: item.dueDate, timezone: item.timezone }
  const [inserted, , cycle] = await env.DB.batch([
    stmt(env, `INSERT OR IGNORE INTO beam_assignments
      (id,learner_id,course_id,course_revision_id,path_revision_id,prerequisite_course_id,renewal_days,
        due_date,due_time,timezone,due_at,status,reason,assigned_by,assigned_at,
        access_opens_at,access_closes_at,access_rule,due_anchor,due_days)
      SELECT ?1,p.member_id,k.course_id,?14,NULL,NULL,k.interval_days,
        ?7,'17:00',?8,?9,'open','scheduled renewal',r.enabled_by,?10,?11,?12,?13,NULL,NULL
      FROM beam_history_credit_people p JOIN beam_history_credits k ON k.id=p.credit_id
        JOIN beam_renewal_rules r ON r.course_id=k.course_id JOIN beam_courses co ON co.id=k.course_id
        JOIN beam_members m ON m.id=p.member_id JOIN oa_operators o ON o.id=m.operator_id
      WHERE p.credit_id=?2 AND p.member_id=?3 AND p.expires_at=?6 AND k.undone_at IS NULL
        AND r.id=?4 AND r.state='active' AND r.enabled_by=?5 AND co.retired_at IS NULL
        AND co.published_revision_id=?15 AND o.status='active' AND m.employment<>'terminated'
        AND (SELECT timezone FROM beam_business WHERE singleton=1)=?8
        AND NOT EXISTS(SELECT 1 FROM beam_credit_renewal_cycles used WHERE used.credit_id=p.credit_id AND used.member_id=p.member_id)
        AND p.credit_id=(SELECT newer.credit_id FROM beam_history_credit_people newer
          JOIN beam_history_credits decision ON decision.id=newer.credit_id
          WHERE newer.member_id=p.member_id AND decision.course_id=k.course_id AND decision.undone_at IS NULL
          ORDER BY newer.expires_at DESC,decision.approved_at DESC,decision.id DESC LIMIT 1)
        AND NOT EXISTS(SELECT 1 FROM beam_completions n LEFT JOIN beam_audit a ON a.action='completion.record' AND a.subject=n.id
          WHERE n.learner_id=p.member_id AND n.course_id=k.course_id
          AND (n.expires_at IS NULL OR n.expires_at>?10 OR n.completed_at>=k.approved_at OR a.at>=k.approved_at))`,
      artifact, item.credit, item.learner, rule.id, rule.enabled_by, item.expiresAt, item.dueDate, item.timezone,
      dueAt, at, window.opensAt, window.closesAt, window.rule, revision, base),
    stmt(env, "INSERT INTO beam_audit(at,actor,action,subject,detail) SELECT ?,?,'assignment.renewal',?,? WHERE changes()=1",
      at, rule.enabled_by, artifact, JSON.stringify(detail)),
    stmt(env, `INSERT OR IGNORE INTO beam_credit_renewal_cycles
      (credit_id,member_id,rule_id,assignment_id,history_id,source,expires_at,due_date,timezone,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,? FROM beam_assignments WHERE id=?`,
      item.credit, item.learner, rule.id, artifact, item.history, item.creditSource, item.expiresAt, item.dueDate, item.timezone, at, artifact),
    ...captureRenewalNotices(env, rule, artifact, at),
    stmt(env, `INSERT INTO beam_audit(at,actor,action,subject,detail)
      SELECT ?,?,'renewal.assign',?,? WHERE EXISTS(SELECT 1 FROM beam_credit_renewal_cycles WHERE assignment_id=? AND created_at=?)`,
      at, rule.enabled_by, artifact, JSON.stringify(detail), artifact, at),
  ])
  if (inserted.meta.changes === 1) await followOn(env, 'enrollment', { assignment: artifact })
  if (inserted.meta.changes === 1 || cycle.meta.changes === 1 || await one(env,
    'SELECT 1 FROM beam_credit_renewal_cycles WHERE credit_id=? AND member_id=? AND assignment_id=?', item.credit, item.learner, artifact)) return 'assigned'
  // Another enrollment can win the normal one-open-assignment constraint.
  if (await one(env, "SELECT 1 FROM beam_assignments WHERE learner_id=? AND course_id=? AND status='open'", item.learner, rule.course_id)) return 'already_open'
  insist(false, 'renewal_source_changed', 409)
}

export async function creditRenewalCycles(env: Bindings) {
  return await all(env, `SELECT cy.*,NULL AS completion_id,'history_credit' AS sourceKind,m.name AS learnerName,c.title
    FROM beam_credit_renewal_cycles cy JOIN beam_history_credits k ON k.id=cy.credit_id
      JOIN beam_members m ON m.id=cy.member_id JOIN beam_courses c ON c.id=k.course_id
    ORDER BY cy.created_at DESC LIMIT 100`)
}
