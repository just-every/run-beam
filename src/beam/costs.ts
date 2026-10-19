// OPS-009: provider costs in US dollars. Beam charges nothing itself and has no paid provider connection today; its
// unattended automation runs under AUTO-008's hard USD 0.00 external-spend ceiling. Mail goes through the employer's own
// provider account, which bills the employer directly, so Beam records no charge for it. A clause that adds a paid
// provider (model, media, package or library connections) reports its estimates and charges here, in USD, before it ships.
import type { Bindings } from '../auth.server'
import { requireOwner, type Actor } from './actor'

export function providerCosts(env: Bindings, actor: Actor) {
  requireOwner(actor)
  const mail = env.MAIL_PROVIDER && env.MAIL_PROVIDER !== 'development' ? env.MAIL_PROVIDER : null
  return {
    currency: 'USD', spentCents: 0, ceilingCents: 0,
    providers: mail ? [{ kind: 'mail', provider: mail, billing: 'employer_account', chargedByBeamCents: 0 }] : [],
    note: 'Beam has no paid provider connected. Automation may not spend: its external-spend ceiling is USD 0.00. Mail is billed by your own mail provider, not by Beam.',
  }
}
