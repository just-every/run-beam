import { createBusinessSettings } from '../../modules/business-settings/index.ts'
import { operatorAuth, type Bindings } from '../../auth.server.ts'
import { ensureMember } from '../actor.ts'
import { installationTrust } from './trust.ts'

export const beamBusinessManifest = { settings: 1 as const, values: ['display_name'] as const, team: { roles: { admin: 'admin', member: 'member' } } }

export function beamBusiness(env: Bindings) {
  const team = operatorAuth(env).businessTeam!
  const trust = installationTrust(env)
  return createBusinessSettings({ db: env.DB, trust: trust ? { v: 1, issuer: trust.issuer, audience: trust.appOrigin, subject: trust.installationId, keys: trust.publicKeys } : null, business: beamBusinessManifest,
    team: { ownerEmail: () => team.ownerEmail!(), async prepare(input) {
      const plan = await team.prepare(input)
      return { ...plan, async afterCommit() {
        // The native invitation lifecycle creates a learning member with its
        // normal learner role. Business admin never grants learning ownership.
        for (const row of plan.rows) if (row.operatorId && row.state !== 'conflict' && row.state !== 'inactive') {
          if (await env.DB.prepare('SELECT id FROM beam_members WHERE operator_id=?').bind(row.operatorId).first()) continue
          const operator = await env.DB.prepare('SELECT email,display_name AS name FROM oa_operators WHERE id=?').bind(row.operatorId).first<{ email: string; name: string }>()
          if (operator) await ensureMember(env, operator.email, operator.name, ['learner'])
        }
        await plan.afterCommit()
      } }
    } },
  })
}
