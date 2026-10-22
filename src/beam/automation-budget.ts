// AUTO-008 estimates, not invoices. Rejection, interruption or uncertainty never
// releases a provider reservation; only the next employer calendar day resets it.
import type { Bindings } from '../auth.server'
import { insist, one } from './core'

export const MAX_AUTOMATION_CENTS = 1_000_000_000

export function estimatedAutomationSpend(input: unknown) {
  if (!input || typeof input !== 'object' || !Object.hasOwn(input, 'externalSpendCents')) return 0
  const cents = (input as { externalSpendCents: unknown }).externalSpendCents
  insist(typeof cents === 'number' && Number.isSafeInteger(cents) && cents >= 0 && cents <= MAX_AUTOMATION_CENTS,
    'invalid_automation_spend_estimate')
  return cents
}

export async function reservedAutomationBudget(env: Bindings, day: string) {
  return (await one<{ estimatedReservedCents: number; reservedAttempts: number }>(env,
    `SELECT COALESCE(SUM(external_spend_cents),0) AS estimatedReservedCents,
      COALESCE(SUM(charged),0) AS reservedAttempts FROM beam_automation_attempts WHERE day=? AND charged=1`, day))!
}

export const usdCents = (cents: number) => `USD ${(cents / 100).toFixed(2)}`
