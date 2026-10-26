import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { automationPolicy } from './automation-policy'
import { providerBudgetWindow, reservedAutomationBudget, reservedProviderCentsSql } from './automation-budget'
import { BeamError, commit, insist, newId, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { openSecret, sealSecret } from './integration-secrets'
import { modelConfiguration, modelOwner } from './model-account'
import { callModel, MODEL, MODEL_ESTIMATE_CENTS, type ModelRequest } from './model-provider'
import { requireBusiness } from './people'
import { localDate } from './time'
export type ModelContext = { kind: 'course' | 'locale'; course: string; digest: string; sources?: string[]; scope?: 'tutor'; resultId?: string;
  revision?: string; grants?: string[]; consentVersion?: number; consentAt?: number }
export async function modelPreview(env: Bindings, actor: Actor, context: ModelContext) {
  modelOwner(actor)
  const config = await modelConfiguration(env)
  insist(config?.enabled && config.key_cipher, 'model_disabled', 409)
  insist(config.max_cost_cents >= MODEL_ESTIMATE_CENTS, 'model_budget_required', 409)
  const business = await requireBusiness(env), policy = await automationPolicy(env), day = localDate(now(), business.timezone)
  const reserved = await reservedAutomationBudget(env, day, business.timezone)
  const approval = { ...context, id: newId(), owner: actor.id, session: actor.sessionId, expiresAt: now() + 15 * 60_000,
    configVersion: config.version, estimateCents: MODEL_ESTIMATE_CENTS, maxCostCents: config.max_cost_cents, model: MODEL }
  return { ...context, approval: await sealSecret(env, JSON.stringify(approval), 'model:approval'), model: MODEL,
    estimateCents: MODEL_ESTIMATE_CENTS, maxCostCents: config.max_cost_cents, expiresAt: approval.expiresAt, currency: 'USD',
    budget: { day, timezone: business.timezone, ceilingCents: policy.dailySpendLimitCents,
      estimatedReservedCents: reserved.estimatedReservedCents, estimatedRemainingCents: Math.max(0, policy.dailySpendLimitCents - reserved.estimatedReservedCents) } }
}
async function requireLiveModelOwner(env: Bindings, actor: Actor) {
  insist(await one(env, `SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id
    JOIN beam_members m ON m.operator_id=o.id WHERE s.id=? AND m.id=? AND s.revoked_at IS NULL AND s.expires_at>?
      AND s.operator_version=o.version AND o.role='owner' AND o.status='active'
      AND m.erased_at IS NULL AND m.erasure_pending=0`, actor.sessionId, actor.id, now()), 'model_owner_session_ended', 409)
}
export async function executeModel<T>(env: Bindings, actor: Actor, input: Input, context: ModelContext, request: ModelRequest, consume: (value: unknown, runId: string) => Promise<T>, beforeSend?: () => Promise<void>) {
  modelOwner(actor); insist(input.flag('consent'), 'model_consent_required', 409)
  let approval: Row
  try { approval = JSON.parse(await openSecret(env, input.text('approval', { max: 16000 }), 'model:approval')) }
  catch { throw new BeamError('model_approval_invalid', 409) }
  insist(approval.owner === actor.id && approval.session === actor.sessionId && approval.expiresAt > now(), 'model_approval_expired', 409)
  const config = await modelConfiguration(env)
  insist(config?.enabled && config.key_cipher && config.version === approval.configVersion, 'model_disabled', 409)
  insist(context.resultId === approval.resultId && context.scope === approval.scope && context.kind === approval.kind && context.course === approval.course && context.digest === approval.digest &&
    context.revision === approval.revision && context.consentVersion === approval.consentVersion && context.consentAt === approval.consentAt &&
    JSON.stringify(context.grants ?? []) === JSON.stringify(approval.grants ?? []) &&
    JSON.stringify(context.sources ?? []) === JSON.stringify(approval.sources ?? []) && approval.model === MODEL &&
    approval.estimateCents === MODEL_ESTIMATE_CENTS && approval.maxCostCents === config.max_cost_cents &&
    input.integer('estimateCents') === approval.estimateCents && input.integer('maxCostCents') === approval.maxCostCents, 'model_approval_mismatch', 409)
  insist(JSON.stringify(request.data).length <= 150_000, 'model_input_limit', 422)
  const key = await openSecret(env, config.key_cipher, 'model:openai')
  const business = await requireBusiness(env), at = now(), day = localDate(at, business.timezone), window = providerBudgetWindow(day, business.timezone)
  insist(approval.expiresAt > at, 'model_approval_expired', 409)
  const lineage = { ...context, run: approval.id, model: MODEL, configVersion: config.version,
    estimateCents: MODEL_ESTIMATE_CENTS, maxCostCents: config.max_cost_cents, reservationDay: day, timezone: business.timezone }
  let reserved: D1Result[]
  try {
    reserved = await env.DB.batch([
      stmt(env, `INSERT INTO beam_model_runs(id,kind,course_id,digest,model,state,approved_by,approved_at,config_version,estimate_cents,max_cost_cents,purpose,result_id)
        SELECT ?1,?2,?3,?4,?5,'running',?6,?7,?8,?9,?10,?11,?12
        WHERE EXISTS(SELECT 1 FROM beam_model_config WHERE singleton=1 AND enabled=1 AND version=?8)
          AND ${reservedProviderCentsSql('?13', '?14', '?15')} <=(SELECT daily_spend_limit_cents FROM beam_automation_policy WHERE id=1)-?9`,
        approval.id, context.kind, context.course, context.digest, MODEL, actor.id, at, config.version,
        MODEL_ESTIMATE_CENTS, config.max_cost_cents, context.scope ?? 'preparation', context.resultId ?? null, day, window.start, window.end),
      stmt(env, `INSERT INTO beam_audit(at,actor,action,subject,detail,via)
        SELECT ?,?,'model.approve',?,json_set(?,'$.policyVersion',(SELECT version FROM beam_automation_policy WHERE id=1),
          '$.ceilingCents',(SELECT daily_spend_limit_cents FROM beam_automation_policy WHERE id=1)),NULL WHERE changes()=1`, at, actor.id, context.course, JSON.stringify(lineage)),
      stmt(env, `INSERT INTO beam_model_run_sources(run_id,source_version_id)
        SELECT ?,value FROM json_each(?) WHERE changes()=1`, approval.id, JSON.stringify([...new Set(context.sources ?? [])])),
    ])
  } catch { throw new BeamError('model_approval_used_or_active', 409) }
  if (reserved[0].meta.changes !== 1) {
    insist(!await one(env, 'SELECT 1 FROM beam_model_runs WHERE id=?', approval.id), 'model_approval_used_or_active', 409)
    const live = await modelConfiguration(env)
    insist(live?.enabled && live.version === approval.configVersion, 'model_disabled', 409)
    throw new BeamError('model_daily_budget_exceeded', 409)
  }
  // Retain the exact reservation policy in all later audit events, even if the
  // owner changes limits while the provider is processing this request.
  const approved = await one(env, "SELECT detail FROM beam_audit WHERE action='model.approve' AND json_extract(detail,'$.run')=? ORDER BY rowid DESC LIMIT 1", approval.id)
  insist(approved, 'model_reservation_missing', 409)
  const audit = JSON.parse(approved.detail)
  try {
    const live = await modelConfiguration(env)
    insist(live?.enabled && live.version === approval.configVersion, 'model_disabled', 409)
    await requireLiveModelOwner(env, actor)
    await beforeSend?.()
    const output = await callModel(key, request)
    const after = await modelConfiguration(env)
    insist(after?.enabled && after.version === approval.configVersion, 'model_disabled', 409)
    await requireLiveModelOwner(env, actor)
    const result = await consume(output.value, approval.id)
    await commit(env, [stmt(env, "UPDATE beam_model_runs SET state='completed',completed_at=?,usage_json=?,provider_response_id=?,result_id=? WHERE id=? AND state='running'",
      now(), JSON.stringify(output.usage), output.providerResponseId, (result as any)?.id ?? null, approval.id)],
      { actor, action: 'model.completed', subject: context.course, detail: { ...audit, usage: output.usage, providerResponseId: output.providerResponseId } })
    return result
  } catch (error) {
    const failure = error instanceof BeamError ? error.code : 'model_request_failed'
    await commit(env, [stmt(env, "UPDATE beam_model_runs SET state='failed',completed_at=?,failure=? WHERE id=? AND state='running'", now(), failure, approval.id)],
      { actor, action: 'model.failed', subject: context.course, detail: { ...audit, failure, billing: 'unknown' } })
    throw new BeamError(failure, 502)
  }
}
