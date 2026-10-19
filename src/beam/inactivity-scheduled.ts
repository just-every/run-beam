// AUTO-007: trusted cron authority is an explicit Base policy approval, never an owner cookie.
import { operatorAuth, type Bindings } from '../auth.server'
import { AuthError, type RolePolicy } from '../modules/operator-auth/index.mjs'
import type { ScheduledPolicy } from '../modules/operator-auth/scheduled/index.mjs'
import { requireOwner, type Actor } from './actor'
import { insist, one } from './core'
import type { Input } from './input'
import { inactivityPolicy, plan, runInactivity } from './inactivity'

export const INACTIVITY_POLICY = 'beam-inactivity'
export async function inactivityAuth(env: Bindings) {
  const policy = await inactivityPolicy(env)
  const definition: ScheduledPolicy | null = policy ? {
    id: INACTIVITY_POLICY, kind: 'beam-reviewed-inactivity.v1',
    parameters: { ...policy, schedule: '0 8 * * *', noticeUnit: 'elapsed-24-hour-days', inactivityUnit: 'employer-calendar-days' },
    maxActionsPerRun: 100, minIntervalMinutes: 1380,
    // Beam checks the exact employer-calendar window; Base also fences any sign-in within the last 24 hours atomically.
    actions: [{ action: 'operators:deactivate', scope: { roles: ['admin', 'member'], inactiveDays: 1 } }],
  } : null
  const guard: RolePolicy = async ({ action, target }) => {
    if (action !== 'operators:deactivate') return false
    if (!target) return true // owner review of the declared action
    const live = await inactivityPolicy(env)
    if (!live?.enabled || live.version !== policy?.version || live.previewedVersion !== live.version) return false
    const person = await one(env, 'SELECT id FROM beam_members WHERE operator_id = ?', target.id)
    return !!person && (await plan(env, live)).deactivate.some(notice => notice.member === person.id)
  }
  return operatorAuth(env, () => definition ? [definition] : [], guard)
}

export async function approvePolicy(env: Bindings, actor: Actor, input: Input, request: Request) {
  requireOwner(actor)
  const policy = await inactivityPolicy(env)
  insist(policy?.enabled && policy.previewedVersion === policy.version, 'preview_and_enable_required', 409)
  return (await inactivityAuth(env)).scheduledPolicies!.approve(request, { policyId: INACTIVITY_POLICY, versionHash: input.text('versionHash') })
}
export async function revokePolicy(env: Bindings, actor: Actor, input: Input, request: Request) {
  requireOwner(actor)
  await (await inactivityAuth(env)).scheduledPolicies!.revoke(request, { approvalId: input.text('approvalId') })
  return { revoked: true }
}
export async function scheduledInactivity(env: Bindings) {
  const auth = await inactivityAuth(env)
  try {
    await auth.scheduledPolicies!.run(INACTIVITY_POLICY, async capability => {
      await runInactivity(env, capability.actor, async notice => {
        const person = await one(env, 'SELECT operator_id FROM beam_members WHERE id = ?', notice.member)
        insist(person?.operator_id, 'person_not_found', 404)
        await capability.execute('operators:deactivate', person.operator_id)
      }, 100)
    })
  } catch (error) {
    // Base already recorded refused ticks. Infrastructure failures must still fail the job.
    if (!(error instanceof AuthError)) throw error
  }
}
