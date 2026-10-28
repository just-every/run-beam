// OPS-009: distinguish Beam charges, owner-declared provider estimates and actual provider billing.
import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { automationPolicy } from './automation-policy'
import { reservedAutomationBudget } from './automation-budget'
import { requireBusiness } from './people'
import { now, one } from './core'
import { localDate } from './time'

export async function providerCosts(env: Bindings, actor: Actor) {
  requireOwner(actor)
  const mail = env.MAIL_PROVIDER && env.MAIL_PROVIDER !== 'development' ? env.MAIL_PROVIDER : null
  const business = await requireBusiness(env), policy = await automationPolicy(env)
  const day = localDate(now(), business.timezone), budget = await reservedAutomationBudget(env, day, business.timezone)
  const ocrConfig = await one<{enabled:number;hasKey:number;max_cost_cents:number;total_budget_cents:number;account_mode:string}>(env, 'SELECT enabled,key_cipher IS NOT NULL AS hasKey,max_cost_cents,total_budget_cents,account_mode FROM beam_source_ocr_config WHERE singleton=1')
  const ocrTotals = await one<{requests:number;reserved:number;usage:number}>(env, `SELECT count(*) AS requests,coalesce(sum(CASE WHEN provider_attempted=1 THEN estimate_cents ELSE 0 END),0) AS reserved,coalesce(sum(json_extract(usage_json,'$.estimatedCostCents')),0) AS usage FROM beam_source_ocr_runs`)
  const ocr = ocrConfig?.hasKey || ocrTotals?.requests ? { enabled:ocrConfig?.enabled === 1, approvedMaximumCents:ocrConfig?.max_cost_cents ?? 0, totalBudgetCents:ocrConfig?.total_budget_cents ?? 0, accountMode:ocrConfig?.account_mode ?? 'production', requests:ocrTotals?.requests ?? 0, reservedEstimateCents:ocrTotals?.reserved ?? 0, usageEstimateCents:ocrTotals?.usage ?? 0, invoice:false } : null
  const modelConfig = await one(env, 'SELECT enabled,key_cipher IS NOT NULL AS hasKey,max_cost_cents FROM beam_model_config WHERE singleton=1')
  const modelTotals = await one(env, `SELECT count(*) requests,coalesce(sum(estimate_cents),0) reserved,coalesce(sum(json_extract(usage_json,'$.estimatedCostCents')),0) usage,
    count(CASE WHEN state!='completed' THEN 1 END) unknownRequests,
    coalesce(sum(CASE WHEN state!='completed' THEN estimate_cents ELSE 0 END),0) unknownReserved FROM beam_model_runs`)
  const model = modelConfig?.hasKey || modelTotals?.requests ? { enabled: modelConfig?.enabled === 1, approvedMaximumCents: modelConfig?.max_cost_cents ?? 0, requests: modelTotals?.requests ?? 0, reservedEstimateCents: modelTotals?.reserved ?? 0, usageEstimateCents: modelTotals?.usage ?? 0,
    unknownBillingRequests: modelTotals?.unknownRequests ?? 0, unknownBillingReservedCents: modelTotals?.unknownReserved ?? 0, billing: 'unknown', invoice: false } : null
  return {
    model, ocr, currency: 'USD', spentCents: 0, ceilingCents: policy.dailySpendLimitCents,
    estimatedReservedCents: budget.estimatedReservedCents, estimatedRemainingCents: Math.max(0, policy.dailySpendLimitCents - budget.estimatedReservedCents),
    modelReservedCents: budget.modelReservedCents, day, timezone: business.timezone,
    providers: [...mail ? [{ kind: 'mail', provider: mail, billing: 'employer_account', chargedByBeamCents: 0 }] : [], ...model ? [{ kind: 'model_preparation', provider: 'openai', billing: 'employer_account', chargedByBeamCents: 0 }] : [], ...ocr ? [{ kind:'source_ocr', provider:'openai', billing:'employer_account', chargedByBeamCents:0 }] : []],
    note: 'Beam charges no provider fee. Your provider bills your employer account directly. Model requests and automation share one employer-day estimated USD ceiling. Failed and unknown attempts keep their reservations. Provider billing remains unknown; usage estimates are not invoices or proof of delivery.',
  }
}
