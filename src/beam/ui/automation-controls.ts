// Owner controls use the existing Automation page's cards and forms.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { automationControlView } from '../automation-policy'
import { all } from '../core'
import { card, checks, field, form, h, hidden, rows, select, when } from './html'

export async function automationControlsCard(env: Bindings, actor: Actor, zone: string) {
  if (!actor.owner) return ''
  const view = await automationControlView(env, actor), p = view.policy
  const rules = await all(env, "SELECT 'follow_on' AS kind,id,name FROM beam_automation_rules UNION ALL SELECT 'audience',id,name FROM beam_audiences UNION ALL SELECT 'notification',id,name FROM beam_notification_rules UNION ALL SELECT 'renewal',r.id,c.title || ' renewal' FROM beam_renewal_rules r JOIN beam_courses c ON c.id=r.course_id ORDER BY name")
  return h`${card('Automation policy', h`<p>Policy version ${p.version}. Each audience join or departure and each follow-on event counts as one action. Quiet hours use ${zone}, start inclusive and end exclusive; equal hours disable them. Held work waits for explicit replay or synchronization.</p>
<p class="muted">External spend ceiling: USD 0.00. These rules make no provider calls. Provider-backed rules must adopt these controls before they ship.</p>
${form('automation.policy', '/app/automation', [hidden('version', p.version), checks('Kill switch', 'paused', [{ value: 'on', label: 'Pause all automation' }], p.paused ? ['on'] : []), field('Quiet hours start (0–23)', 'quietStart', { type: 'number', value: p.quietStart }), field('Quiet hours end (0–23)', 'quietEnd', { type: 'number', value: p.quietEnd }), field('Maximum actions per employer day (0 blocks all)', 'dailyLimit', { type: 'number', value: p.dailyLimit })], 'Save automation policy')}`, { id: 'automation-policy' })}
${rules.length ? card('Rule approval', h`<p>Changing a mode creates a policy version and invalidates earlier event approvals. Rule team and unit scopes still apply.</p>${rules.map(rule => form('automation.policy', '/app/automation', [hidden('version', p.version), hidden('kind', rule.kind), hidden('rule', rule.id), select(rule.name, 'mode', [{ value: 'automatic', label: 'Run automatically' }, { value: 'approval', label: 'Owner approval for each event' }], view.controls.find(control => control.kind === rule.kind && control.rule === rule.id)?.mode ?? 'automatic')], 'Save rule mode', { secondary: true }))}`) : ''}
${view.executions.length ? card('Execution history', rows(view.executions.map(execution => ({ title: `${execution.learnerName} · ${execution.outcome.replaceAll('_', ' ')}`, meta: h`${execution.kind} · event ${execution.event_key} · policy ${execution.policy_version} · ${when(execution.updated_at, zone)}${execution.failure ? h`<p>${execution.failure}</p>` : ''}<details><summary>Input and attempts</summary><p>${JSON.stringify(execution.input)}</p>${rows(view.attempts.filter(attempt => attempt.execution_id === execution.id).map(attempt => ({ title: `${attempt.outcome.replaceAll('_', ' ')} · policy ${attempt.policy_version}`, meta: when(attempt.at, zone) })))}</details>${execution.state === 'blocked' ? form('automation.approve', '/app/automation', [hidden('execution', execution.id), hidden('version', p.version)], 'Approve current policy', { secondary: true }) : ''}` })))) : ''}`
}
