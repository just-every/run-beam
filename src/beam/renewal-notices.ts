// AUTO-004: notices are independent from the successful assignment execution.
// Accepted means provider acceptance, never delivery. Unknown outcomes freeze.
import type { Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import type { Actor } from './actor'
import { controlledExecution } from './automation-execution'
import { all, commit, insist, newId, now, stmt } from './core'
import type { Input } from './input'
import { NOTICE_CONTEXT, noticeContext, noticeProblem, renewalNoticeContent, terminalNoticeProblem } from './renewal-notice-content'
import { NOTICE_LEASE_MS, noticeOwner, recoverRenewalNotices } from './renewal-notice-outbox'

async function deliverNotice(env: Bindings, id: string, manual: boolean) {
  const item = await noticeContext(env, id, now())
  insist(item, 'renewal_notice_not_found', 404)
  if (item.outcome === 'outcome_unknown') return 'outcome_unknown'
  if (['accepted', 'development', 'suppressed', 'sending'].includes(item.state)) return item.outcome ?? item.state
  const content = await renewalNoticeContent(env, item)
  const input = { notice: id, assignment: item.assignment_id, revision: item.revision, recipient: item.recipient_id,
    route: item.route, consentVersion: item.consent_version, ...content, externalSpendCents: item.cost_cents }
  const outcome = await controlledExecution(env, { kind: 'renewal', rule: item.rule_id, event: `notice:${id}`,
    learner: item.learner_id, authority: item.consented_by, unit: null, manual, input,
    authorized: async () => { const live = await noticeContext(env, id, now()); return Boolean(live?.consentAuthority && live?.ruleAuthority) },
  }, async artifact => {
    const live = await noticeContext(env, id, now())
    insist(live, 'renewal_notice_not_found', 404)
    const problem = noticeProblem(live)
    if (problem) {
      await commit(env, [stmt(env, `UPDATE beam_renewal_notices SET state=?,outcome=?
        WHERE id=? AND state IN ('pending','held','failed') AND COALESCE(outcome,'')<>'outcome_unknown'`,
        terminalNoticeProblem(problem) ? 'suppressed' : 'held', problem, id)],
      { actor: item.consented_by, action: 'renewal.notice-held', subject: id, detail: { assignment: item.assignment_id, recipient: item.recipient_id, outcome: problem } })
      insist(false, `renewal_notice_${problem}`, 409)
    }
    insist(JSON.stringify(await renewalNoticeContent(env, live)) === JSON.stringify(content), 'renewal_notice_inputs_changed', 409)
    const sender = operatorMail(env)
    insist(sender && env.MAIL_FROM, 'mail_not_configured', 409)
    const token = newId(), at = now()
    const claimed = await stmt(env, `WITH live AS (${NOTICE_CONTEXT})
      UPDATE beam_renewal_notices SET state='sending',outcome='reserved',send_token=?3,
        send_started_at=?2,send_expires_at=?4,attempts=attempts+1,language=?5
      WHERE id=?1 AND state IN ('pending','held','failed') AND COALESCE(outcome,'')<>'outcome_unknown'
        AND EXISTS(SELECT 1 FROM live WHERE notice_enabled=1 AND notice_version=consent_version
          AND notice_consent_by=consented_by AND notice_consent_at=consented_at AND notice_activated_at=activated_at
          AND ruleState='active' AND assignmentState='open' AND learnerAccess='active' AND learnerEmployment='active'
          AND recipientAccess='active' AND recipientEmployment='active' AND consentAuthority=1 AND ruleAuthority=1
          AND excepted=0 AND address=?6 AND (route='learner' AND recipient_id=learner_id OR route='manager' AND currentManager=1))
        AND EXISTS(SELECT 1 FROM beam_automation_executions x JOIN beam_automation_policy p ON p.id=1
          WHERE x.kind='renewal' AND x.rule_id=beam_renewal_notices.rule_id AND x.event_key='notice:'||?1
            AND x.state='running' AND x.policy_version=p.version AND p.paused=0)`,
      id, at, token, at + NOTICE_LEASE_MS, content.language, content.address).run()
    insist(claimed.meta.changes === 1, 'renewal_notice_source_changed', 409)
    let status = 'uncertain', provider: string | null = null, providerMessageId: string | null = null
    try {
      const sent = await sender.send({ deliveryId: artifact, from: env.MAIL_FROM, to: [content.address!],
        subject: content.subject, text: content.text,
        html: `<p>${content.text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)}</p>`, headers: {} })
      status = sent.status; provider = sent.provider; providerMessageId = sent.providerMessageId
    } catch { /* Never retain provider bodies, credentials or raw network errors. */ }
    const uncertain = status === 'uncertain'
    const state = status === 'accepted' ? 'accepted' : status === 'development' ? 'development' : uncertain ? 'held' : 'failed'
    const result = uncertain ? 'outcome_unknown' : `mail_${status}`
    const [, updated] = await env.DB.batch([
      stmt(env, `INSERT INTO beam_audit(at,actor,action,subject,detail)
        SELECT ?,?,'renewal.notice-mail',id,? FROM beam_renewal_notices WHERE id=? AND state='sending' AND send_token=?`,
        now(), item.consented_by, JSON.stringify({ assignment: item.assignment_id, recipient: item.recipient_id,
          route: item.route, outcome: result, provider, providerMessageId, externalSpendCents: item.cost_cents }), id, token),
      stmt(env, `UPDATE beam_renewal_notices SET state=?,outcome=?,provider=?,provider_message_id=?,sent_at=?,
        send_token=NULL,send_expires_at=NULL WHERE id=? AND state='sending' AND send_token=?`,
        state, result, provider, providerMessageId, status === 'accepted' || status === 'development' ? now() : null, id, token),
    ])
    insist(updated.meta.changes === 1 && !uncertain, 'renewal_notice_outcome_unknown', 409)
    insist(status === 'accepted' || status === 'development', `mail_${status}`, 502)
    return result
  })
  // A concurrent sender's running reservation is not evidence of a crashed
  // request. Its lease is recovered only after expiry, never by another caller.
  if (outcome !== 'outcome_unknown' && outcome !== 'already_ran') await stmt(env,
    `UPDATE beam_renewal_notices SET state='held',outcome=? WHERE id=? AND state IN ('pending','held')
      AND COALESCE(outcome,'') NOT IN ('outcome_unknown','consent_withdrawn','assignment_ended','recipient_access_changed')`, outcome, id).run()
  return outcome
}

/** Drain previously unattempted outbox entries, never failed or held entries. */
export async function runRenewalNotices(env: Bindings, onlyRule?: string) {
  await recoverRenewalNotices(env)
  const results = []
  for (const row of await all(env, `SELECT id,assignment_id,recipient_id,route FROM beam_renewal_notices
    WHERE state='pending' AND (? IS NULL OR rule_id=?) ORDER BY created_at,rowid LIMIT 50`, onlyRule ?? null, onlyRule ?? null)) {
    results.push({ notice: row.id, assignment: row.assignment_id, recipient: row.recipient_id, route: row.route,
      outcome: await deliverNotice(env, row.id, false) })
  }
  return results
}

export async function replayRenewalNotice(env: Bindings, actor: Actor, input: Input) {
  noticeOwner(actor)
  await recoverRenewalNotices(env)
  const id = input.text('notice')
  return { notice: id, outcome: await deliverNotice(env, id, true) }
}
