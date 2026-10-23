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
  const budget = await reservedAutomationBudget(env, localDate(now(), business.timezone))
  const ocrConfig = await one<{enabled:number;hasKey:number;max_cost_cents:number;total_budget_cents:number;account_mode:string}>(env, 'SELECT enabled,key_cipher IS NOT NULL AS hasKey,max_cost_cents,total_budget_cents,account_mode FROM beam_source_ocr_config WHERE singleton=1')
  const ocrTotals = await one<{requests:number;reserved:number;usage:number}>(env, `SELECT count(*) AS requests,coalesce(sum(CASE WHEN provider_attempted=1 THEN estimate_cents ELSE 0 END),0) AS reserved,coalesce(sum(json_extract(usage_json,'$.estimatedCostCents')),0) AS usage FROM beam_source_ocr_runs`)
  const ocr = ocrConfig?.hasKey || ocrTotals?.requests ? { enabled:ocrConfig?.enabled === 1, approvedMaximumCents:ocrConfig?.max_cost_cents ?? 0, totalBudgetCents:ocrConfig?.total_budget_cents ?? 0, accountMode:ocrConfig?.account_mode ?? 'production', requests:ocrTotals?.requests ?? 0, reservedEstimateCents:ocrTotals?.reserved ?? 0, usageEstimateCents:ocrTotals?.usage ?? 0, invoice:false } : null
  return {
    ocr, currency: 'USD', spentCents: 0, ceilingCents: policy.dailySpendLimitCents,
    estimatedReservedCents: budget.estimatedReservedCents, timezone: business.timezone,
    providers: [...mail ? [{ kind: 'mail', provider: mail, billing: 'employer_account', chargedByBeamCents: 0 }] : [], ...ocr ? [{ kind:'source_ocr', provider:'openai', billing:'employer_account', chargedByBeamCents:0 }] : []],
    note: 'Beam charges no provider fee. Your provider bills your employer account directly. Automation reserves the owner’s declared per-call USD estimate, including rejected or uncertain requests; these estimates are not provider invoices or proof of delivery.',
  }
}
