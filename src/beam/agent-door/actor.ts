import type { Bindings } from '../../auth.server'
import type { ToolContext } from '../../modules/agent-door/types'
import { resolveAuthority, type Actor, type Role } from '../actor'
import { all, insist, now, one } from '../core'
import { nativeMember, people, type NativeMember } from './people'

const appTools: Record<string, { native: string; roles: Role[] }> = {
  'beam.material.search': { native: 'search_material', roles: [] },
  'beam.report.read': { native: 'read_report', roles: ['manager'] },
  'beam.draft.propose': { native: 'propose_course_change', roles: ['author'] },
}

async function applicationAuthority(env: Bindings, ctx: ToolContext, member: NativeMember, tool: string): Promise<Actor> {
  const id = ctx.clientId!.slice('app:'.length)
  const grant = await one<{ name: string; issued_by: string; tools_json: string; teams_json: string }>(env,
    "SELECT name,issued_by,tools_json,teams_json FROM beam_app_credentials WHERE id=? AND audience='mcp' AND revoked_at IS NULL AND restored_at IS NULL AND expires_at>?", id, now())
  insist(grant && grant.issued_by === member.id && member.nativeRole === 'owner', 'invalid_application_credential', 401)
  const allowed = appTools[tool], tools = JSON.parse(grant.tools_json) as string[]
  insist(allowed && tools.includes(allowed.native), 'tool_not_granted', 403)
  const configuredTeams = JSON.parse(grant.teams_json) as string[]
  const teams = configuredTeams.length ? configuredTeams : null
  const learners = teams && (await all<{ member_id: string }>(env,
    'SELECT DISTINCT member_id FROM beam_team_members WHERE team_id IN (SELECT value FROM json_each(?))', JSON.stringify(teams))).map(row => row.member_id)
  return { id: member.id, name: member.name, email: member.email, business: member.business,
    sessionId: ctx.clientId!, sessionKind: 'application', owner: false, agent: true,
    roles: new Set(allowed.roles), adminUnits: [], authorOf: [], managedTeams: [], teams, learners,
    grants: {}, auditor: false, instructor: false, app: { id, name: grant.name, audience: 'mcp', tools } }
}

async function preparationSession(env: Bindings, ctx: ToolContext, member: NativeMember) {
  const match = /^preparation:([^:]+):(\d+)$/.exec(ctx.clientId!)
  insist(match, 'invalid_agent_credential', 401)
  const expiresAt = Number(match[2])
  insist(Number.isSafeInteger(expiresAt) && expiresAt > now(), 'invalid_agent_credential', 401)
  const session = await one<{ id: string; expiresAt: number }>(env, `SELECT s.id,s.expires_at AS expiresAt
    FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id
    WHERE s.id=? AND s.operator_id=? AND s.revoked_at IS NULL AND s.expires_at>?
      AND s.kind IN ('native','oidc') AND o.status='active' AND s.operator_version=o.version
      AND (s.kind<>'oidc' OR EXISTS(SELECT 1 FROM oa_provider_sessions p JOIN oa_auth_settings a
        ON a.singleton=1 AND a.idp_sign_in=1 AND a.generation=p.generation WHERE p.session_id=s.id))`,
  match[1], member.operatorId, now())
  insist(session && expiresAt <= session.expiresAt, 'invalid_agent_credential', 401)
  return session.id
}

/** Door policy admits an operation; native learning roles still authorize its exact effect. */
export async function actorFor(env: Bindings, ctx: ToolContext, tool: string): Promise<Actor> {
  insist(ctx.scopes.includes(tool), 'agent_scope_forbidden', 403)
  const member = await nativeMember(env, ctx.person.id)
  insist(member?.active, 'authentication_required', 401)
  if (ctx.consent) insist(await people(env).businessMember!(member), 'authentication_required', 401)
  insist(ctx.actor.for.id === member.id && ctx.actor.agent.id === ctx.agent.id, 'invalid_delegation', 403)
  let actor: Actor
  if (!ctx.consent && ctx.clientId?.startsWith('app:')) actor = await applicationAuthority(env, ctx, member, tool)
  else {
    const preparation = !ctx.consent && ctx.clientId?.startsWith('preparation:')
    insist(ctx.consent || !ctx.clientId || preparation, 'invalid_agent_credential', 401)
    const sessionId = preparation ? await preparationSession(env, ctx, member) : `door:${ctx.operationId}`
    actor = await resolveAuthority(env, member, { sessionId, sessionKind: 'agent', email: member.email,
      owner: member.nativeRole === 'owner', agent: true })
    if (tool !== 'beam.identity.read') insist(['author', 'reviewer', 'manager'].some(role => actor.roles.has(role as Role)), 'forbidden', 403)
  }
  actor.door = { agent: { ...ctx.actor.agent }, for: { ...ctx.actor.for }, label: ctx.actor.label,
    operationId: ctx.operationId, door: ctx.door, ...(ctx.clientId ? { clientId: ctx.clientId } : {}),
    approvers: ctx.approvers.map(person => ({ ...person })) }
  return actor
}
