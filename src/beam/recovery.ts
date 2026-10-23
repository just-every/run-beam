// Recovery uses current in-product HR, delivery and assessor facts. Coverage remains an ordinary human grant.
import type { Bindings } from '../auth.server'
import type { Actor } from './actor'
import type { Kind } from './agent-work'
import { commit, insist, now, one, stmt } from './core'
import { escalationQueue, runEscalations } from './escalations'
import { Input } from './input'
import { grantCoverage } from './managers'

async function currentRecovery(env: Bindings, actor: Actor, assignment: string, team: string) {
 const item = (await escalationQueue(env, actor)).find(row => row.assignment === assignment)
 insist(item, 'recovery_not_available', 409)
 insist(await one(env, 'SELECT 1 FROM beam_team_members WHERE team_id=? AND member_id=?', team, item.learner), 'recovery_team_mismatch', 403)
 insist(actor.owner || await one(env, "SELECT 1 FROM beam_team_managers WHERE team_id=? AND member_id=? AND kind='direct' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)", team, actor.id, now()), 'current_direct_manager_required', 403)
 return item
}

export const recoveryKind: Kind = {
 label: 'Overdue recovery', prepare: ['manager'],
 async validate(env, actor, value) {
  insist(value && typeof value === 'object' && !Array.isArray(value), 'invalid_recovery')
  const p = value as Record<string, unknown>
  insist(Object.keys(p).every(key => ['assignment', 'team', 'substitute', 'expiresOn'].includes(key)), 'unsupported_recovery_action')
  const input = Input.of(p), assignment = input.text('assignment'), team = input.text('team'), substitute = input.text('substitute'), expiresOn = input.text('expiresOn', { max: 10 })
  const facts = await currentRecovery(env, actor, assignment, team)
  insist(await one(env, "SELECT 1 FROM beam_members m JOIN oa_operators o ON o.id=m.operator_id WHERE m.id=? AND m.employment='active' AND o.status='active'", substitute), 'substitute_unavailable', 409)
  insist(/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) && Date.parse(expiresOn+'T23:59:59Z')>now(), 'coverage_end_required')
  return { assignment, team, substitute, expiresOn, originalDueAt: facts.dueAt,
   facts: { onLeave: facts.onLeave, noContactRoute: facts.noContactRoute, attemptsExhausted: facts.attemptsExhausted, missingAssessorCapacity: facts.missingAssessorCapacity, failures: facts.failures, currentManagers: facts.reachesNow },
   plan: 'Appoint the selected temporary manager to arrange a paid-work assessor slot after leave. Escalate through current delivery policy; retain the original deadline and assessment evidence. No assessment is passed and no date is backdated.',
   missing: ['Return date and a suitable paid-work slot need human confirmation. No provider calendar is inferred.'] }
 },
 async mayDecide(env, actor, payload) { await currentRecovery(env, actor, payload.assignment, payload.team) },
 async apply(env, actor, { payload }) {
  const facts = await currentRecovery(env, actor, payload.assignment, payload.team)
  insist(facts.dueAt === payload.originalDueAt && JSON.stringify({ onLeave: facts.onLeave, noContactRoute: facts.noContactRoute, attemptsExhausted: facts.attemptsExhausted, missingAssessorCapacity: facts.missingAssessorCapacity, failures: facts.failures, currentManagers: facts.reachesNow }) === JSON.stringify(payload.facts), 'recovery_changed', 409)
  insist(await one(env, "SELECT 1 FROM beam_members m JOIN oa_operators o ON o.id=m.operator_id WHERE m.id=? AND m.employment='active' AND o.status='active'", payload.substitute), 'substitute_unavailable', 409)
  const coverage = await grantCoverage(env, actor, Input.of({ team: payload.team, member: payload.substitute, expiresOn: payload.expiresOn, reason: 'Human-approved overdue recovery; arrange paid work and preserve original evidence.' }))
  const delivery = await runEscalations(env, true, payload.assignment)
  return { coverage, delivery, originalDueAt: payload.originalDueAt, assessmentUnchanged: true }
 },
}

export async function reportRecoveryBounce(env: Bindings, actor: Actor, input: Input) {
 insist(!actor.agent, 'human_delivery_report_required', 403)
 const facts = await currentRecovery(env, actor, input.text('assignment'), input.text('team'))
 const message = input.text('message')
 insist(await one(env, 'SELECT 1 FROM beam_escalation_messages WHERE id=? AND assignment_id=? AND recipient_id=?', message, facts.assignment, facts.learner), 'learner_delivery_not_found', 404)
 await commit(env, [stmt(env, "INSERT OR IGNORE INTO beam_recovery_delivery VALUES(?,'bounced',?,?)", message, actor.id, now())], { actor, action: 'recovery.delivery-reported', subject: facts.assignment, detail: { message, status: 'bounced', source: 'human_report' } })
 return { message, status: 'bounced', source: 'human_report' }
}

export async function recoveryVisible(env: Bindings, actor: Actor, payload: any) {
 return actor.owner || actor.managedTeams.includes(payload.team) && !!await one(env, 'SELECT 1 FROM beam_team_members t JOIN beam_assignments a ON a.learner_id=t.member_id WHERE a.id=? AND t.team_id=?', payload.assignment, payload.team)
}
