import { authConfig, operatorAuth, type Bindings } from '../../auth.server'
import type { PeopleAdapter, Person, ToolContext } from '../../modules/agent-door/types'
import { isActiveOperator, type Operator } from '../../modules/operator-auth/index.mjs'
import type { Actor } from '../actor'
import { entraSessionAllowed } from '../entra/session'
import { insist, one } from '../core'
import { peopleWithOperators } from '../people'

export interface NativeMember extends Person {
  operatorId: string
  nativeRole: Operator['role']
  business: string | null
}

/** Native account IDs, rather than addresses in a token, bind the learning identity. */
export async function nativeMember(env: Bindings, memberId: string): Promise<NativeMember | null> {
  const row = await one<{
    id: string; name: string; operatorId: string; email: string; role: Operator['role'];
    status: Operator['status']; employment: string; erasedAt: number | null; erasurePending: number;
    business: string | null; businessRole: string | null
  }>(env, `SELECT m.id,m.name,o.id AS operatorId,o.email,o.role,o.status,m.employment,
    m.erased_at AS erasedAt,m.erasure_pending AS erasurePending,
    (SELECT name FROM beam_business WHERE singleton=1) AS business,
    (SELECT business_role FROM bs_team WHERE operator_id=o.id AND state IN ('active','invited')) AS businessRole
    FROM beam_members m JOIN oa_operators o ON o.id=m.operator_id WHERE m.id=?`, memberId)
  if (!row) return null
  const active = isActiveOperator({ email: row.email, status: row.status } as Operator, authConfig(env).allowList)
    && row.employment !== 'terminated' && !row.erasurePending && row.erasedAt === null
    && await entraSessionAllowed(env, row.operatorId)
  // A local OA promotion does not make someone a Business policy editor.
  return { id: row.id, name: row.name, email: row.email, active, nativeRole: row.role,
    role: row.role === 'owner' ? 'owner' : row.businessRole === 'admin' ? 'admin' : 'member',
    operatorId: row.operatorId, business: row.business }
}

async function installationOwner(env: Bindings) {
  // The native bootstrap claim is the durable owner identity. A later local
  // role transfer must never move an existing Business subject to another person.
  return one<{ id: string }>(env, 'SELECT claim_id AS id FROM oa_bootstrap WHERE singleton=1')
}

async function memberForOperator(env: Bindings, operatorId: string) {
  const member = await one<{ id: string }>(env, 'SELECT id FROM beam_members WHERE operator_id=?', operatorId)
  return member ? nativeMember(env, member.id) : null
}

export function people(env: Bindings): PeopleAdapter {
  return {
    person: id => nativeMember(env, id),
    businessRole: person => person.role === 'owner' ? 'owner' : person.role === 'admin' ? 'editor' : null,
    async sponsor({ sub }) {
      const settings = await one<{ owner_id: string | null }>(env, 'SELECT owner_id FROM bs_settings WHERE singleton=1')
      if (settings?.owner_id === sub) {
        const owner = await installationOwner(env)
        return owner ? memberForOperator(env, owner.id) : null
      }
      const row = await one<{ operator_id: string | null }>(env,
        "SELECT operator_id FROM bs_team WHERE business_id=? AND state IN ('active','invited')", sub)
      return row?.operator_id ? memberForOperator(env, row.operator_id) : null
    },
    async businessMember(person) {
      const current = await nativeMember(env, person.id)
      if (!current?.active) return null
      const [settings, owner] = await Promise.all([
        one<{ owner_id: string | null }>(env, 'SELECT owner_id FROM bs_settings WHERE singleton=1'),
        installationOwner(env),
      ])
      if (settings?.owner_id && owner?.id === current.operatorId) return { id: settings.owner_id, role: 'owner' }
      const row = await one<{ business_id: string; business_role: string | null }>(env,
        "SELECT business_id,business_role FROM bs_team WHERE operator_id=? AND state IN ('active','invited') AND business_id IS NOT NULL", current.operatorId)
      return row ? { id: row.business_id, role: row.business_role === 'admin' ? 'editor' : null } : null
    },
    async session(request) {
      const session = await operatorAuth(env).getSession(request)
      if (!session) return null
      const person = await memberForOperator(env, session.operator.id)
      return person?.active ? person : null
    },
  }
}

/** Reuse the native People projection with an explicitly authorized native account read. */
export async function peopleFor(env: Bindings, actor: Actor, ctx: ToolContext) {
  insist(actor.agent && actor.id === ctx.person.id, 'forbidden', 403)
  const member = await nativeMember(env, actor.id)
  insist(member?.active, 'authentication_required', 401)
  insist(!actor.owner || member.nativeRole === 'owner', 'forbidden', 403)
  const operators = actor.owner ? await operatorAuth(env).delegatedAdministration({
    personId: member.operatorId, auditLabel: ctx.actor.label, agentId: ctx.agent.id,
  }).listOperators() : []
  return peopleWithOperators(env, actor, operators)
}
