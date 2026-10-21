// AUTO-004 uses the established Automation cards and forms.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { renewalView } from '../renewals'
import { card, field, form, h, hidden, rows, select } from './html'

export async function renewalCards(env: Bindings, actor: Actor, courses: { value: string; label: string }[]) {
  if (!actor.owner) return ''
  const view = await renewalView(env, actor)
  return h`${card('Scheduled native renewals', h`<p>Set a lead period before certificate expiry, or repeat training every 365 elapsed days after completion. Grace adds calendar days to the assignment deadline; it never extends a certificate. Deadlines use 5 p.m. in the employer’s current time zone. Original path and renewal intervals stay with the new assignment.</p><p class="muted">Native completions only. Imported-history credit and delivered learner/manager notices are still pending. My learning and manager queues show the real assignments and overdue work. Held or failed events wait for explicit replay.</p>
${form('renewal.save', '/app/automation', [select('Course', 'course', courses), select('Recurrence', 'basis', [{ value: 'expiry', label: 'Before certificate expiry' }, { value: 'annual', label: 'Every 365 days after completion' }]), field('Lead time (calendar days)', 'leadDays', { type: 'number', value: 30 }), field('Grace (calendar days)', 'graceDays', { type: 'number', value: 0 })], 'Save renewal draft')}`)}
${view.rules.map(rule => card(`${rule.title} · renewal`, h`<p>${rule.basis === 'expiry' ? 'Certificate expiry' : 'Every 365 elapsed days'} · lead ${rule.lead_days} days · grace ${rule.grace_days} days · ${rule.state}. Enabling pauses the previous rule for this course. Saving a different policy creates a new retained rule.</p>
${rule.items.length ? rows(rule.items.map((item: any) => ({ title: item.learnerName, meta: h`Cycle date ${item.expiryDate}; opens ${item.opensOn}; due ${item.dueDate} at 5 p.m. (${item.timezone}). ${item.coverage.replaceAll('_', ' ')} · ${item.outcome.replaceAll('_', ' ')}.`, href: item.renewedAssignment ? `/app/learn/${item.renewedAssignment}` : undefined }))) : h`<p class="muted">No eligible native completions.</p>`}
${form('renewal.preview', '/app/automation', [hidden('rule', rule.id)], 'Preview without assigning', { secondary: true })}
${rule.state !== 'active' && rule.previewed_at ? form('renewal.state', '/app/automation', [hidden('rule', rule.id), hidden('state', 'active')], 'Enable renewal rule') : ''}
${rule.state === 'active' ? h`${form('renewal.replay', '/app/automation', [hidden('rule', rule.id)], 'Replay due renewals', { secondary: true })}${form('renewal.state', '/app/automation', [hidden('rule', rule.id), hidden('state', 'paused')], 'Pause renewal rule', { secondary: true })}` : ''}`))}
${view.cycles.length ? card('Retained renewal cycles', rows(view.cycles.map(cycle => ({ title: `${cycle.learnerName} · ${cycle.title}`, meta: `Due ${cycle.due_date} · ${cycle.timezone}; the source completion and certificate are retained.`, href: `/app/learn/${cycle.assignment_id}` })))) : ''}`
}
