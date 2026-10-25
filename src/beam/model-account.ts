import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { all, commit, insist, now, one, stmt, type Row } from './core'
import type { Input } from './input'
import { openSecret, sealSecret } from './integration-secrets'
import { MODEL, MODEL_ESTIMATE_CENTS } from './model-provider'

export function modelOwner(actor: Actor) {
  requireOwner(actor)
  insist(!actor.agent && !actor.app && !actor.viewAs, 'human_owner_required', 403)
}
export const modelConfiguration = (env: Bindings) => one(env, 'SELECT * FROM beam_model_config WHERE singleton=1')
export async function modelAccount(env: Bindings, actor: Actor) {
  modelOwner(actor)
  const config = await modelConfiguration(env)
  const runs = await all(env, 'SELECT * FROM beam_model_runs ORDER BY approved_at DESC LIMIT 50')
  const totals = await one(env, `SELECT count(*) requests,coalesce(sum(estimate_cents),0) reserved,coalesce(sum(json_extract(usage_json,'$.estimatedCostCents')),0) usage FROM beam_model_runs`)
  return { enabled: config?.enabled === 1, hasKey: !!config?.key_cipher, version: config?.version ?? 0,
    maxCostCents: config?.max_cost_cents ?? MODEL_ESTIMATE_CENTS, model: MODEL, estimateCents: MODEL_ESTIMATE_CENTS, currency: 'USD',
    requests: totals?.requests ?? 0, reservedEstimateCents: totals?.reserved ?? 0, usageEstimateCents: totals?.usage ?? 0,
    runs: runs.map(({ usage_json, ...run }): Row => ({ ...run, usage: usage_json ? JSON.parse(usage_json) : null })) }
}
export async function configureModel(env: Bindings, actor: Actor, input: Input) {
  modelOwner(actor)
  const operation = input.text('operation'), current = await modelConfiguration(env)
  insist(['enable', 'disable', 'rotate', 'revoke'].includes(operation), 'model_operation')
  const apiKey = input.text('apiKey', { optional: true, max: 512 })
  insist(!apiKey || /^[\x21-\x7e]+$/.test(apiKey), 'model_key_invalid')
  const enable = operation === 'enable', rotate = operation === 'rotate'
  if (enable || rotate) insist(input.flag('consent'), 'model_account_consent_required', 409)
  if (rotate) insist(apiKey, 'model_key_required')
  const cipher = operation === 'revoke' ? null : apiKey ? await sealSecret(env, apiKey, 'model:openai') : current?.key_cipher ?? null
  const cap = enable || rotate ? input.integer('maxCostCents', { min: MODEL_ESTIMATE_CENTS, max: 100_000 })! : current?.max_cost_cents ?? 0
  if (enable) { insist(cipher, 'model_key_required', 409); await openSecret(env, cipher, 'model:openai') }
  await commit(env, [stmt(env, `INSERT INTO beam_model_config VALUES(1,?,?,?,?,?,?) ON CONFLICT(singleton) DO UPDATE SET
    enabled=excluded.enabled,key_cipher=excluded.key_cipher,version=excluded.version,max_cost_cents=excluded.max_cost_cents,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
    enable ? 1 : 0, cipher, (current?.version ?? 0) + 1, cap, actor.id, now())],
  { actor, action: 'model.configure', subject: 'model', detail: { operation, model: MODEL, maxCostCents: cap } })
  return { enabled: enable, hasKey: !!cipher }
}
export async function closeModelRun(env: Bindings, actor: Actor, input: Input) {
  modelOwner(actor); insist(input.flag('consent'), 'model_consent_required', 409)
  const run = await one(env, "SELECT * FROM beam_model_runs WHERE id=? AND state='running'", input.text('run'))
  insist(run && run.approved_at + 120_000 < now(), 'model_request_still_pending', 409)
  await commit(env, [stmt(env, "UPDATE beam_model_runs SET state='failed',completed_at=?,failure='model_outcome_unknown' WHERE id=? AND state='running'", now(), run.id)],
    { actor, action: 'model.close_unknown', subject: run.id, detail: { billing: 'unknown' } })
  return { id: run.id, state: 'failed' }
}
