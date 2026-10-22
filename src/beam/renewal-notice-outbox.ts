// AUTO-004 notice consent, transactional recipient snapshots and uncertainty.
import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { all, insist, now, one, stmt, type Row } from './core'
import type { Input } from './input'

export const NOTICE_LEASE_MS = 60_000
export const UNKNOWN_NOTICE = 'The mail provider may have accepted this notice. Check provider records; this notice cannot be replayed safely.'

export function noticeOwner(actor: Actor) {
  requireOwner(actor)
  insist(!actor.agent && !actor.viewAs, 'human_session_required', 403)
}

export async function setRenewalNoticeConsent(env: Bindings, actor: Actor, input: Input) {
  noticeOwner(actor)
  const id = input.text('rule'), version = input.integer('version')!, enabled = input.flag('enabled'), at = now()
  const rule = await one(env, 'SELECT * FROM beam_renewal_rules WHERE id=?', id)
  insist(rule, 'renewal_rule_not_found', 404)
  insist(rule.notice_version === version, 'renewal_notice_consent_changed', 409)
  if (enabled) insist(input.flag('consent'), 'renewal_notice_consent_required', 409)
  const costCents = enabled ? input.integer('costCents', { max: 100_000 })! : rule.notice_cost_cents
  const [updated] = await env.DB.batch([
    stmt(env, `UPDATE beam_renewal_rules SET notice_enabled=?,notice_version=notice_version+1,
      notice_consent_by=?,notice_consent_at=?,notice_activated_at=?,notice_cost_cents=? WHERE id=? AND notice_version=?`,
      enabled ? 1 : 0, actor.id, at, enabled ? at : null, costCents, id, version),
    stmt(env, `INSERT INTO beam_audit(at,actor,action,subject,detail)
      SELECT ?,?,'renewal.notice-consent',?,? WHERE changes()=1`, at, actor.id, id,
      JSON.stringify({ enabled, version: version + 1, consent: enabled, activatedAt: enabled ? at : null, appliesTo: 'future_cycles', estimatedCostCents: costCents })),
  ])
  insist(updated.meta.changes === 1, 'renewal_notice_consent_changed', 409)
  return { rule: id, enabled, version: version + 1, consentedBy: actor.id, consentedAt: at, activatedAt: enabled ? at : null, costCents }
}

/** Append immediately after the cycle INSERT, in that same D1 batch. changes()
 * fences historical/replayed cycles. One INSERT snapshots all recipients; replay
 * never adds a manager appointed after the cycle was committed. */
export function captureRenewalNotices(env: Bindings, rule: Row, assignment: string, at: number) {
  if (!rule.notice_enabled || !rule.notice_activated_at) return []
  return [stmt(env, `INSERT OR IGNORE INTO beam_renewal_notices
    (id,rule_id,assignment_id,learner_id,recipient_id,route,consent_version,cost_cents,consented_by,consented_at,activated_at,state,created_at)
    SELECT lower(hex(randomblob(16))),r.id,a.id,a.learner_id,person.id,person.route,
      r.notice_version,r.notice_cost_cents,r.notice_consent_by,r.notice_consent_at,r.notice_activated_at,'pending',?3
    FROM beam_assignments a JOIN beam_renewal_rules r ON r.id=?1 JOIN (
      SELECT m.id,'learner' AS route FROM beam_members m JOIN oa_operators o ON o.id=m.operator_id
        WHERE m.id=(SELECT learner_id FROM beam_assignments WHERE id=?2) AND o.status='active' AND m.employment<>'terminated'
      UNION
      SELECT m.id,'manager' AS route FROM beam_team_managers g JOIN beam_team_members t ON t.team_id=g.team_id
        JOIN beam_members m ON m.id=g.member_id JOIN oa_operators o ON o.id=m.operator_id
        WHERE t.member_id=(SELECT learner_id FROM beam_assignments WHERE id=?2)
        AND m.id<>t.member_id AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?3)
        AND m.employment='active' AND o.status='active'
    ) person ON 1=1
    WHERE a.id=?2 AND changes()=1 AND r.state='active' AND r.notice_enabled=1
      AND r.notice_version=?4 AND r.notice_consent_by=?5 AND r.notice_consent_at=?6
      AND r.notice_activated_at=?7 AND a.assigned_at>=r.notice_activated_at`,
    rule.id, assignment, at, rule.notice_version, rule.notice_consent_by, rule.notice_consent_at, rule.notice_activated_at)]
}

