// CONNECT-015: interrupted requests may have reached the receiver. Never infer
// failure from lease expiry; retain the reservation and require a human replay.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { insist, newId, now, stmt, type Row } from './core'

// Longer than the provider's 10-second request deadline. This lease does not
// cause a retry and cannot prove whether the receiver accepted the old request.
const SEND_LEASE_MS = 60_000
const UNKNOWN_FAILURE = 'The receiver may have accepted this event. Check its stable event id before confirming replay; receiver deduplication is required.'

/** Call before reads, cron selection and replay. Also recognizes restored
 * mid-flight reservations and legacy sends that predate the lease columns. */
export async function recoverInterruptedWebhooks(env: Bindings, id: string | null = null) {
  const at = now()
  const candidate = `(?1 IS NULL OR d.id=?1) AND (
    (d.state='sending' AND COALESCE(d.send_expires_at,0)<=?2)
    OR (d.state IN ('pending','held') AND EXISTS (
      SELECT 1 FROM beam_automation_executions x WHERE x.kind='webhook'
      AND x.rule_id=d.subscription_id AND x.event_key=d.id||':'||d.cycle||':'||d.tries
      AND x.state='running' AND x.updated_at<=?2-60000))
    OR (d.state='held' AND d.outcome='restored' AND EXISTS (
      SELECT 1 FROM beam_automation_executions x WHERE x.kind='webhook'
      AND x.rule_id=d.subscription_id AND x.event_key=d.id||':'||d.cycle||':'||d.tries AND x.state='running')))`
  const [, , , , recovered] = await env.DB.batch([
    stmt(env, `UPDATE beam_automation_executions SET outcome='outcome_unknown',failure=?3,updated_at=?2
      WHERE kind='webhook' AND state='running' AND EXISTS (
        SELECT 1 FROM beam_webhook_deliveries d WHERE ${candidate}
        AND rule_id=d.subscription_id AND event_key=d.id||':'||d.cycle||':'||d.tries)`, id, at, UNKNOWN_FAILURE),
    stmt(env, `UPDATE beam_automation_attempts SET outcome='outcome_unknown',failure=?3
      WHERE outcome='reserved' AND execution_id IN (SELECT x.id FROM beam_automation_executions x
        JOIN beam_webhook_deliveries d ON x.rule_id=d.subscription_id
        AND x.event_key=d.id||':'||d.cycle||':'||d.tries
        WHERE x.kind='webhook' AND x.state='running' AND ${candidate})`, id, at, UNKNOWN_FAILURE),
    stmt(env, `INSERT INTO beam_webhook_attempts(id,delivery_id,at,key_version,status,outcome)
      SELECT lower(hex(randomblob(16))),d.id,COALESCE(d.send_started_at,?2),
      COALESCE(d.send_key_version,(SELECT json_extract(x.input_json,'$.keyVersion')
        FROM beam_automation_executions x WHERE x.kind='webhook' AND x.rule_id=d.subscription_id
        AND x.event_key=d.id||':'||d.cycle||':'||d.tries),s.key_version),NULL,'outcome_unknown'
      FROM beam_webhook_deliveries d JOIN beam_webhook_subscriptions s ON s.id=d.subscription_id
      WHERE ${candidate}`, id, at),
    stmt(env, `INSERT INTO beam_audit(at,actor,action,subject,detail,via)
      SELECT ?2,s.created_by,'webhook.interrupted',d.id,
      json_object('event',d.event_id,'subscription',d.subscription_id,'outcome','outcome_unknown'),NULL
      FROM beam_webhook_deliveries d JOIN beam_webhook_subscriptions s ON s.id=d.subscription_id
      WHERE ${candidate}`, id, at),
    stmt(env, `UPDATE beam_webhook_deliveries AS d SET state='held',outcome='outcome_unknown',
      send_token=NULL,send_expires_at=NULL WHERE ${candidate}`, id, at),
  ])
  return recovered.meta.changes
}

