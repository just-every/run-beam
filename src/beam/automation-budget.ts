// AUTO-008 estimates, not invoices. Rejection, interruption or uncertainty never
// releases a provider reservation; only the next employer calendar day resets it.
import type { Bindings } from '../auth.server'
import { insist, one } from './core'
import { requireBusiness } from './people'
import { addDays, zonedInstant } from './time'

export const MAX_AUTOMATION_CENTS = 1_000_000_000

export function estimatedAutomationSpend(input: unknown) {
  if (!input || typeof input !== 'object' || !Object.hasOwn(input, 'externalSpendCents')) return 0
  const cents = (input as { externalSpendCents: unknown }).externalSpendCents
  insist(typeof cents === 'number' && Number.isSafeInteger(cents) && cents >= 0 && cents <= MAX_AUTOMATION_CENTS,
    'invalid_automation_spend_estimate')
  return cents
}

export function providerBudgetWindow(day: string, timezone: string) {
  return { start: zonedInstant(day, '00:00', timezone), end: zonedInstant(addDays(day, 1), '00:00', timezone) }
}

// Both paid doors embed this expression in their reservation statement. D1
// serializes the writes, so concurrent model and automation calls share one cap.
export const reservedProviderCentsSql = (day: string, start: string, end: string) => `(
  (SELECT COALESCE(SUM(external_spend_cents),0) FROM beam_automation_attempts WHERE day=${day} AND charged=1)
  + (SELECT COALESCE(SUM(estimate_cents),0) FROM beam_model_runs WHERE approved_at>=${start} AND approved_at<${end})
)`

export async function reservedAutomationBudget(env: Bindings, day: string, timezone?: string) {
  const window = providerBudgetWindow(day, timezone ?? (await requireBusiness(env)).timezone)
  return (await one<{ estimatedReservedCents: number; reservedAttempts: number; modelReservedCents: number }>(env,
    `SELECT ${reservedProviderCentsSql('?1', '?2', '?3')} AS estimatedReservedCents,
      (SELECT COALESCE(SUM(charged),0) FROM beam_automation_attempts WHERE day=?1) AS reservedAttempts,
      (SELECT COALESCE(SUM(estimate_cents),0) FROM beam_model_runs WHERE approved_at>=?2 AND approved_at<?3) AS modelReservedCents`,
    day, window.start, window.end))!
}

export const usdCents = (cents: number) => `USD ${(cents / 100).toFixed(2)}`
