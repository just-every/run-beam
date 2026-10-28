import { authConfig, operatorAuth, type Bindings } from '../../auth.server.ts'
import { operatorAuthPeople, ToolRefusal, type PeopleAdapter, type Person, type ToolContext } from '../../modules/agent-door/index.ts'
import { entraSessionAllowed } from '../entra/session.ts'
import { currentActor, resolveAuthority, type Actor } from '../actor.ts'
import { one, BeamError } from '../core.ts'
import { agentApplicationActor } from '../app-credentials.ts'
import { liveSession } from '../agent-credentials.ts'
type BeamPerson = Person & { policyRole: 'owner' | 'editor' | null }

/** Business subjects resolve to OA ids, then to the actual learning member id. */
export function beamPeople(env: Bindings): PeopleAdapter {
  const operators = operatorAuthPeople({ db: env.DB, allowList: authConfig(env).allowList, session: request => operatorAuth(env).getSession(request) })
  const member = async (operatorId: string): Promise<BeamPerson | null> => {
    const operator = await operators.person(operatorId)
    const row = await one(env, 'SELECT id,name,employment,erasure_pending,erased_at FROM beam_members WHERE operator_id=?', operatorId)
    if (!operator || !row) return null
    return { ...operator, id: row.id, name: row.name, policyRole: (await operators.businessMember!(operator))?.role ?? null, active: operator.active && row.employment !== 'terminated' && !row.erasure_pending && !row.erased_at && await entraSessionAllowed(env, operatorId) }
  }
  const operatorFor = async (person: Person) => {
    const row = await one(env, 'SELECT operator_id FROM beam_members WHERE id=?', person.id)
    return row?.operator_id ? operators.person(row.operator_id) : null
  }
  return {
    async sponsor(claims) { const operator = await operators.sponsor(claims); return operator ? member(operator.id) : null },
    async person(id) { const row = await one(env, 'SELECT operator_id FROM beam_members WHERE id=?', id); return row?.operator_id ? member(row.operator_id) : null },
    async session(request) {
      if (request.headers.has('authorization')) return null
      try { const actor = await currentActor(env, request); return actor && !actor.viewAs ? this.person(actor.id) : null } catch { return null }
    },
    businessRole: person => person.role === 'owner' ? 'owner' : (person as BeamPerson).policyRole ?? null,
    async businessMember(person) { const operator = await operatorFor(person); return operator ? operators.businessMember!(operator) : null },
  }
}

export async function nativeActor(env: Bindings, person: Person, agent = true): Promise<Actor> {
  const live = await beamPeople(env).person(person.id)
  if (!live?.active) throw new ToolRefusal('unauthenticated')
  const row = await one<{ id: string; name: string; business: string | null }>(env, 'SELECT id,name,(SELECT name FROM beam_business WHERE singleton=1) AS business FROM beam_members WHERE id=?', live.id)
  return resolveAuthority(env, row!, { sessionId: '', sessionKind: 'agent-door', email: live.email, owner: live.role === 'owner', agent })
}

export async function callActor(env: Bindings, ctx: ToolContext) {
  let actor = await nativeActor(env, ctx.person)
  if (ctx.agent.id.startsWith('beam-app:')) actor = await native(() => agentApplicationActor(env, ctx.agent.id.slice(9), ctx.person.id))
  if (ctx.agent.id.startsWith('beam-preparation:')) {
    const [sessionId, expires] = ctx.agent.id.slice(17).split(':')
    const session = await liveSession(env, sessionId)
    const linked = session && await one(env, 'SELECT id FROM beam_members WHERE operator_id=?', session.operatorId)
    if (!session || linked?.id !== ctx.person.id || Number(expires) <= Date.now()) throw new ToolRefusal('unauthenticated')
    actor.sessionId = sessionId
  }
  actor.preparedBy = { ...ctx.actor, approvers: ctx.approvers }
  return actor
}

export async function native<T>(run: () => Promise<T>): Promise<T> {
  try { return await run() } catch (error) {
    if (error instanceof BeamError) throw new ToolRefusal(error.code, error.code, { status: error.status })
    throw error
  }
}