/** Must replace the old sending UPDATE inside controlledExecution. */
export async function claimWebhookSend(env: Bindings, delivery: Row, keyVersion: number) {
  const token = newId(), at = now()
  const claimed = await stmt(env, `UPDATE beam_webhook_deliveries
    SET state='sending',send_token=?,send_started_at=?,send_expires_at=?,send_key_version=?
    WHERE id=? AND state IN ('pending','retry','held')
    AND COALESCE(outcome,'')<>'outcome_unknown' AND due_at<=? AND tries=? AND cycle=?
    AND EXISTS(SELECT 1 FROM beam_webhook_subscriptions s WHERE s.id=subscription_id AND s.enabled=1 AND s.revoked_at IS NULL AND s.key_version=?)`,
    token, at, at + SEND_LEASE_MS, keyVersion, delivery.id, at, delivery.tries, delivery.cycle, keyVersion).run()
  insist(claimed.meta.changes === 1, 'webhook_already_running', 409)
  return token
}

/** Commit only if this attempt still owns the delivery. A delayed response can
 * never overwrite a recovered hold or the next human-confirmed cycle. */
export async function finishWebhookSend(env: Bindings, delivery: Row, token: string,
  authority: string, keyVersion: number, status: number | null, outcome: string, delay: number) {
  const at = now(), tries = delivery.tries + 1
  const state = outcome === 'accepted' ? 'delivered' : tries >= 3 ? 'dead_letter' : 'retry'
  const owns = "id=? AND state='sending' AND send_token=? AND cycle=? AND tries=?"
  const params = [delivery.id, token, delivery.cycle, delivery.tries]
  const [, , updated] = await env.DB.batch([
    stmt(env, `INSERT INTO beam_webhook_attempts(id,delivery_id,at,key_version,status,outcome)
      SELECT ?,id,?,?,?,? FROM beam_webhook_deliveries WHERE ${owns}`,
      newId(), at, keyVersion, status, outcome, ...params),
    stmt(env, `INSERT INTO beam_audit(at,actor,action,subject,detail,via)
      SELECT ?,?,'webhook.delivery',id,?,NULL FROM beam_webhook_deliveries WHERE ${owns}`,
      at, authority, JSON.stringify({ event: delivery.event_id, subscription: delivery.subscription_id,
        keyVersion, attempt: tries, status, outcome }), ...params),
    stmt(env, `UPDATE beam_webhook_deliveries SET state=?,tries=?,due_at=?,outcome=?,
      send_token=NULL,send_expires_at=NULL WHERE ${owns}`, state, tries, at + delay, outcome, ...params),
  ])
  return updated.meta.changes === 1 ? state : 'outcome_unknown'
}

/** The public action must authorize the current human before calling this.
 * Continue through normal deliver afterwards: live consent/scope, signing key,
 * enabling authority and the current AUTO-008 policy must all be checked again.
 * A new cycle keeps the original event id but cannot inherit old approval. */
export async function confirmInterruptedWebhookReplay(env: Bindings, actor: Actor, delivery: Row, confirmed: boolean) {
  if (delivery.state !== 'held' || delivery.outcome !== 'outcome_unknown') return false
  insist(confirmed, 'webhook_replay_confirmation_required', 409)
  const where = "id=? AND state='held' AND outcome='outcome_unknown' AND cycle=? AND tries=?"
  const params = [delivery.id, delivery.cycle, delivery.tries]
  const [, updated] = await env.DB.batch([
    stmt(env, `INSERT INTO beam_audit(at,actor,action,subject,detail,via)
      SELECT ?,?,'webhook.replay',id,?,NULL FROM beam_webhook_deliveries WHERE ${where}`,
      now(), actor.id, JSON.stringify({ event: delivery.event_id, previousCycle: delivery.cycle,
        confirmedUncertainOutcome: true }), ...params),
    stmt(env, `UPDATE beam_webhook_deliveries SET state='retry',tries=0,cycle=cycle+1,
      due_at=?,outcome=NULL,send_token=NULL,send_started_at=NULL,send_expires_at=NULL,send_key_version=NULL WHERE ${where}`,
      now(), ...params),
  ])
  return updated.meta.changes === 1
}