/** Recover the display only. Expiry never authorizes another provider request,
 * including a crash after the AUTO-008 reservation but before the send claim. */
export async function recoverRenewalNotices(env: Bindings) {
  const at = now(), expired = `((n.state='sending' AND COALESCE(n.send_expires_at,0)<=?1)
    OR (n.state IN ('pending','held','failed') AND COALESCE(n.outcome,'')<>'outcome_unknown'
      AND EXISTS(SELECT 1 FROM beam_automation_executions x WHERE x.kind='renewal' AND x.rule_id=n.rule_id
        AND x.event_key='notice:'||n.id AND x.state='running' AND x.updated_at<=?2)))`
  await env.DB.batch([
    stmt(env, `UPDATE beam_automation_executions SET outcome='outcome_unknown',failure=?3
      WHERE kind='renewal' AND state='running' AND EXISTS(SELECT 1 FROM beam_renewal_notices n
        WHERE ${expired} AND beam_automation_executions.rule_id=n.rule_id
        AND beam_automation_executions.event_key='notice:'||n.id)`, at, at - NOTICE_LEASE_MS, UNKNOWN_NOTICE),
    stmt(env, `UPDATE beam_automation_attempts SET outcome='outcome_unknown',failure=?3
      WHERE outcome='reserved' AND execution_id IN (SELECT x.id FROM beam_automation_executions x
        JOIN beam_renewal_notices n ON x.rule_id=n.rule_id AND x.event_key='notice:'||n.id
        WHERE x.kind='renewal' AND x.state='running' AND ${expired})`, at, at - NOTICE_LEASE_MS, UNKNOWN_NOTICE),
    stmt(env, `INSERT INTO beam_audit(at,actor,action,subject,detail)
      SELECT ?1,n.consented_by,'renewal.notice-interrupted',n.id,
        json_object('assignment',n.assignment_id,'recipient',n.recipient_id,'outcome','outcome_unknown')
      FROM beam_renewal_notices n WHERE ${expired}`, at, at - NOTICE_LEASE_MS),
    stmt(env, `UPDATE beam_renewal_notices AS n SET state='held',outcome='outcome_unknown',send_token=NULL,send_expires_at=NULL
      WHERE ${expired}`, at, at - NOTICE_LEASE_MS),
  ])
}

export async function renewalNoticeView(env: Bindings) {
  await recoverRenewalNotices(env)
  const notices = await all(env, `SELECT n.*,m.name AS recipientName,l.name AS learnerName,c.title AS courseTitle,
      CASE WHEN n.outcome='outcome_unknown' THEN ? ELSE x.failure END AS failure,
      x.id AS execution,x.policy_version AS policyVersion,x.outcome AS executionOutcome
    FROM beam_renewal_notices n JOIN beam_members m ON m.id=n.recipient_id
      JOIN beam_members l ON l.id=n.learner_id JOIN beam_assignments a ON a.id=n.assignment_id
      JOIN beam_courses c ON c.id=a.course_id
      LEFT JOIN beam_automation_executions x ON x.kind='renewal' AND x.rule_id=n.rule_id AND x.event_key='notice:'||n.id
    ORDER BY n.created_at DESC,n.rowid DESC LIMIT 200`, UNKNOWN_NOTICE)
  const explanations: Record<string, string> = {
    recipient_access_changed: 'The person no longer manages this learner. This notice is suppressed; future cycles use current managers.',
    consent_withdrawn: 'The consent for this notice has ended. New consent covers future cycles only.',
    assignment_ended: 'The assignment has ended. This notice is suppressed.',
    restored: 'This notice was restored from an archive and cannot inherit permission to send. Renew consent for future cycles.',
    mail_rejected: 'The mail provider rejected this request. Check provider settings, then replay explicitly.',
  }
  return notices.map(row => ({ ...row, failure: explanations[row.outcome] ?? row.failure } as Row))
}
