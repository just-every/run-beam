// OPS-009: distinguish Beam charges, owner-declared provider estimates and actual provider billing.
import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'
import { automationPolicy } from './automation-policy'
import { reservedAutomationBudget } from './automation-budget'
import { requireBusiness } from './people'
import { now } from './core'
import { localDate } from './time'

export async function providerCosts(env: Bindings, actor: Actor) {
  requireOwner(actor)
  const mail = env.MAIL_PROVIDER && env.MAIL_PROVIDER !== 'development' ? env.MAIL_PROVIDER : null
  const business = await requireBusiness(env), policy = await automationPolicy(env)
  const budget = await reservedAutomationBudget(env, localDate(now(), business.timezone))
  return {
    currency: 'USD', spentCents: 0, ceilingCents: policy.dailySpendLimitCents,
    estimatedReservedCents: budget.estimatedReservedCents, timezone: business.timezone,
    providers: mail ? [{ kind: 'mail', provider: mail, billing: 'employer_account', chargedByBeamCents: 0 }] : [],
    note: 'Beam charges no provider fee. Your provider bills your employer account directly. Automation reserves the owner’s declared per-call USD estimate, including rejected or uncertain requests; these estimates are not provider invoices or proof of delivery.',
  }
}
