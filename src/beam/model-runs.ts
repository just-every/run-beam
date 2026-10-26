import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import { BeamError, commit, insist, newId, now, stmt, type Row } from './core'
import type { Input } from './input'
import { openSecret, sealSecret } from './integration-secrets'
import { modelConfiguration, modelOwner } from './model-account'
import { callModel, MODEL, MODEL_ESTIMATE_CENTS, type ModelRequest } from './model-provider'
export type ModelContext = { kind: 'course' | 'locale'; course: string; digest: string; sources?: string[]; scope?: 'tutor'; resultId?: string }
export async function modelPreview(env: Bindings, actor: Actor, context: ModelContext) {
  modelOwner(actor)
  const config = await modelConfiguration(env)
  insist(config?.enabled && config.key_cipher, 'model_disabled', 409)
  insist(config.max_cost_cents >= MODEL_ESTIMATE_CENTS, 'model_budget_required', 409)
  const approval = { ...context, id: newId(), owner: actor.id, session: actor.sessionId, expiresAt: now() + 15 * 60_000,
    configVersion: config.version, estimateCents: MODEL_ESTIMATE_CENTS, maxCostCents: config.max_cost_cents, model: MODEL }
  return { ...context, approval: await sealSecret(env, JSON.stringify(approval), 'model:approval'), model: MODEL,
    estimateCents: MODEL_ESTIMATE_CENTS, maxCostCents: config.max_cost_cents, expiresAt: approval.expiresAt, currency: 'USD' }
}
export async function executeModel<T>(env: Bindings, actor: Actor, input: Input, context: ModelContext, request: ModelRequest, consume: (value: unknown, runId: string) => Promise<T>) {
  modelOwner(actor); insist(input.flag('consent'), 'model_consent_required', 409)
  let approval: Row
  try { approval = JSON.parse(await openSecret(env, input.text('approval', { max: 16000 }), 'model:approval')) }
  catch { throw new BeamError('model_approval_invalid', 409) }
  insist(approval.owner === actor.id && approval.session === actor.sessionId && approval.expiresAt > now(), 'model_approval_expired', 409)
  const config = await modelConfiguration(env)
  insist(config?.enabled && config.key_cipher && config.version === approval.configVersion, 'model_disabled', 409)
  insist(context.resultId === approval.resultId && context.scope === approval.scope && context.kind === approval.kind && context.course === approval.course && context.digest === approval.digest &&
    JSON.stringify(context.sources ?? []) === JSON.stringify(approval.sources ?? []) && approval.model === MODEL &&
    approval.estimateCents === MODEL_ESTIMATE_CENTS && approval.maxCostCents === config.max_cost_cents &&
    input.integer('estimateCents') === approval.estimateCents && input.integer('maxCostCents') === approval.maxCostCents, 'model_approval_mismatch', 409)
  insist(JSON.stringify(request.data).length <= 150_000, 'model_input_limit', 422)
  const key = await openSecret(env, config.key_cipher, 'model:openai')
  try { await commit(env, [stmt(env, `INSERT INTO beam_model_runs(id,kind,course_id,digest,model,state,approved_by,approved_at,config_version,estimate_cents,max_cost_cents,purpose,result_id)
    VALUES(?,?,?,?,?,'running',?,?,?,?,?,?,?)`, approval.id, context.kind, context.course, context.digest, MODEL, actor.id, now(), config.version, MODEL_ESTIMATE_CENTS, config.max_cost_cents, context.scope ?? 'preparation', context.resultId ?? null),
    ...[...new Set(context.sources ?? [])].map(source => stmt(env, 'INSERT INTO beam_model_run_sources VALUES(?,?)', approval.id, source))],
    { actor, action: 'model.approve', subject: context.course, detail: { run: approval.id, kind: context.kind, digest: context.digest, model: MODEL, estimateCents: MODEL_ESTIMATE_CENTS, maxCostCents: config.max_cost_cents } }) }
  catch { throw new BeamError('model_approval_used_or_active', 409) }
  try {
    const live = await modelConfiguration(env)
    insist(live?.enabled && live.version === approval.configVersion, 'model_disabled', 409)
    const output = await callModel(key, request)
    const after = await modelConfiguration(env)
    insist(after?.enabled && after.version === approval.configVersion, 'model_disabled', 409)
    const result = await consume(output.value, approval.id)
    await commit(env, [stmt(env, "UPDATE beam_model_runs SET state='completed',completed_at=?,usage_json=?,provider_response_id=?,result_id=? WHERE id=? AND state='running'",
      now(), JSON.stringify(output.usage), output.providerResponseId, (result as any)?.id ?? null, approval.id)],
      { actor, action: 'model.completed', subject: context.course, detail: { run: approval.id, usage: output.usage, providerResponseId: output.providerResponseId } })
    return result
  } catch (error) {
    const failure = error instanceof BeamError ? error.code : 'model_request_failed'
    await commit(env, [stmt(env, "UPDATE beam_model_runs SET state='failed',completed_at=?,failure=? WHERE id=? AND state='running'", now(), failure, approval.id)],
      { actor, action: 'model.failed', subject: context.course, detail: { run: approval.id, failure, billing: 'unknown' } })
    throw new BeamError(failure, 502)
  }
}
