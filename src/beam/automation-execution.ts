// AUTO-008: reserve before acting. Automatic events never retry a recorded
// failure; only an explicit replay can try again, under the current policy.
import type { Bindings } from '../auth.server'
import { automationPolicy } from './automation-policy'
import { all, BeamError, commit, newId, now, one, stmt, type Row } from './core'
import { requireBusiness } from './people'
import { localDate } from './time'

interface Execution {
  kind: 'follow_on' | 'audience' | 'notification' | 'upkeep' | 'escalation' | 'renewal' | 'webhook'; rule: string; event: string; learner: string;
  authority: string; unit: string | null; input: unknown; manual: boolean; authorized?: () => Promise<boolean>
}

export async function controlledExecution(env: Bindings, work: Execution, perform: (artifact: string) => Promise<string>) {
  const policy = await automationPolicy(env), at = now(), business = await requireBusiness(env)
  const input = JSON.stringify(work.input)
  let execution = await one(env, 'SELECT * FROM beam_automation_executions WHERE kind=? AND rule_id=? AND event_key=?', work.kind, work.rule, work.event)
  if (execution?.state === 'succeeded') return 'already_ran'
  if (execution?.state === 'running') return 'outcome_unknown'
  if (execution && !work.manual) return execution.outcome
  if (!execution) {
    const id = newId()
    await env.DB.prepare(`INSERT OR IGNORE INTO beam_automation_executions(id,kind,rule_id,event_key,learner_id,input_json,artifact_id,policy_version,state,outcome,at,updated_at) VALUES(?,?,?,?,?,?,?,?, 'blocked','waiting',?,?)`)
      .bind(id, work.kind, work.rule, work.event, work.learner, input, newId(), policy.version, at, at).run()
    execution = (await one(env, 'SELECT * FROM beam_automation_executions WHERE kind=? AND rule_id=? AND event_key=?', work.kind, work.rule, work.event))!
  }
  const day = localDate(at, business.timezone)
  const record = async (outcome: string, failure: string, state = 'blocked') => {
    await commit(env, [
      stmt(env, "UPDATE beam_automation_executions SET state=?,outcome=?,failure=?,policy_version=?,updated_at=? WHERE id=? AND state NOT IN ('running','succeeded')", state, outcome, failure, policy.version, at, execution!.id),
      stmt(env, 'INSERT INTO beam_automation_attempts VALUES(?,?,?,?,0,?,?,?)', newId(), execution!.id, policy.version, day, outcome, failure, at),
    ], { actor: work.authority, action: 'automation.execution', subject: execution!.id, detail: { rule: work.rule, event: work.event, policyVersion: policy.version, outcome, failure } })
    return outcome
  }
  // Enabling authority is rechecked on every attempt, including manual replay.
  const authority = work.authorized ? await work.authorized() : await one(env, `SELECT 1 FROM beam_members m JOIN oa_operators o ON o.id=m.operator_id WHERE m.id=?1 AND o.status='active' AND (o.role='owner' OR (?2 IS NOT NULL AND EXISTS(SELECT 1 FROM beam_admin_grants g WHERE g.member_id=m.id AND g.unit_id=?2 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?3))))`, work.authority, work.unit, at)
  if (!authority) return await record('scope_revoked', 'The enabling administrator no longer has access. An authorized administrator must enable the rule again.')
  if (policy.paused) return await record('paused', 'The owner paused all automation. Resume the policy, then replay explicitly.')
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: business.timezone, hour: '2-digit', hourCycle: 'h23' }).format(at))
  const quiet = policy.quietStart < policy.quietEnd ? hour >= policy.quietStart && hour < policy.quietEnd : policy.quietStart > policy.quietEnd && (hour >= policy.quietStart || hour < policy.quietEnd)
  if (quiet) return await record('quiet_hours', 'Wait until employer quiet hours end, then replay explicitly.')
  const mode = await one(env, 'SELECT mode FROM beam_automation_controls WHERE kind=? AND rule_id=?', work.kind, work.rule)
  if (execution.input_json !== input) {
    await env.DB.prepare('UPDATE beam_automation_executions SET input_json=?,approved_version=NULL,approved_by=NULL WHERE id=? AND state=\'blocked\'').bind(input, execution.id).run()
    execution.approved_version = null
  }
  if (mode?.mode === 'approval' && execution.approved_version !== policy.version) return await record('approval_required', 'The owner must approve this event at the current policy version, then replay it.')
  const attempt = newId()
  const [reserved] = await env.DB.batch([
    stmt(env, `UPDATE beam_automation_executions SET state='running',outcome='reserved',failure=NULL,policy_version=?,updated_at=? WHERE id=? AND state NOT IN ('running','succeeded') AND (SELECT version FROM beam_automation_policy WHERE id=1)=? AND (SELECT COALESCE(SUM(charged),0) FROM beam_automation_attempts WHERE day=?)<?`, policy.version, at, execution.id, policy.version, day, policy.dailyLimit),
    stmt(env, "INSERT INTO beam_automation_attempts SELECT ?,?,?,?,1,'reserved',NULL,? WHERE changes()=1", attempt, execution.id, policy.version, day, at),
  ])
  if (reserved.meta.changes !== 1) {
    const latest = await one(env, 'SELECT state FROM beam_automation_executions WHERE id=?', execution.id)
    if (latest?.state === 'running' || latest?.state === 'succeeded') return 'already_ran'
    return await record('rate_limited', 'The daily action limit is reached (zero blocks all actions). Increase it or wait for the next employer day, then replay.')
  }
  let outcome: string, failure: string | null = null
  try { outcome = await perform(execution.artifact_id) }
  catch (error) {
    outcome = 'failed'
    failure = error instanceof BeamError ? `${error.code}: correct the requirement or rule, then replay explicitly.` : 'Execution failed. Inspect the requirement and rule before explicitly replaying; no automatic retry was made.'
  }
  await commit(env, [
    stmt(env, "UPDATE beam_automation_executions SET state=?,outcome=?,failure=?,updated_at=? WHERE id=? AND state='running'", failure ? 'failed' : 'succeeded', outcome, failure, now(), execution.id),
    stmt(env, 'UPDATE beam_automation_attempts SET outcome=?,failure=? WHERE id=?', outcome, failure, attempt),
  ], { actor: work.authority, action: 'automation.execution', subject: execution.id, detail: { rule: work.rule, event: work.event, input: work.input, policyVersion: policy.version, outcome, failure, replay: work.manual } })
  return outcome
}
