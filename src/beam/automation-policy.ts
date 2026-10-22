// AUTO-008: the owner controls today's automatic enrollment doors. A policy
// change invalidates approvals; old policy snapshots and attempts remain readable.
import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { MAX_AUTOMATION_CENTS, reservedAutomationBudget } from './automation-budget'
import { all, commit, insist, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { requireBusiness } from './people'
import { localDate } from './time'

interface Policy { version: number; paused: number; quietStart: number; quietEnd: number; dailyLimit: number; dailySpendLimitCents: number }
export const automationPolicy = async (env: Bindings) => (await one<Policy>(env, 'SELECT version, paused, quiet_start AS quietStart, quiet_end AS quietEnd, daily_limit AS dailyLimit, daily_spend_limit_cents AS dailySpendLimitCents FROM beam_automation_policy WHERE id=1'))!

export async function saveAutomationPolicy(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const version = input.integer('version')!, current = await automationPolicy(env)
  insist(current.version === version, 'policy_changed', 409)
  const controls: D1PreparedStatement[] = []
  let policy = current
  if (input.has('rule')) {
    const kind = input.text('kind'), rule = input.text('rule'), mode = input.text('mode')
    insist(['follow_on', 'audience', 'notification', 'escalation', 'renewal', 'webhook'].includes(kind) && ['automatic', 'approval'].includes(mode), 'invalid_control')
    const exists = kind === 'webhook' ? await one(env, 'SELECT 1 FROM beam_webhook_subscriptions WHERE id=?', rule) : kind === 'renewal' ? await one(env, 'SELECT 1 FROM beam_renewal_rules WHERE id=?', rule) : kind === 'escalation' ? await one(env, "SELECT 1 FROM beam_escalation_policy WHERE id=1 AND ?='overdue-work'", rule) : await one(env, `SELECT 1 FROM ${kind === 'follow_on' ? 'beam_automation_rules' : kind === 'audience' ? 'beam_audiences' : 'beam_notification_rules'} WHERE id=?`, rule)
    insist(exists, 'rule_not_found', 404)
    controls.push(stmt(env, 'INSERT INTO beam_automation_controls VALUES(?,?,?) ON CONFLICT(kind,rule_id) DO UPDATE SET mode=excluded.mode', kind, rule, mode))
  } else policy = { ...current, paused: input.flag('paused') ? 1 : 0, quietStart: input.integer('quietStart', { max: 23 })!, quietEnd: input.integer('quietEnd', { max: 23 })!, dailyLimit: input.integer('dailyLimit', { max: 100000 })!,
    dailySpendLimitCents: input.has('dailySpendLimitCents') ? input.integer('dailySpendLimitCents', { max: MAX_AUTOMATION_CENTS })! : current.dailySpendLimitCents }
  const at = now()
  // The leading optimistic update owns the version; a stale request aborts the
  // whole D1 batch via the snapshot's primary key, rather than changing controls.
  await commit(env, [
    stmt(env, 'INSERT INTO beam_automation_policy_versions(version,settings_json,at) VALUES(?,?,?)', version + 1, '{}', at),
    ...controls,
    stmt(env, 'UPDATE beam_automation_policy SET version=?, paused=?, quiet_start=?, quiet_end=?, daily_limit=?, daily_spend_limit_cents=?, updated_by=?, updated_at=? WHERE id=1 AND version=?', version + 1, policy.paused, policy.quietStart, policy.quietEnd, policy.dailyLimit, policy.dailySpendLimitCents, actor.id, at, version),
    stmt(env, `UPDATE beam_automation_policy_versions SET settings_json=json_object('paused',?,'quietStart',?,'quietEnd',?,'dailyLimit',?,'dailySpendLimitCents',?,'currency','USD','controls',json((SELECT json_group_array(json_object('kind',kind,'rule',rule_id,'mode',mode)) FROM beam_automation_controls))) WHERE version=?`, policy.paused, policy.quietStart, policy.quietEnd, policy.dailyLimit, policy.dailySpendLimitCents, version + 1),
  ], { actor, action: 'automation.policy', subject: 'policy', detail: { ...policy, version: version + 1, ...(input.has('rule') ? { kind: input.text('kind'), rule: input.text('rule'), mode: input.text('mode') } : {}) } })
  return await automationPolicy(env)
}

export async function approveAutomation(env: Bindings, actor: Actor, input: Input) {
  requireOwner(actor)
  const policy = await automationPolicy(env), id = input.text('execution'), version = input.integer('version')!
  insist(policy.version === version, 'policy_changed', 409)
  const execution = await one(env, 'SELECT * FROM beam_automation_executions WHERE id=?', id)
  insist(execution && execution.state === 'blocked', 'execution_not_waiting', 409)
  await commit(env, [stmt(env, 'UPDATE beam_automation_executions SET approved_version=?, approved_by=? WHERE id=? AND state=\'blocked\' AND (SELECT version FROM beam_automation_policy WHERE id=1)=?', version, actor.id, id, version)], { actor, action: 'automation.approve', subject: id, detail: { version, event: execution.event_key } })
  return { id, version }
}

export async function automationControlView(env: Bindings, actor: Actor) {
  requireOwner(actor)
  const [policy, controls, executions, versions, attempts] = await Promise.all([
    automationPolicy(env), all(env, 'SELECT kind, rule_id AS rule, mode FROM beam_automation_controls'),
    all(env, `SELECT x.*, m.name AS learnerName FROM beam_automation_executions x JOIN beam_members m ON m.id=x.learner_id ORDER BY x.updated_at DESC,x.rowid DESC LIMIT 100`),
    all(env, 'SELECT version, settings_json AS settings, at FROM beam_automation_policy_versions ORDER BY version DESC LIMIT 100'),
    all(env, 'SELECT a.* FROM beam_automation_attempts a ORDER BY a.at DESC,a.rowid DESC LIMIT 200'),
  ])
  const { timezone } = await requireBusiness(env), day = localDate(now(), timezone)
  const reserved = await reservedAutomationBudget(env, day)
  return { policy: { ...policy, currency: 'USD' }, budget: { currency: 'USD', day, timezone, ...reserved,
    dailySpendLimitCents: policy.dailySpendLimitCents, estimatedRemainingCents: Math.max(0, policy.dailySpendLimitCents - reserved.estimatedReservedCents) },
    controls, executions: executions.map(row => ({ ...row, input: JSON.parse(row.input_json) }) as Row), versions: versions.map(row => ({ ...row, settings: JSON.parse(row.settings) })), attempts }
}
